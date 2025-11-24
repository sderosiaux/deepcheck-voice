// options.js

const apiKeyInput = document.getElementById("apiKey");
const form = document.getElementById("configForm");
const statusDiv = document.getElementById("status");
const toggleVisibility = document.getElementById("toggleVisibility");

// Charger la clé existante au démarrage
chrome.storage.local.get(["openai_api_key"], (result) => {
  if (result.openai_api_key) {
    apiKeyInput.value = result.openai_api_key;
  }
});

// Toggle visibilité du mot de passe
toggleVisibility.addEventListener("click", () => {
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleVisibility.textContent = "🙈 Masquer la clé";
  } else {
    apiKeyInput.type = "password";
    toggleVisibility.textContent = "👁️ Afficher la clé";
  }
});

// Afficher un message de statut
function showStatus(message, isSuccess = true) {
  statusDiv.textContent = message;
  statusDiv.className = "status show " + (isSuccess ? "success" : "error");

  setTimeout(() => {
    statusDiv.classList.remove("show");
  }, 3000);
}

// Validation basique de la clé API
function validateApiKey(key) {
  if (!key || key.trim().length === 0) {
    return "La clé API ne peut pas être vide";
  }

  if (!key.startsWith("sk-")) {
    return "La clé API doit commencer par 'sk-'";
  }

  if (key.length < 20) {
    return "La clé API semble trop courte";
  }

  return null;
}

// Sauvegarder la configuration
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();

  // Validation
  const error = validateApiKey(apiKey);
  if (error) {
    showStatus(error, false);
    return;
  }

  try {
    // Sauvegarder dans le storage local
    await chrome.storage.local.set({ openai_api_key: apiKey });

    showStatus("✓ Clé API enregistrée avec succès", true);

    // Notifier le background script que la clé a changé
    chrome.runtime.sendMessage({ type: "CONFIG_UPDATED" });
  } catch (error) {
    showStatus("Erreur lors de la sauvegarde: " + error.message, false);
  }
});
