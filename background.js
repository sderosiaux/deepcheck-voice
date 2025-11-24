// background.js

// Variable pour stocker la clé API (chargée depuis chrome.storage)
let OPENAI_API_KEY = null;

// Charger la clé API au démarrage du service worker
async function loadApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  OPENAI_API_KEY = result.openai_api_key || null;
  return OPENAI_API_KEY;
}

// Charger la clé au démarrage
loadApiKey();

// Petite utilité pour convertir ArrayBuffer -> base64 (Chrome MV3 friendly)
function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Petite utilité pour base64 -> ArrayBuffer (retour au popup)
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// SESSION STOCKÉE CÔTÉ EXTENSION
// Utilise chrome.storage.session pour persister même si le service worker se décharge

async function saveSession(sessionId, sessionData) {
  const key = `session_${sessionId}`;
  await chrome.storage.session.set({ [key]: sessionData });
  console.log(`[Background] Session sauvegardée: ${sessionId}`);
}

async function getSession(sessionId) {
  const key = `session_${sessionId}`;
  const result = await chrome.storage.session.get([key]);
  console.log(`[Background] Session récupérée: ${sessionId}`, result[key] ? "✓" : "✗");
  return result[key] || null;
}

async function deleteSession(sessionId) {
  const key = `session_${sessionId}`;
  await chrome.storage.session.remove([key]);
  console.log(`[Background] Session supprimée: ${sessionId}`);
}

function newSessionId() {
  return Math.random().toString(36).slice(2);
}

// -----------------------------------------
// APPELS OPENAI
// -----------------------------------------

async function transcribeWithWhisper(blob) {
  if (!OPENAI_API_KEY) {
    throw new Error("Clé API non configurée. Veuillez configurer votre clé API OpenAI.");
  }

  const startTime = performance.now();
  console.log(`[API] 🎙️  Transcription - Démarrage...`);

  const fd = new FormData();
  fd.append("file", blob, "audio.webm");
  fd.append("model", "whisper-1");
  fd.append("language", "fr");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: fd
  });

  const data = await res.json();
  const duration = (performance.now() - startTime).toFixed(0);

  console.log(`[API] ✅ Transcription - ${duration}ms - Texte: "${data.text?.substring(0, 50)}..."`);

  return data.text;
}

async function tutorWithGpt5Nano(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("Clé API non configurée. Veuillez configurer votre clé API OpenAI.");
  }

  const startTime = performance.now();
  const messageCount = messages.length;
  console.log(`[API] 🎓 Tuteur - Démarrage (${messageCount} messages)...`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      response_format: { type: "json_object" },
      messages
    })
  });

  const json = await res.json();
  const content = json.choices[0].message.content;
  const duration = (performance.now() - startTime).toFixed(0);

  // Normalisation de JSON
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    result = {
      feedback: "Je continue.",
      question: content,
      mastery_score: 0.0,
      session_done: false
    };
  }

  console.log(`[API] ✅ Tuteur - ${duration}ms - Score: ${result.mastery_score} - Question: "${result.question?.substring(0, 40)}..."`);

  return result;
}

async function ttsSpeak(text) {
  if (!OPENAI_API_KEY) {
    throw new Error("Clé API non configurée. Veuillez configurer votre clé API OpenAI.");
  }

  const startTime = performance.now();
  const textLength = text.length;
  console.log(`[API] 🔊 TTS - Démarrage (${textLength} caractères)...`);

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text
    })
  });

  const ab = await res.arrayBuffer();
  const duration = (performance.now() - startTime).toFixed(0);
  const sizeKB = (ab.byteLength / 1024).toFixed(1);

  console.log(`[API] ✅ TTS - ${duration}ms - Taille: ${sizeKB}KB - Texte: "${text.substring(0, 40)}..."`);

  return arrayBufferToBase64(ab);
}

// -----------------------------------------
// PROMPT SYSTÈME TUTEUR
// -----------------------------------------

