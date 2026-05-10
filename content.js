// content.js — overlay injecté dans la page

if (!window.__deepcheckLoaded) {
  window.__deepcheckLoaded = true;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // --- État ---
  let recognition = null;
  let recognitionToken = 0;
  let isRecording = false;
  let isStarting = false;
  let isProcessing = false;
  let explicitStop = false;
  let aborted = false;
  let submitGeneration = 0;
  let sessionStartGen = 0;
  let recordOpGen = 0;
  let silenceRestartCount = 0;
  const MAX_SILENCE_RESTARTS = 5;
  let lastRecognitionError = null;

  let accumulatedFinal = "";
  let currentRecFinal = "";
  let currentRecInterim = "";

  let sessionId = null;
  let playbackSpeed = 1.5;

  let currentAudio = null;
  let currentAudioUrl = null;

  // Audio input device
  let selectedDeviceId = null; // null = système par défaut
  let bindingStream = null;
  let cachedDevices = [];

  let liveBubble = null;
  let liveBubbleContent = null;
  let liveBubbleMeta = null;

  // --- Utils ---

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function stopAndCleanupAudio() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      try { currentAudio.src = ""; } catch {}
      currentAudio = null;
    }
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
  }

  function playBase64Audio(base64) {
    stopAndCleanupAudio();
    const blob = new Blob([base64ToArrayBuffer(base64)], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = playbackSpeed;
    audio.addEventListener("ended", () => {
      if (currentAudioUrl === url) {
        URL.revokeObjectURL(url);
        currentAudioUrl = null;
      }
    });
    audio.addEventListener("error", () => {
      if (currentAudioUrl === url) {
        URL.revokeObjectURL(url);
        currentAudioUrl = null;
      }
    });
    audio.addEventListener("abort", () => {
      if (currentAudioUrl === url) {
        URL.revokeObjectURL(url);
        currentAudioUrl = null;
      }
    });
    audio.play().catch((err) => {
      console.error("[DeepCheck] Audio play failed:", err);
      if (currentAudioUrl === url) {
        URL.revokeObjectURL(url);
        currentAudioUrl = null;
      }
    });
    currentAudio = audio;
    currentAudioUrl = url;
    return audio;
  }

  function extractPageText() {
    const main = document.querySelector("article, main, [role='main']");
    return (main?.innerText || document.body.innerText || "").trim();
  }

  // ---------------------------
  // AUDIO INPUT DEVICES
  // ---------------------------

  function getDeviceLabel(id) {
    if (!id) return "Micro système";
    const d = cachedDevices.find((x) => x.deviceId === id);
    return d?.label || "Micro inconnu";
  }

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      cachedDevices = all.filter((d) => d.kind === "audioinput");
      populateMicSelect();
    } catch (e) {
      console.warn("[DeepCheck] enumerateDevices failed:", e.message);
    }
  }

  function populateMicSelect() {
    const sel = document.getElementById("dc-mic");
    if (!sel) return;
    const current = selectedDeviceId || "";
    sel.textContent = "";
    sel.appendChild(el("option", { value: "", text: "🎙 Système" }));
    cachedDevices.forEach((d, i) => {
      const label = d.label || `Micro ${i + 1}`;
      sel.appendChild(el("option", { value: d.deviceId, text: label }));
    });
    sel.value = current;
  }

  async function bindMic() {
    releaseBindingStream();
    if (!selectedDeviceId) return; // micro par défaut
    try {
      bindingStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedDeviceId } }
      });
    } catch (e) {
      console.warn("[DeepCheck] Bind mic failed, fallback default:", e.message);
      bindingStream = null;
    }
  }

  function releaseBindingStream() {
    if (bindingStream) {
      bindingStream.getTracks().forEach((t) => t.stop());
      bindingStream = null;
    }
  }

  // ---------------------------
  // OVERLAY (styles loaded via content.css by background.js insertCSS)
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

    const titleDot = el("span", { class: "dc-title-dot" });
    const title = el("div", { class: "dc-title" }, [titleDot, "DeepCheck Voice"]);

    const mic = el("select", { class: "dc-speed dc-mic-select", id: "dc-mic", title: "Microphone" });
    mic.appendChild(el("option", { value: "", text: "🎙 Système" }));

    const speed = el("select", { class: "dc-speed", id: "dc-speed", title: "Vitesse de lecture" });
    for (const v of ["0.75", "1", "1.25", "1.5", "1.75", "2"]) {
      const opt = el("option", { value: v, text: `${v}×` });
      if (v === "1.5") opt.selected = true;
      speed.appendChild(opt);
    }
    const closeBtn = el("button", { class: "dc-icon-btn", id: "dc-close", title: "Fermer", text: "✕" });
    const headerCtrls = el("div", { class: "dc-header-controls" }, [mic, speed, closeBtn]);
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
      meta.appendChild(el("span", { class: `dc-score ${scoreClass(score)}`, text: `${Math.round(score * 100)}%` }));
    }
    const bubble = el("div", { class: "dc-msg-bubble", text: content });
    const msg = el("div", { class: `dc-msg ${type}` }, [meta, bubble]);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
    return msg;
  }

  function createLiveBubble() {
    discardLiveBubble();
    const history = document.getElementById("dc-history");
    if (!history) return;
    const empty = history.querySelector(".dc-empty");
    if (empty) empty.remove();

    const meta = el("div", { class: "dc-msg-meta", text: "Vous" });
    const recIndicator = el("span", { class: "dc-meta-rec" }, [el("span", { class: "dc-meta-rec-dot" }), "REC"]);
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
    meta.appendChild(el("span", { class: `dc-score ${scoreClass(score)}`, text: `${Math.round(score * 100)}%` }));
  }

  // ---------------------------
  // SPEECH RECOGNITION
  // ---------------------------

  // Le modèle on-device (SODA) a des interim results moins fiables selon les
  // versions Chrome. Par défaut on utilise le mode cloud (plus fluide).
  // Pour activer le local: window.__deepcheckLocal = true dans la console.
  async function tryEnableLocalRecognition(rec) {
    if (!window.__deepcheckLocal) return;
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

  async function createRecognizer(opGen) {
    if (!SR) throw new Error("Speech Recognition non supporté (Chrome/Edge requis).");

    const rec = new SR();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;

    await tryEnableLocalRecognition(rec);

    // Abort check après l'install (peut prendre du temps)
    if (aborted || opGen !== recordOpGen) {
      try { rec.abort(); } catch {}
      return null;
    }

    // Bind du micro spécifique avant start (workaround SpeechRecognition)
    await bindMic();
    if (aborted || opGen !== recordOpGen) {
      releaseBindingStream();
      try { rec.abort(); } catch {}
      return null;
    }

    const token = ++recognitionToken;
    rec._dcToken = token;
    currentRecFinal = "";
    currentRecInterim = "";

    rec.onresult = (e) => {
      if (rec._dcToken !== recognitionToken) return;
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      console.debug("[DeepCheck] result", { final, interim, isFinal: e.results[e.results.length - 1]?.isFinal });
      currentRecFinal = final;
      currentRecInterim = interim;
      if (final || interim) silenceRestartCount = 0;
      const merged = [accumulatedFinal, final, interim].filter(Boolean).join(" ").trim();
      updateLiveBubble(merged);
    };

    rec.onerror = (e) => {
      if (rec._dcToken !== recognitionToken) return;
      console.error("[DeepCheck] Recognition error:", e.error, e.message);
      if (e.error === "no-speech") return;
      lastRecognitionError = e.error;
    };

    rec.onaudiostart = () => console.debug("[DeepCheck] audio start");
    rec.onspeechstart = () => console.debug("[DeepCheck] speech start");
    rec.onspeechend = () => console.debug("[DeepCheck] speech end");

    rec.onend = () => {
      if (rec._dcToken !== recognitionToken) return;
      handleRecognitionEnd();
    };

    rec.start();
    recognition = rec;
    return rec;
  }

  async function handleRecognitionEnd() {
    if (currentRecFinal) {
      accumulatedFinal = (accumulatedFinal + " " + currentRecFinal).trim();
    }
    currentRecFinal = "";
    currentRecInterim = "";

    if (aborted) {
      // Terminer/Close en cours — pas de soumission
      recognition = null;
      return;
    }

    // Erreur terminale (permission, langue) → on stoppe
    if (lastRecognitionError && lastRecognitionError !== "no-speech") {
      const err = lastRecognitionError;
      lastRecognitionError = null;
      recognition = null;
      isRecording = false;
      isStarting = false;
      explicitStop = false;
      discardLiveBubble();
      const recordBtn = document.getElementById("dc-record");
      if (recordBtn) {
        recordBtn.textContent = "🎙 Répondre";
        recordBtn.disabled = false;
      }
      if (err === "not-allowed" || err === "service-not-allowed") {
        setStatus("Permission micro refusée.");
        addMessage("tutor", "❌ Permission micro refusée. Autorisez le micro pour ce site.");
      } else if (err === "language-not-supported") {
        setStatus("Modèle FR indisponible.");
        addMessage("tutor", "❌ Modèle vocal français non disponible.");
      } else {
        setStatus("Erreur reconnaissance: " + err);
      }
      return;
    }

    // Auto-end (silence prolongé) sans stop explicite → on relance un nouveau recognizer
    if (!explicitStop && isRecording) {
      silenceRestartCount++;
      if (silenceRestartCount > MAX_SILENCE_RESTARTS) {
        console.warn(`[DeepCheck] Silence cap atteint (${MAX_SILENCE_RESTARTS}), finalisation.`);
        silenceRestartCount = 0;
        // Tombe dans finalizeAndSubmit
      } else {
        try {
          const r = await createRecognizer(recordOpGen);
          if (r) return;
        } catch (e) {
          console.warn("[DeepCheck] Restart failed, finalizing:", e.message);
        }
      }
    }

    finalizeAndSubmit();
  }

  async function finalizeAndSubmit() {
    recognition = null;
    releaseBindingStream();
    isRecording = false;
    explicitStop = false;
    const transcript = accumulatedFinal.trim();
    accumulatedFinal = "";

    const recordBtn = document.getElementById("dc-record");
    if (recordBtn) recordBtn.textContent = "🎙 Répondre";

    if (!transcript) {
      discardLiveBubble();
      setStatus("Aucune voix détectée — réessayez.");
      if (recordBtn) recordBtn.disabled = false;
      return;
    }

    finalizeLiveBubble(transcript);
    isProcessing = true;
    if (recordBtn) recordBtn.disabled = true;
    setStatus("Le tuteur analyse votre réponse…", "loading");

    const gen = ++submitGeneration;

    try {
      const resp = await send({ type: "CONTINUE_ANSWER", payload: { sessionId, transcript } });

      // Si l'utilisateur a abort/relancé entre-temps, on ignore la réponse
      if (gen !== submitGeneration || aborted) return;

      if (resp.masteryScore != null) updateLastUserScore(resp.masteryScore);
      const tutorMsg = (resp.feedback ? resp.feedback + " " : "") + (resp.question || "");
      if (tutorMsg.trim()) addMessage("tutor", tutorMsg);
      if (resp.audioBase64) playBase64Audio(resp.audioBase64);

      if (resp.sessionDone) {
        sessionId = null;
        setStatus("Session terminée ✓");
        addMessage("tutor", "🎉 Session terminée. Vous avez bien progressé.");
        const stopBtn = document.getElementById("dc-stop");
        const startBtn = document.getElementById("dc-start");
        if (recordBtn) recordBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (startBtn) startBtn.disabled = false;
      } else {
        setStatus("Écoutez puis cliquez sur « Répondre ».");
        if (recordBtn) recordBtn.disabled = false;
      }
    } catch (e) {
      if (gen !== submitGeneration || aborted) return;
      console.error(e);
      setStatus("Erreur: " + e.message);
      addMessage("tutor", "❌ " + e.message);
      if (recordBtn) recordBtn.disabled = false;
    } finally {
      if (gen === submitGeneration) isProcessing = false;
    }
  }

  function abortRecognition() {
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
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

  // Vérification SpeechRecognition tôt
  if (!SR) {
    setStatus("Speech Recognition non supporté (Chrome/Edge requis).");
    startBtn.disabled = true;
  }

  speedSelect.addEventListener("change", (e) => {
    playbackSpeed = parseFloat(e.target.value);
    if (currentAudio) currentAudio.playbackRate = playbackSpeed;
  });

  const micSelect = document.getElementById("dc-mic");

  // Charger préférence + énumérer devices
  chrome.storage.local.get(["selectedMicId"], (r) => {
    selectedDeviceId = r.selectedMicId || null;
    if (micSelect) micSelect.value = selectedDeviceId || "";
    refreshDevices();
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
  }

  if (micSelect) {
    micSelect.addEventListener("change", (e) => {
      selectedDeviceId = e.target.value || null;
      chrome.storage.local.set({ selectedMicId: selectedDeviceId });
    });
  }

  function resetAll() {
    aborted = true;
    submitGeneration++;
    sessionStartGen++;
    recordOpGen++;
    silenceRestartCount = 0;
    abortRecognition();
    releaseBindingStream();
    stopAndCleanupAudio();
    discardLiveBubble();
    accumulatedFinal = "";
    currentRecFinal = "";
    currentRecInterim = "";
    isRecording = false;
    isStarting = false;
    isProcessing = false;
    explicitStop = false;
    lastRecognitionError = null;
  }

  closeBtn.addEventListener("click", () => {
    resetAll();
    overlay.style.display = "none";
  });

  startBtn.addEventListener("click", async () => {
    if (!SR) return;
    if (isStarting || isRecording || isProcessing) return;

    startBtn.disabled = true;
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    setStatus("Extraction du texte de la page…", "loading");

    const myGen = ++sessionStartGen;

    try {
      const pageText = extractPageText();
      if (!pageText || pageText.length < 50) {
        throw new Error("Page sans contenu lisible (article/main/body vide).");
      }
      setStatus("Génération de la première question…", "loading");
      aborted = false;
      const resp = await send({ type: "START_SESSION", payload: { pageText } });

      // Race: si reset/Démarrer plus récent → on jette cette réponse
      if (myGen !== sessionStartGen || aborted) return;

      sessionId = resp.sessionId;
      if (resp.question) addMessage("tutor", resp.question);
      if (resp.audioBase64) playBase64Audio(resp.audioBase64);

      setStatus("Écoutez puis cliquez sur « Répondre ».");
      recordBtn.disabled = false;
      stopBtn.disabled = false;
    } catch (e) {
      if (myGen !== sessionStartGen) return;
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
    if (!SR) return;
    if (isStarting || isProcessing) return;

    if (!isRecording) {
      // Démarrage
      const myOpGen = ++recordOpGen;
      isStarting = true;
      recordBtn.disabled = true;
      aborted = false;
      explicitStop = false;
      lastRecognitionError = null;
      accumulatedFinal = "";
      currentRecFinal = "";
      currentRecInterim = "";
      silenceRestartCount = 0;
      createLiveBubble();

      try {
        const r = await createRecognizer(myOpGen);
        // Abort pendant l'install de la langue ?
        if (!r || myOpGen !== recordOpGen || aborted) {
          isStarting = false;
          return;
        }
        isStarting = false;
        isRecording = true;
        recordBtn.textContent = "⏹ Stop";
        recordBtn.disabled = false;
        const mode = recognition?.processLocally ? "local" : "cloud";
        const dev = getDeviceLabel(selectedDeviceId);
        setStatus(`REC ${mode} — ${dev}`, "recording");
      } catch (e) {
        if (myOpGen !== recordOpGen) return;
        console.error(e);
        isStarting = false;
        discardLiveBubble();
        setStatus("Erreur: " + e.message);
        addMessage("tutor", "❌ " + e.message);
        recordBtn.disabled = false;
      }
    } else {
      // Stop explicite
      explicitStop = true;
      isRecording = false;
      recordBtn.disabled = true;
      recordBtn.textContent = "🎙 Répondre";
      setStatus("Traitement…", "loading");
      if (recognition) {
        try {
          recognition.stop();
        } catch (err) {
          console.warn("[DeepCheck] recognition.stop() threw, finalizing:", err);
          // Fallback: finaliser nous-mêmes si stop() crashe
          finalizeAndSubmit();
        }
      } else {
        // Pas de recognizer actif — finaliser direct
        finalizeAndSubmit();
      }
    }
  });

  stopBtn.addEventListener("click", async () => {
    if (isProcessing && !sessionId) return;
    const sid = sessionId;
    resetAll();
    sessionId = null;
    recordBtn.textContent = "🎙 Répondre";
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("Session terminée.");
    addMessage("tutor", "Session terminée. À bientôt !");
    if (sid) {
      try { await send({ type: "STOP_SESSION", payload: { sessionId: sid } }); }
      catch (e) { console.error(e); }
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "TOGGLE_OVERLAY") {
      if (overlay.style.display === "none") {
        overlay.style.display = "flex";
      } else {
        resetAll();
        overlay.style.display = "none";
      }
      sendResponse({ ok: true });
    }
  });
}
