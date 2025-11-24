// content.js - Script injecté dans la page web

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
let sessionId = null;
let conversationHistory = [];
let playbackSpeed = 1.5; // Vitesse par défaut 1.5x

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
  audio.playbackRate = playbackSpeed; // Appliquer la vitesse
  audio.play();
  return audio;
}

// Créer l'overlay UI
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "deepcheck-overlay";
  overlay.innerHTML = `
    <div class="deepcheck-container">
      <div class="deepcheck-header">
        <h1>🎙 DeepCheck Voice</h1>
        <div class="deepcheck-header-controls">
          <div class="deepcheck-speed-control">
            <label for="deepcheck-speed">🔊 Vitesse:</label>
            <select id="deepcheck-speed" class="deepcheck-speed-select">
              <option value="0.75">0.75x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5" selected>1.5x</option>
              <option value="1.75">1.75x</option>
              <option value="2">2x</option>
            </select>
          </div>
          <button class="deepcheck-close" id="deepcheck-close">✕</button>
        </div>
      </div>

      <div class="deepcheck-history" id="deepcheck-history">
        <div class="deepcheck-welcome">
          <p>👋 Prêt à tester votre compréhension ?</p>
          <p class="deepcheck-subtitle">Je vais vous poser des questions sur cette page</p>
        </div>
      </div>

      <div class="deepcheck-controls">
        <button class="deepcheck-btn deepcheck-btn-primary" id="deepcheck-start">
          Démarrer la session
        </button>
        <button class="deepcheck-btn deepcheck-btn-record" id="deepcheck-record" disabled>
          🎙 Répondre
        </button>
        <button class="deepcheck-btn deepcheck-btn-secondary" id="deepcheck-stop" disabled>
          Terminer
        </button>
      </div>

      <div class="deepcheck-status" id="deepcheck-status">
        Cliquez sur "Démarrer la session" pour commencer
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Ajouter les styles
  const style = document.createElement("style");
  style.textContent = `
    #deepcheck-overlay {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 420px;
      max-height: 80vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #fff;
      display: flex;
      flex-direction: column;
    }

    .deepcheck-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .deepcheck-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .deepcheck-header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .deepcheck-header-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .deepcheck-speed-control {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .deepcheck-speed-control label {
      opacity: 0.9;
      white-space: nowrap;
    }

    .deepcheck-speed-select {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .deepcheck-speed-select:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .deepcheck-speed-select option {
      background: #667eea;
      color: #fff;
    }

    .deepcheck-close {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: #fff;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      transition: all 0.2s ease;
    }

    .deepcheck-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .deepcheck-history {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      max-height: 400px;
    }

    .deepcheck-welcome {
      text-align: center;
      padding: 40px 0;
    }

    .deepcheck-welcome p {
      margin: 0 0 8px 0;
      font-size: 16px;
    }

    .deepcheck-subtitle {
      font-size: 14px !important;
      opacity: 0.8;
    }

    .deepcheck-message {
      margin-bottom: 16px;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .deepcheck-message-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }

    .deepcheck-message-content {
      background: rgba(255, 255, 255, 0.15);
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      backdrop-filter: blur(10px);
    }

    .deepcheck-message.tutor .deepcheck-message-content {
      background: rgba(255, 255, 255, 0.25);
    }

    .deepcheck-message.user .deepcheck-message-content {
      background: rgba(0, 0, 0, 0.2);
    }

    .deepcheck-controls {
      padding: 16px 24px;
      display: flex;
      gap: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .deepcheck-btn {
      flex: 1;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 500;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .deepcheck-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    .deepcheck-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .deepcheck-btn-primary {
      background: #fff;
      color: #667eea;
    }

    .deepcheck-btn-record {
      background: #ff6b6b;
      color: #fff;
    }

    .deepcheck-btn-secondary {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }

    .deepcheck-status {
      padding: 12px 24px;
      text-align: center;
      font-size: 13px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom-left-radius: 16px;
      border-bottom-right-radius: 16px;
    }

    .deepcheck-recording-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #ff6b6b;
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .deepcheck-score {
      display: inline-block;
      background: rgba(255, 255, 255, 0.3);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      margin-left: 8px;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  return overlay;
}

// Ajouter un message à l'historique
function addMessage(type, content, score = null) {
  const historyDiv = document.getElementById("deepcheck-history");

  // Retirer le message de bienvenue
  const welcome = historyDiv.querySelector(".deepcheck-welcome");
  if (welcome) welcome.remove();

  const messageDiv = document.createElement("div");
  messageDiv.className = `deepcheck-message ${type}`;

  const label = type === "tutor" ? "🎓 Tuteur" : "👤 Vous";
  const scoreHtml = score !== null ? `<span class="deepcheck-score">Score: ${Math.round(score * 100)}%</span>` : "";

  messageDiv.innerHTML = `
    <div class="deepcheck-message-label">${label}${scoreHtml}</div>
    <div class="deepcheck-message-content">${content}</div>
  `;

  historyDiv.appendChild(messageDiv);

  // Scroll vers le bas
  historyDiv.scrollTop = historyDiv.scrollHeight;

  // Sauvegarder dans l'historique
  conversationHistory.push({ type, content, score, timestamp: Date.now() });
}

// Mettre à jour le statut
function setStatus(message, isRecording = false) {
  const statusDiv = document.getElementById("deepcheck-status");
  if (isRecording) {
    statusDiv.innerHTML = `<span class="deepcheck-recording-indicator"></span>${message}`;
  } else {
    statusDiv.textContent = message;
  }
}

// Initialiser l'overlay
const overlay = createOverlay();

const startBtn = document.getElementById("deepcheck-start");
const recordBtn = document.getElementById("deepcheck-record");
const stopBtn = document.getElementById("deepcheck-stop");
const closeBtn = document.getElementById("deepcheck-close");
const speedSelect = document.getElementById("deepcheck-speed");

// Gérer le changement de vitesse
speedSelect.addEventListener("change", (e) => {
  playbackSpeed = parseFloat(e.target.value);
  console.log(`[DeepCheck] Vitesse de lecture: ${playbackSpeed}x`);
});

// Fermer l'overlay
closeBtn.addEventListener("click", () => {
  overlay.style.display = "none";
});

// Démarrer la session
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  recordBtn.disabled = true;
  stopBtn.disabled = true;
  setStatus("Extraction du texte de la page...");

  try {
    const pageText = document.body.innerText;
    setStatus("Génération de la première question...");

    chrome.runtime.sendMessage(
      { type: "START_SESSION", payload: { pageText } },
      (resp) => {
        if (!resp || resp.error) {
          console.error("Erreur:", resp ? resp.error : "inconnue");

          if (resp && resp.needsConfig) {
            setStatus("Clé API non configurée - Ouvrez les options de l'extension");
            addMessage("tutor", "⚠️ Veuillez configurer votre clé API OpenAI dans les options de l'extension.");
          } else {
            setStatus("Erreur: " + (resp ? resp.error : "inconnue"));
            addMessage("tutor", "❌ Une erreur est survenue: " + (resp ? resp.error : "inconnue"));
          }

          startBtn.disabled = false;
          return;
        }

        sessionId = resp.sessionId;

        // Lecture de la première question
        setStatus("Le tuteur pose sa question...");
        playBase64Audio(resp.audioBase64);

        // Afficher la question
        if (resp.question) {
          addMessage("tutor", resp.question);
        }

        setTimeout(() => {
          setStatus("Écoutez puis cliquez sur 'Répondre'");
          recordBtn.disabled = false;
          stopBtn.disabled = false;
        }, 2000);
      }
    );
  } catch (error) {
    console.error("Erreur:", error);
    setStatus("Erreur: " + error.message);
    addMessage("tutor", "❌ " + error.message);
    startBtn.disabled = false;
  }
});

// Enregistrer la réponse
recordBtn.addEventListener("click", async () => {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setStatus("Transcription de votre réponse...");

        // Convertir le blob en ArrayBuffer pour le transférer via chrome.runtime.sendMessage
        const arrayBuffer = await blob.arrayBuffer();
        const audioData = Array.from(new Uint8Array(arrayBuffer));

        // ÉTAPE 1: Transcription seulement (rapide)
        chrome.runtime.sendMessage(
          {
            type: "TRANSCRIBE_ONLY",
            payload: { audioData }
          },
          (resp) => {
            if (!resp || resp.error) {
              console.error("Erreur transcription:", resp ? resp.error : "inconnue");
              setStatus("Erreur lors de la transcription");
              addMessage("tutor", "❌ " + (resp ? resp.error : "inconnue"));
              return;
            }

            // Afficher IMMÉDIATEMENT la transcription
            addMessage("user", resp.transcript);
            setStatus("Le tuteur analyse votre réponse...");

            // ÉTAPE 2: Analyse + génération de la réponse (plus lent)
            chrome.runtime.sendMessage(
              {
                type: "CONTINUE_ANSWER",
                payload: {
                  sessionId,
                  transcript: resp.transcript
                }
              },
              (resp2) => {
                if (!resp2 || resp2.error) {
                  console.error("Erreur analyse:", resp2 ? resp2.error : "inconnue");
                  setStatus("Erreur lors de l'analyse");
                  addMessage("tutor", "❌ " + (resp2 ? resp2.error : "inconnue"));
                  return;
                }

                // Mettre à jour le score sur le message utilisateur
                const userMessages = document.querySelectorAll(".deepcheck-message.user");
                const lastUserMessage = userMessages[userMessages.length - 1];
                if (lastUserMessage && resp2.masteryScore !== undefined) {
                  const label = lastUserMessage.querySelector(".deepcheck-message-label");
                  if (label) {
                    label.innerHTML = `👤 Vous<span class="deepcheck-score">Score: ${Math.round(resp2.masteryScore * 100)}%</span>`;
                  }
                }

                // Lire la réponse du tuteur
                setStatus("Le tuteur répond...");
                playBase64Audio(resp2.audioBase64);

                // Ajouter le feedback et la question du tuteur
                if (resp2.feedback || resp2.question) {
                  const tutorMessage = (resp2.feedback ? resp2.feedback + " " : "") + (resp2.question || "");
                  addMessage("tutor", tutorMessage);
                }

                if (resp2.sessionDone) {
                  setTimeout(() => {
                    setStatus("Session terminée ✓");
                    addMessage("tutor", "🎉 Session terminée ! Vous avez bien progressé.");
                    recordBtn.disabled = true;
                    stopBtn.disabled = true;
                    startBtn.disabled = false;
                  }, 2000);
                } else {
                  setTimeout(() => {
                    setStatus("Écoutez puis cliquez sur 'Répondre'");
                  }, 2000);
                }
              }
            );
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
      addMessage("tutor", "❌ Impossible d'accéder au microphone. Vérifiez les permissions du site.");
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.textContent = "🎙 Répondre";
    setStatus("Traitement...");
  }
});

// Arrêter la session
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
        addMessage("tutor", "Session terminée. À bientôt !");
      }
    );
  }
});

// Écouter les messages depuis le background (pour ouvrir/fermer l'overlay)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") {
    // Répondre au ping pour indiquer que le script est chargé
    sendResponse({ ok: true });
  }

  if (msg.type === "TOGGLE_OVERLAY") {
    if (overlay.style.display === "none" || !overlay.style.display) {
      overlay.style.display = "block";
    } else {
      overlay.style.display = "none";
    }
    sendResponse({ ok: true });
  }
});

// Cacher l'overlay par défaut au chargement
overlay.style.display = "none";