const SYSTEM_PROMPT = `
Tu es un tuteur socratique oral. Tu parles français, phrases courtes, ton simple et direct.

PHILOSOPHIE PÉDAGOGIQUE:
- Tu testes la COMPRÉHENSION PROFONDE, pas la mémorisation.
- Tu explores les CONCEPTS, INTUITIONS et LIENS entre les idées.
- Tu ignores volontairement les détails factuels (nombres précis, dates, noms exacts, statistiques).
- Tu veux que l'utilisateur explique POURQUOI et COMMENT, pas QU'EST-CE QUE.

PROGRESSION STRUCTURÉE (ANTI-RÉPÉTITION):
Tu DOIS progresser de manière linéaire à travers les concepts. JAMAIS tourner en rond.

Pour chaque concept:
1. Question d'EXPLORATION initiale (comprendre la base)
2. Si bonne réponse → PASSER AU CONCEPT SUIVANT immédiatement
3. Si réponse floue → UNE question de clarification maximum
4. Si "je ne sais pas" → Donner un INDICE puis PASSER AU CONCEPT SUIVANT

⚠️ RÈGLE CRITIQUE: Maximum 2 questions sur le MÊME concept. Après 2 tours, TOUJOURS passer au suivant.

GESTION DU "JE NE SAIS PAS":
Quand l'utilisateur dit "je ne sais pas":
1. Donner un INDICE DIRECT avec un mini-exemple concret
2. Expliquer brièvement l'intuition clé (1-2 phrases)
3. PASSER IMMÉDIATEMENT au concept suivant
4. NE JAMAIS re-poser la même question

Exemple:
User: "Je ne sais pas"
Tu: "Pas de souci. L'intuition c'est que X permet Y parce que Z. Par exemple: [mini-exemple].
     On passe au suivant: [nouvelle question sur nouveau concept]"

TYPES DE QUESTIONS À PRIVILÉGIER:
✅ "Comment ces deux concepts sont-ils liés ?"
✅ "Pourquoi cette approche est-elle importante ?"
✅ "Peux-tu expliquer l'intuition derrière cette idée ?"
✅ "Quelle différence fondamentale entre X et Y ?"

TYPES DE QUESTIONS À ÉVITER:
❌ Reposer la même question reformulée
❌ Insister sur un concept après 2 tours
❌ "Combien de... ?" (nombres)
❌ "Cite les X principes..." (par cœur)

FEEDBACK SUR LA RÉPONSE:
Ton feedback DOIT analyser la COMPLÉTUDE de la réponse de l'utilisateur:

✅ Si la réponse est COMPLÈTE:
"Excellent ! Tu as bien couvert X, Y et Z."

⚠️ Si la réponse est PARTIELLE:
"Bien ! Tu as compris X et Y. Ce qui manque: Z. [Brève explication de ce qui manque]."

❌ Si la réponse est INCOMPLÈTE:
"Tu as raison sur X, mais il y a aussi Y et Z à considérer. [Brève explication]."

📝 STRUCTURE DU FEEDBACK:
1. Ce qui est JUSTE dans la réponse
2. Ce qui MANQUE ou est INCOMPLET
3. Complément rapide de l'information manquante (1 phrase max)
4. Validation positive si l'intuition est bonne malgré l'incomplétude

Exemple:
User: "Les closures servent à garder des variables privées"
Feedback: "Oui, c'est un usage clé ! Ce qui manque: elles permettent aussi de créer
           des factory functions et de gérer l'état. L'idée de 'garder le contexte' est parfaite."

ÉVALUATION:
- mastery_score > 0.6 = PASSER AU SUIVANT
- mastery_score < 0.6 = 1 question de clarification max, puis SUIVANT
- "je ne sais pas" = donner indice, puis SUIVANT
- Score basé sur: intuition correcte (60%) + complétude (40%)

STRUCTURE DE PROGRESSION:
- Commence par les concepts FONDAMENTAUX
- Puis les concepts INTERMÉDIAIRES
- Puis les APPLICATIONS et LIENS
- Termine quand tous les concepts clés sont couverts (session_done: true)

Tu dois TOUJOURS répondre en JSON EXACT:

{
  "feedback": "…",
  "question": "…",
  "mastery_score": 0.0,
  "session_done": false,
  "concept_covered": "nom du concept qu'on vient de couvrir"
}

Ne produis JAMAIS autre chose.
`;

