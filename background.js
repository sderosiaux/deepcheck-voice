// background.js

const MODEL_TUTOR = "gpt-5-mini";
const MODEL_TTS = "gpt-4o-mini-tts";
const FETCH_TIMEOUT_MS = 60000;

let OPENAI_API_KEY = null;
let apiKeyLoadPromise = null;

function loadApiKey() {
  if (apiKeyLoadPromise) return apiKeyLoadPromise;
  apiKeyLoadPromise = chrome.storage.local
    .get(["openai_api_key"])
    .then((r) => {
      OPENAI_API_KEY = r.openai_api_key || null;
      return OPENAI_API_KEY;
    })
    .finally(() => {
      apiKeyLoadPromise = null;
    });
  return apiKeyLoadPromise;
}

loadApiKey();

// Mutex per-session: serialize CONTINUE_ANSWER and STOP_SESSION on the same session
const sessionInflight = new Map();
async function withSessionLock(sessionId, fn) {
  while (sessionInflight.has(sessionId)) {
    try { await sessionInflight.get(sessionId); } catch {}
  }
  const p = (async () => fn())();
  sessionInflight.set(sessionId, p);
  try { return await p; } finally {
    if (sessionInflight.get(sessionId) === p) sessionInflight.delete(sessionId);
  }
}

function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
    return res;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`Délai dépassé (${FETCH_TIMEOUT_MS / 1000}s). Réessayez.`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function requireApiKey() {
  if (!OPENAI_API_KEY) {
    throw new Error("Clé API non configurée. Veuillez configurer votre clé API OpenAI.");
  }
}

// Sessions persistées dans chrome.storage.session
async function saveSession(sessionId, sessionData) {
  await chrome.storage.session.set({ [`session_${sessionId}`]: sessionData });
}

async function getSession(sessionId) {
  const key = `session_${sessionId}`;
  const result = await chrome.storage.session.get([key]);
  return result[key] || null;
}

async function deleteSession(sessionId) {
  await chrome.storage.session.remove([`session_${sessionId}`]);
}

function newSessionId() {
  return crypto.randomUUID();
}

// -----------------------------------------
// APPELS OPENAI
// -----------------------------------------

async function tutor(messages) {
  requireApiKey();
  const startTime = performance.now();

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_TUTOR,
      response_format: { type: "json_object" },
      messages
    })
  });

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const duration = (performance.now() - startTime).toFixed(0);

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

  console.log(`[API] Tutor ${duration}ms — score=${result.mastery_score}`);
  return result;
}

async function ttsSpeak(text) {
  requireApiKey();
  const startTime = performance.now();

  const res = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_TTS,
      voice: "alloy",
      input: text
    })
  });

  const ab = await res.arrayBuffer();
  const duration = (performance.now() - startTime).toFixed(0);
  console.log(`[API] TTS ${duration}ms — ${(ab.byteLength / 1024).toFixed(1)}KB`);
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
1. Donner un INDICE DIRECT avec un mini-exemple concret
2. Expliquer brièvement l'intuition clé (1-2 phrases)
3. PASSER IMMÉDIATEMENT au concept suivant
4. NE JAMAIS re-poser la même question

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
✅ Si COMPLÈTE: "Excellent ! Tu as bien couvert X, Y et Z."
⚠️ Si PARTIELLE: "Bien ! Tu as compris X et Y. Ce qui manque: Z."
❌ Si INCOMPLÈTE: "Tu as raison sur X, mais il y a aussi Y et Z."

ÉVALUATION:
- mastery_score > 0.6 = PASSER AU SUIVANT
- mastery_score < 0.6 = 1 question de clarification max, puis SUIVANT
- "je ne sais pas" = indice puis SUIVANT
- Score = intuition correcte (60%) + complétude (40%)

STRUCTURE DE PROGRESSION:
- Concepts FONDAMENTAUX → INTERMÉDIAIRES → APPLICATIONS et LIENS
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
// SESSION
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
1. Identifie les 3-5 CONCEPTS PRINCIPAUX du texte (en silence, ne les liste pas)
2. Commence par le concept le PLUS FONDAMENTAL
3. Pose UNE question courte et directe qui teste l'intuition de base
4. Dans "concept_covered", écris "introduction"
5. ⚠️ Le champ "feedback" DOIT être une chaîne vide "" à la première question (rien à commenter)
6. Ne fais AUCUN préambule, salutation, ou présentation du texte. Va droit à la question.

Réponds en JSON strict.
`
    }
  ];

  const result = await tutor(messages);
  messages.push({ role: "assistant", content: JSON.stringify(result) });

  // Première question: on parle UNIQUEMENT la question (pas de feedback préambule)
  let spoken;
  try {
    spoken = await ttsSpeak(result.question || "");
  } catch (e) {
    throw e;
  }

  await saveSession(sessionId, { messages, pageText });
  return { sessionId, audioBase64: spoken, question: result.question };
}

// -----------------------------------------
// INJECTION DU CONTENT SCRIPT AU CLIC
// -----------------------------------------

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch {
    // pas injecté
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
  } catch (e) {
    console.warn("[Background] insertCSS failed:", e.message);
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  // Retry PING jusqu'à 1s
  for (let i = 0; i < 10; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PING" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await loadApiKey();
    if (!OPENAI_API_KEY) {
      chrome.runtime.openOptionsPage();
      return;
    }
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch (error) {
    console.error("Erreur injection:", error);
  }
});

// -----------------------------------------
// LISTENER
// -----------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "CONFIG_UPDATED") {
        await loadApiKey();
        sendResponse({ ok: true });
        return;
      }

      if (!OPENAI_API_KEY) {
        await loadApiKey();
        if (!OPENAI_API_KEY) {
          sendResponse({ error: "Clé API non configurée", needsConfig: true });
          return;
        }
      }

      if (msg.type === "START_SESSION") {
        const { pageText } = msg.payload;
        sendResponse(await startSession(pageText));
        return;
      }

      if (msg.type === "CONTINUE_ANSWER") {
        const { sessionId, transcript } = msg.payload;
        const result = await withSessionLock(sessionId, async () => {
          const session = await getSession(sessionId);
          if (!session) throw new Error("Session inconnue");

          session.messages.push({
            role: "user",
            content: `Transcription utilisateur: "${transcript}". Analyse cette réponse.`
          });

          const tutorResult = await tutor(session.messages);
          session.messages.push({ role: "assistant", content: JSON.stringify(tutorResult) });

          let spoken;
          try {
            spoken = await ttsSpeak(
              (tutorResult.feedback ? tutorResult.feedback + " " : "") + (tutorResult.question || "")
            );
          } catch (e) {
            // TTS failed: don't persist updated history (avoid orphan growth)
            throw e;
          }

          await saveSession(sessionId, session);

          if (tutorResult.session_done) {
            await deleteSession(sessionId);
          }

          return {
            audioBase64: spoken,
            sessionDone: tutorResult.session_done,
            feedback: tutorResult.feedback,
            question: tutorResult.question,
            masteryScore: tutorResult.mastery_score
          };
        });
        sendResponse(result);
        return;
      }

      if (msg.type === "STOP_SESSION") {
        const { sessionId } = msg.payload;
        await withSessionLock(sessionId, () => deleteSession(sessionId));
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ error: `Type de message inconnu: ${msg.type}` });
    } catch (e) {
      console.error("[Background] Erreur:", e);
      sendResponse({ error: e.message });
    }
  })();

  return true;
});
