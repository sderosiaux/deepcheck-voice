// popup.js

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
let sessionId = null;

// DOM
const startBtn = document.getElementById("startSession");
const recordBtn = document.getElementById("toggleRecord");
const stopBtn = document.getElementById("stopSession");
const statusDiv = document.getElementById("status");
const configNotice = document.getElementById("configNotice");
const mainControls = document.getElementById("mainControls");
const openConfigBtn = document.getElementById("openConfig");

// --------------------------
// VÉRIFICATION DE LA CLÉ API
// --------------------------

// Vérifier si la clé API est configurée au chargement
async function checkApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  if (!result.openai_api_key) {
    configNotice.classList.remove("hidden");
    mainControls.style.opacity = "0.3";
    startBtn.disabled = true;
    return false;
  }
  return true;
}

// Ouvrir la page de configuration
openConfigBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Vérifier au chargement
checkApiKey();

// Cache de conversion base64 -> ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Joue un audio base64 (mp3)
function playBase64Audio(base64) {
  const arrBuff = base64ToArrayBuffer(base64);
  const blob = new Blob([arrBuff], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
}

// Récupère le texte de la page en cours
async function getPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body.innerText
  });
  return result;
}

// Met à jour le statut
function setStatus(message, isRecording = false) {
  if (isRecording) {
    statusDiv.innerHTML = `<span class="recording-indicator"></span>${message}`;
  } else {
    statusDiv.textContent = message;
  }
}

// --------------------------
// START SESSION
// --------------------------
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  recordBtn.disabled = true;
  stopBtn.disabled = true;
  setStatus("Extraction du texte...");

  try {
    const pageText = await getPageText();
    setStatus("Génération de la première question...");

    chrome.runtime.sendMessage(
      { type: "START_SESSION", payload: { pageText } },
      (resp) => {
        if (!resp || resp.error) {
          console.error("Erreur:", resp ? resp.error : "inconnue");

          // Si la clé API n'est pas configurée
          if (resp && resp.needsConfig) {
            setStatus("Clé API non configurée");
            configNotice.classList.remove("hidden");
            mainControls.style.opacity = "0.3";
          } else {
            setStatus("Erreur: " + (resp ? resp.error : "inconnue"));
          }

          startBtn.disabled = false;
          return;
        }

        sessionId = resp.sessionId;

        // Lecture de la première question
        setStatus("Le tuteur pose sa question...");
        playBase64Audio(resp.audioBase64);

        setTimeout(() => {
          setStatus("Écoutez puis répondez");
          recordBtn.disabled = false;
          stopBtn.disabled = false;
        }, 1000);
      }
    );
  } catch (error) {
    console.error("Erreur:", error);
    setStatus("Erreur: " + error.message);
    startBtn.disabled = false;
  }
});

// --------------------------
// MICRO: RÉPONSE ORALE
// --------------------------
recordBtn.addEventListener("click", async () => {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setStatus("Analyse de votre réponse...");

        chrome.runtime.sendMessage(
          {
            type: "ANSWER",
            payload: { sessionId, audio: blob }
          },
          (resp) => {
            if (!resp || resp.error) {
              console.error("Erreur:", resp ? resp.error : "inconnue");
              setStatus("Erreur lors de l'analyse");
              return;
            }

            // Lire la réponse du tuteur
            setStatus("Le tuteur répond...");
            playBase64Audio(resp.audioBase64);

            if (resp.sessionDone) {
              setTimeout(() => {
                setStatus("Session terminée ✓");
                recordBtn.disabled = true;
                stopBtn.disabled = true;
                startBtn.disabled = false;
              }, 2000);
            } else {
              setTimeout(() => {
                setStatus("Écoutez puis répondez");
              }, 2000);
            }
          }
        );
      };

      mediaRecorder.start();
      isRecording = true;
      recordBtn.textContent = "⏹ Stop";
      setStatus("Enregistrement en cours...", true);
    } catch (error) {
      console.error("Erreur micro:", error);
      setStatus("Erreur: accès au micro refusé");
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.textContent = "🎙 Répondre";
    setStatus("Traitement...");
  }
});

// --------------------------
// STOP SESSION MANUELLE
// --------------------------
stopBtn.addEventListener("click", () => {
  if (sessionId) {
    chrome.runtime.sendMessage(
      { type: "STOP_SESSION", payload: { sessionId } },
      () => {
        sessionId = null;
        recordBtn.disabled = true;
        stopBtn.disabled = true;
        startBtn.disabled = false;
        setStatus("Session terminée");
      }
    );
  }
});