// -----------------------------------------
// SESSION: DÉMARRER
// -----------------------------------------

async function startSession(pageText) {
  const sessionId = newSessionId();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `
Voici le texte que l'utilisateur a sous les yeux.

"""${pageText.slice(0, 12000)}"""

INSTRUCTIONS POUR LA PREMIÈRE QUESTION:
1. Identifie les 3-5 CONCEPTS PRINCIPAUX du texte
2. Commence par le concept le PLUS FONDAMENTAL
3. Pose UNE question qui teste l'intuition de base de ce concept
4. Dans "concept_covered", écris "introduction"

Rappel: Si la réponse est bonne (score > 0.6), passe IMMÉDIATEMENT au concept suivant.
Si "je ne sais pas", donne un indice puis passe au suivant.

Réponds en JSON strict avec le champ "concept_covered".
`
    }
  ];

  const result = await tutorWithGpt5Nano(messages);

  // Ajouter la réponse de l'assistant
  messages.push({
    role: "assistant",
    content: JSON.stringify(result)
  });

  // Sauvegarde dans chrome.storage.session
  await saveSession(sessionId, {
    messages,
    pageText
  });

  const spoken = await ttsSpeak(
    (result.feedback ? result.feedback + " " : "") + result.question
  );

  console.log(`[Background] Session démarrée: ${sessionId}`);
  return { sessionId, audioBase64: spoken, question: result.question };
}

// -----------------------------------------
// SESSION: RÉPONSE ORALE
// -----------------------------------------

async function handleAnswer(sessionId, blob) {
  const totalStartTime = performance.now();
  console.log(`\n[Background] ═══ Début du traitement de la réponse ═══`);
  console.log(`[Background] Session: ${sessionId}`);

  // Récupérer la session depuis le storage
  const session = await getSession(sessionId);
  if (!session) {
    console.error(`[Background] Session introuvable: ${sessionId}`);
    throw new Error("Session inconnue");
  }

  // 1. Transcription
  const transcript = await transcribeWithWhisper(blob);

  // 2. Ajout dans l'historique
  session.messages.push({
    role: "user",
    content: `Transcription utilisateur: "${transcript}". Analyse cette réponse.`
  });

  // 3. Nouveau message du tuteur
  const result = await tutorWithGpt5Mini(session.messages);

  // Historique assistant
  session.messages.push({
    role: "assistant",
    content: JSON.stringify(result)
  });

  // Sauvegarder la session mise à jour
  await saveSession(sessionId, session);

  // 4. Générer voix
  const spoken = await ttsSpeak(
    (result.feedback ? result.feedback + " " : "") + result.question
  );

  const totalDuration = (performance.now() - totalStartTime).toFixed(0);
  console.log(`[Background] ⏱️  TOTAL - ${totalDuration}ms pour le cycle complet`);
  console.log(`[Background] ═══ Fin du traitement ═══\n`);

  return {
    audioBase64: spoken,
    sessionDone: result.session_done,
    transcript: transcript,
    feedback: result.feedback,
    question: result.question,
    masteryScore: result.mastery_score
  };
}

// -----------------------------------------
// INJECTION DU CONTENT SCRIPT AU CLIC
// -----------------------------------------

