// content.js — overlay injecté dans la page

if (!window.__deepcheckLoaded) {
  window.__deepcheckLoaded = true;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let isRecording = false;
  let sessionId = null;
  let playbackSpeed = 1.5;
  let currentAudio = null;
  let liveTranscript = "";
  let liveBubble = null;
  let liveBubbleContent = null;
  let liveBubbleMeta = null;

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function playBase64Audio(base64) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
    }
    const blob = new Blob([base64ToArrayBuffer(base64)], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = playbackSpeed;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    audio.play();
    currentAudio = audio;
    return audio;
  }

  function extractPageText() {
    const main = document.querySelector("article, main, [role='main']");
    return (main?.innerText || document.body.innerText || "").trim();
  }

  // ---------------------------
  // STYLES (light theme, Apple/Stripe/Linear)
  // ---------------------------

  function injectStyles() {
    if (document.getElementById("deepcheck-styles")) return;
    const style = document.createElement("style");
    style.id = "deepcheck-styles";
    style.textContent = `
      #deepcheck-overlay {
        --dc-bg: #ffffff;
        --dc-surface: #fafafa;
        --dc-border: #e5e7eb;
        --dc-border-strong: #d1d5db;
        --dc-text: #111827;
        --dc-text-muted: #6b7280;
        --dc-text-soft: #9ca3af;
        --dc-accent: #2563eb;
        --dc-accent-hover: #1d4ed8;
        --dc-accent-soft: #eff6ff;
        --dc-danger: #dc2626;
        --dc-danger-soft: #fef2f2;
        --dc-success: #16a34a;
        --dc-success-soft: #f0fdf4;
        --dc-warn: #d97706;
        --dc-shadow: 0 1px 3px rgba(0,0,0,.04), 0 12px 32px -8px rgba(17,24,39,.12);
        --dc-radius: 14px;

        position: fixed;
        top: 20px;
        right: 20px;
        width: 400px;
        max-height: 80vh;
        background: var(--dc-bg);
        border: 1px solid var(--dc-border);
        border-radius: var(--dc-radius);
        box-shadow: var(--dc-shadow);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        color: var(--dc-text);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-size: 14px;
        line-height: 1.5;
      }

      #deepcheck-overlay * { box-sizing: border-box; }

      .dc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--dc-border);
        background: var(--dc-bg);
      }

      .dc-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }

      .dc-title-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--dc-accent);
      }

      .dc-header-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .dc-speed {
        appearance: none;
        background: var(--dc-surface);
        border: 1px solid var(--dc-border);
        color: var(--dc-text);
        border-radius: 8px;
        padding: 5px 24px 5px 10px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
        background-repeat: no-repeat;
        background-position: right 8px center;
        transition: border-color .15s ease, background-color .15s ease;
      }
      .dc-speed:hover { border-color: var(--dc-border-strong); }
      .dc-speed:focus { outline: none; border-color: var(--dc-accent); box-shadow: 0 0 0 3px var(--dc-accent-soft); }

      .dc-icon-btn {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--dc-border);
        background: var(--dc-bg);
        color: var(--dc-text-muted);
        border-radius: 8px;
        cursor: pointer;
        transition: all .15s ease;
        font-size: 14px;
        line-height: 1;
      }
      .dc-icon-btn:hover { background: var(--dc-surface); color: var(--dc-text); border-color: var(--dc-border-strong); }

      .dc-history {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: var(--dc-surface);
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 200px;
        max-height: 440px;
      }

      .dc-history::-webkit-scrollbar { width: 6px; }
      .dc-history::-webkit-scrollbar-thumb { background: var(--dc-border-strong); border-radius: 3px; }

      .dc-empty {
        margin: auto;
        text-align: center;
        color: var(--dc-text-muted);
        padding: 24px 16px;
      }
      .dc-empty-title { font-size: 14px; font-weight: 600; color: var(--dc-text); margin-bottom: 4px; }
      .dc-empty-sub { font-size: 13px; color: var(--dc-text-muted); }

      .dc-msg { display: flex; flex-direction: column; gap: 4px; animation: dc-in .2s ease; }
      @keyframes dc-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

      .dc-msg-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--dc-text-soft);
      }

      .dc-msg-bubble {
        background: var(--dc-bg);
        border: 1px solid var(--dc-border);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        color: var(--dc-text);
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .dc-msg.tutor .dc-msg-bubble {
        border-color: var(--dc-accent-soft);
        background: var(--dc-accent-soft);
        color: #1e3a8a;
      }

      .dc-msg-bubble.dc-live {
        border-color: var(--dc-danger);
        border-style: dashed;
        color: var(--dc-text-muted);
        font-style: italic;
      }
      .dc-msg-bubble.dc-live.has-text {
        color: var(--dc-text);
        font-style: normal;
      }
      .dc-msg-bubble.dc-live::after {
        content: "▍";
        display: inline-block;
        margin-left: 2px;
        color: var(--dc-danger);
        animation: dc-caret 1s steps(1) infinite;
      }
      @keyframes dc-caret { 50% { opacity: 0; } }

      .dc-score {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: var(--dc-bg);
        border: 1px solid var(--dc-border);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        color: var(--dc-text-muted);
        text-transform: none;
        letter-spacing: 0;
      }
      .dc-score.high { color: var(--dc-success); border-color: #bbf7d0; background: var(--dc-success-soft); }
      .dc-score.mid  { color: var(--dc-warn);   border-color: #fde68a; background: #fffbeb; }
      .dc-score.low  { color: var(--dc-danger); border-color: #fecaca; background: var(--dc-danger-soft); }

      .dc-meta-rec {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--dc-danger);
        text-transform: none;
        letter-spacing: 0;
        font-weight: 600;
        font-size: 10px;
      }
      .dc-meta-rec-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--dc-danger);
        animation: dc-pulse 1.4s ease-in-out infinite;
      }

      .dc-controls {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--dc-border);
        background: var(--dc-bg);
      }

      .dc-btn {
        appearance: none;
        border: 1px solid var(--dc-border);
        background: var(--dc-bg);
        color: var(--dc-text);
        padding: 9px 12px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all .15s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .dc-btn:hover:not(:disabled) { background: var(--dc-surface); border-color: var(--dc-border-strong); }
      .dc-btn:active:not(:disabled) { transform: translateY(0.5px); }
      .dc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .dc-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--dc-accent-soft); }

      .dc-btn.primary {
        background: var(--dc-accent);
        border-color: var(--dc-accent);
        color: #fff;
      }
      .dc-btn.primary:hover:not(:disabled) { background: var(--dc-accent-hover); border-color: var(--dc-accent-hover); }

      .dc-btn.record {
        background: var(--dc-danger);
        border-color: var(--dc-danger);
        color: #fff;
      }
      .dc-btn.record:hover:not(:disabled) { background: #b91c1c; border-color: #b91c1c; }

      .dc-status {
        padding: 10px 16px;
        font-size: 12px;
        color: var(--dc-text-muted);
        border-top: 1px solid var(--dc-border);
        background: var(--dc-surface);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .dc-rec-dot {
        width: 8px;
        height: 8px;
        background: var(--dc-danger);
        border-radius: 50%;
        animation: dc-pulse 1.4s ease-in-out infinite;
      }
      @keyframes dc-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }

      .dc-spinner {
        width: 12px;
        height: 12px;
        border: 1.5px solid var(--dc-border-strong);
        border-top-color: var(--dc-accent);
        border-radius: 50%;
        animation: dc-spin .8s linear infinite;
      }
      @keyframes dc-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------
  // OVERLAY
  // ---------------------------

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  function buildOverlay() {
    if (document.getElementById("deepcheck-overlay")) {
      return document.getElementById("deepcheck-overlay");
    }
    injectStyles();

    const titleDot = el("span", { class: "dc-title-dot" });
    const title = el("div", { class: "dc-title" }, [titleDot, "DeepCheck Voice"]);

    const speed = el("select", { class: "dc-speed", id: "dc-speed" });
    for (const v of ["0.75", "1", "1.25", "1.5", "1.75", "2"]) {
      const opt = el("option", { value: v, text: `${v}×` });
      if (v === "1.5") opt.selected = true;
      speed.appendChild(opt);
    }
    const closeBtn = el("button", { class: "dc-icon-btn", id: "dc-close", title: "Fermer", text: "✕" });
    const headerCtrls = el("div", { class: "dc-header-controls" }, [speed, closeBtn]);
    const header = el("div", { class: "dc-header" }, [title, headerCtrls]);

    const empty = el("div", { class: "dc-empty" }, [
      el("div", { class: "dc-empty-title", text: "Prêt à tester votre compréhension ?" }),
      el("div", { class: "dc-empty-sub", text: "Le tuteur vous posera des questions sur cette page." })
    ]);
    const history = el("div", { class: "dc-history", id: "dc-history" }, [empty]);

    const startBtn = el("button", { class: "dc-btn primary", id: "dc-start", text: "Démarrer" });
    const recordBtn = el("button", { class: "dc-btn record", id: "dc-record", text: "🎙 Répondre" });
    recordBtn.disabled = true;
    const stopBtn = el("button", { class: "dc-btn", id: "dc-stop", text: "Terminer" });
    stopBtn.disabled = true;
    const controls = el("div", { class: "dc-controls" }, [startBtn, recordBtn, stopBtn]);

    const status = el("div", { class: "dc-status", id: "dc-status" }, [
      el("span", { text: "Cliquez sur « Démarrer » pour commencer." })
    ]);

    const container = el("div", { id: "deepcheck-overlay" }, [header, history, controls, status]);
    document.body.appendChild(container);

    return container;
  }

  function setStatus(text, kind = "idle") {
    const status = document.getElementById("dc-status");
    if (!status) return;
    status.textContent = "";
    if (kind === "recording") status.appendChild(el("span", { class: "dc-rec-dot" }));
    else if (kind === "loading") status.appendChild(el("span", { class: "dc-spinner" }));
    status.appendChild(document.createTextNode(text));
  }

  function scoreClass(score) {
    if (score == null) return "";
    if (score >= 0.7) return "high";
    if (score >= 0.4) return "mid";
    return "low";
  }

  function addMessage(type, content, score = null) {
    if (!content || !String(content).trim()) return null;
    const history = document.getElementById("dc-history");
    if (!history) return null;
    const empty = history.querySelector(".dc-empty");
    if (empty) empty.remove();

    const labelText = type === "tutor" ? "Tuteur" : "Vous";
    const meta = el("div", { class: "dc-msg-meta", text: labelText });
    if (score != null) {
      meta.appendChild(
        el("span", {
          class: `dc-score ${scoreClass(score)}`,
          text: `${Math.round(score * 100)}%`
        })
      );
    }
    const bubble = el("div", { class: "dc-msg-bubble", text: content });
    const msg = el("div", { class: `dc-msg ${type}` }, [meta, bubble]);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
    return msg;
  }

  // Bulle "live" pendant la transcription en direct
  function createLiveBubble() {
    const history = document.getElementById("dc-history");
    if (!history) return;
    const empty = history.querySelector(".dc-empty");
    if (empty) empty.remove();

    const meta = el("div", { class: "dc-msg-meta", text: "Vous" });
    const recIndicator = el("span", { class: "dc-meta-rec" }, [
      el("span", { class: "dc-meta-rec-dot" }),
      "REC"
    ]);
    meta.appendChild(recIndicator);

    const bubble = el("div", { class: "dc-msg-bubble dc-live", text: "À l'écoute…" });
    const msg = el("div", { class: "dc-msg user" }, [meta, bubble]);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;

    liveBubble = msg;
    liveBubbleContent = bubble;
    liveBubbleMeta = meta;
  }

  function updateLiveBubble(text) {
    if (!liveBubbleContent) return;
    if (text && text.trim()) {
      liveBubbleContent.textContent = text;
      liveBubbleContent.classList.add("has-text");
    } else {
      liveBubbleContent.textContent = "À l'écoute…";
      liveBubbleContent.classList.remove("has-text");
    }
    const history = document.getElementById("dc-history");
    if (history) history.scrollTop = history.scrollHeight;
  }

  function finalizeLiveBubble(text) {
    if (!liveBubble || !liveBubbleContent || !liveBubbleMeta) return;
    liveBubbleContent.classList.remove("dc-live", "has-text");
    liveBubbleContent.textContent = text;
    const rec = liveBubbleMeta.querySelector(".dc-meta-rec");
    if (rec) rec.remove();
    liveBubble = null;
    liveBubbleContent = null;
    liveBubbleMeta = null;
  }

  function discardLiveBubble() {
    if (liveBubble) liveBubble.remove();
    liveBubble = null;
    liveBubbleContent = null;
    liveBubbleMeta = null;
  }

  function updateLastUserScore(score) {
    if (score == null) return;
    const history = document.getElementById("dc-history");
    if (!history) return;
    const userMsgs = history.querySelectorAll(".dc-msg.user");
    const last = userMsgs[userMsgs.length - 1];
    if (!last) return;
    const meta = last.querySelector(".dc-msg-meta");
    if (!meta) return;
    const existing = meta.querySelector(".dc-score");
    if (existing) existing.remove();
    meta.appendChild(
      el("span", {
        class: `dc-score ${scoreClass(score)}`,
        text: `${Math.round(score * 100)}%`
      })
    );
  }

  // ---------------------------
  // SPEECH RECOGNITION (on-device si dispo)
  // ---------------------------

  async function tryEnableLocalRecognition(rec) {
    if (!SR.available) return;
    try {
      const status = await SR.available({ langs: ["fr-FR"], processLocally: true });
      if (status === "available") {
        rec.processLocally = true;
        return;
      }
      if (status === "downloadable" && SR.install) {
        setStatus("Téléchargement du modèle vocal local…", "loading");
        const ok = await SR.install({ langs: ["fr-FR"], processLocally: true });
        if (ok) rec.processLocally = true;
      }
    } catch (e) {
      console.warn("[DeepCheck] On-device recognition unavailable:", e.message);
    }
  }

  async function startRecognition() {
    if (!SR) {
      throw new Error("Speech Recognition non supporté (Chrome/Edge requis).");
    }

    const rec = new SR();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;

    await tryEnableLocalRecognition(rec);

    liveTranscript = "";

    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      liveTranscript = (final + " " + interim).trim();
      updateLiveBubble(liveTranscript);
    };

    rec.onerror = (e) => {
      console.error("[DeepCheck] Recognition error:", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        addMessage("tutor", "❌ Permission micro refusée. Autorisez le micro pour ce site.");
        setStatus("Micro refusé.");
      } else if (e.error === "language-not-supported") {
        addMessage("tutor", "❌ Modèle vocal français non disponible.");
        setStatus("Langue non supportée.");
      } else if (e.error === "no-speech") {
        // attendu si l'utilisateur ne parle pas — onend gérera
      } else {
        setStatus("Erreur reconnaissance: " + e.error);
      }
    };

    rec.onend = () => {
      onRecognitionEnded();
    };

    recognition = rec;
    rec.start();
  }

  function stopRecognition() {
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
  }

  async function onRecognitionEnded() {
    isRecording = false;
    const recordBtn = document.getElementById("dc-record");
    if (recordBtn) recordBtn.textContent = "🎙 Répondre";

    const transcript = liveTranscript.trim();
    liveTranscript = "";
    recognition = null;

    if (!transcript) {
      discardLiveBubble();
      setStatus("Aucune voix détectée — réessayez.");
      return;
    }

    finalizeLiveBubble(transcript);
    setStatus("Le tuteur analyse votre réponse…", "loading");

    try {
      const resp = await send({
        type: "CONTINUE_ANSWER",
        payload: { sessionId, transcript }
      });

      if (resp.masteryScore != null) updateLastUserScore(resp.masteryScore);

      const tutorMsg = (resp.feedback ? resp.feedback + " " : "") + (resp.question || "");
      if (tutorMsg.trim()) addMessage("tutor", tutorMsg);

      if (resp.audioBase64) playBase64Audio(resp.audioBase64);

      if (resp.sessionDone) {
        setStatus("Session terminée ✓");
        addMessage("tutor", "🎉 Session terminée. Vous avez bien progressé.");
        if (recordBtn) recordBtn.disabled = true;
        const stopBtn = document.getElementById("dc-stop");
        if (stopBtn) stopBtn.disabled = true;
        const startBtn = document.getElementById("dc-start");
        if (startBtn) startBtn.disabled = false;
      } else {
        setStatus("Écoutez puis cliquez sur « Répondre ».");
      }
    } catch (e) {
      console.error(e);
      setStatus("Erreur: " + e.message);
      addMessage("tutor", "❌ " + e.message);
    }
  }

  // ---------------------------
  // PROMISIFIED MESSAGING
  // ---------------------------

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.error) {
          reject(Object.assign(new Error(resp.error), { needsConfig: resp.needsConfig }));
          return;
        }
        resolve(resp);
      });
    });
  }

  // ---------------------------
  // INIT + HANDLERS
  // ---------------------------

  const overlay = buildOverlay();
  overlay.style.display = "none";

  const startBtn = document.getElementById("dc-start");
  const recordBtn = document.getElementById("dc-record");
  const stopBtn = document.getElementById("dc-stop");
  const closeBtn = document.getElementById("dc-close");
  const speedSelect = document.getElementById("dc-speed");

  speedSelect.addEventListener("change", (e) => {
    playbackSpeed = parseFloat(e.target.value);
    if (currentAudio) currentAudio.playbackRate = playbackSpeed;
  });

  closeBtn.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    setStatus("Extraction du texte de la page…", "loading");

    try {
      const pageText = extractPageText();
      setStatus("Génération de la première question…", "loading");
      const resp = await send({ type: "START_SESSION", payload: { pageText } });

      sessionId = resp.sessionId;
      if (resp.question) addMessage("tutor", resp.question);
      playBase64Audio(resp.audioBase64);

      setStatus("Écoutez puis cliquez sur « Répondre ».");
      recordBtn.disabled = false;
      stopBtn.disabled = false;
    } catch (e) {
      if (e.needsConfig) {
        setStatus("Clé API non configurée — ouvrez les options.");
        addMessage("tutor", "⚠️ Veuillez configurer votre clé API OpenAI dans les options.");
      } else {
        setStatus("Erreur: " + e.message);
        addMessage("tutor", "❌ " + e.message);
      }
      startBtn.disabled = false;
    }
  });

  recordBtn.addEventListener("click", async () => {
    if (!isRecording) {
      try {
        createLiveBubble();
        await startRecognition();
        isRecording = true;
        recordBtn.textContent = "⏹ Stop";
        const local = recognition?.processLocally ? " (local)" : "";
        setStatus(`Enregistrement${local} — parlez maintenant…`, "recording");
      } catch (e) {
        console.error(e);
        discardLiveBubble();
        setStatus("Erreur: " + e.message);
        addMessage("tutor", "❌ " + e.message);
      }
    } else {
      setStatus("Traitement…", "loading");
      stopRecognition();
    }
  });

  stopBtn.addEventListener("click", async () => {
    stopRecognition();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (sessionId) {
      try {
        await send({ type: "STOP_SESSION", payload: { sessionId } });
      } catch (e) {
        console.error(e);
      }
      sessionId = null;
    }
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("Session terminée.");
    addMessage("tutor", "Session terminée. À bientôt !");
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "TOGGLE_OVERLAY") {
      overlay.style.display = overlay.style.display === "none" ? "flex" : "none";
      sendResponse({ ok: true });
    }
  });
}