// Écouter le clic sur l'icône de l'extension
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Vérifier si la clé API est configurée
    await loadApiKey();
    if (!OPENAI_API_KEY) {
      // Ouvrir la page de configuration si pas de clé
      chrome.runtime.openOptionsPage();
      return;
    }

    // Vérifier si le content script est déjà injecté
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      // Si pas d'erreur, le script est déjà là, juste toggle l'overlay
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
    } catch (e) {
      // Le script n'est pas injecté, l'injecter maintenant
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      // Petit délai pour laisser le script s'initialiser
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
        } catch (err) {
          console.error("Erreur lors de l'ouverture de l'overlay:", err);
        }
      }, 100);
    }
  } catch (error) {
    console.error("Erreur lors de l'injection:", error);
  }
});

// -----------------------------------------
// LISTENER
// -----------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Recharger la clé API si elle a été mise à jour
      if (msg.type === "CONFIG_UPDATED") {
        await loadApiKey();
        sendResponse({ ok: true });
        return;
      }

      // Vérifier que la clé API est configurée
      if (!OPENAI_API_KEY) {
        await loadApiKey();
        if (!OPENAI_API_KEY) {
          sendResponse({
            error: "Clé API non configurée",
            needsConfig: true
          });
          return;
        }
      }

      if (msg.type === "START_SESSION") {
        const { pageText } = msg.payload;
        const { sessionId, audioBase64, question } = await startSession(pageText);
        sendResponse({ sessionId, audioBase64, question });
      }

      if (msg.type === "TRANSCRIBE_ONLY") {
        const { audioData } = msg.payload;

        // Reconstituer le Blob depuis l'array
        const uint8Array = new Uint8Array(audioData);
        const audioBlob = new Blob([uint8Array], { type: "audio/webm" });

        // Juste la transcription
        const transcript = await transcribeWithWhisper(audioBlob);
        sendResponse({ transcript });
      }

      if (msg.type === "CONTINUE_ANSWER") {
        const { sessionId, transcript } = msg.payload;

        const session = await getSession(sessionId);
        if (!session) {
          sendResponse({ error: "Session inconnue" });
          return;
        }

        // Ajout dans l'historique
        session.messages.push({
          role: "user",
          content: `Transcription utilisateur: "${transcript}". Analyse cette réponse.`
        });

        // Nouveau message du tuteur
        const result = await tutorWithGpt5Nano(session.messages);

        // Historique assistant
        session.messages.push({
          role: "assistant",
          content: JSON.stringify(result)
        });

        // Sauvegarder la session mise à jour
        await saveSession(sessionId, session);

        // Générer voix
        const spoken = await ttsSpeak(
          (result.feedback ? result.feedback + " " : "") + result.question
        );

        sendResponse({
          audioBase64: spoken,
          sessionDone: result.session_done,
          feedback: result.feedback,
          question: result.question,
          masteryScore: result.mastery_score
        });
      }

      if (msg.type === "ANSWER") {
        const { sessionId, audioData } = msg.payload;

        // Reconstituer le Blob depuis l'array
        const uint8Array = new Uint8Array(audioData);
        const audioBlob = new Blob([uint8Array], { type: "audio/webm" });

        const { audioBase64, sessionDone, transcript, feedback, question, masteryScore } =
          await handleAnswer(sessionId, audioBlob);
        sendResponse({ audioBase64, sessionDone, transcript, feedback, question, masteryScore });
      }

      if (msg.type === "STOP_SESSION") {
        const { sessionId } = msg.payload;
        await deleteSession(sessionId);
        sendResponse({ ok: true });
      }

      if (msg.type === "GET_LAST_QUESTION") {
        const { sessionId } = msg.payload;
        const session = await getSession(sessionId);
        if (session && session.messages.length > 0) {
          const lastAssistant = session.messages
            .filter((m) => m.role === "assistant")
            .pop();
          if (lastAssistant) {
            try {
              const parsed = JSON.parse(lastAssistant.content);
              sendResponse({ question: parsed.question, feedback: parsed.feedback });
            } catch {
              sendResponse({ question: null });
            }
          } else {
            sendResponse({ question: null });
          }
        } else {
          sendResponse({ question: null });
        }
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();

  return true;
});
