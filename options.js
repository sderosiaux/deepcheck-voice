// options.js

const apiKeyInput = document.getElementById("apiKey");
const form = document.getElementById("configForm");
const statusDiv = document.getElementById("status");
const toggleVisibility = document.getElementById("toggleVisibility");

let storedKey = null;

function maskKey(key) {
  if (!key || key.length < 8) return "";
  return `sk-•••••${key.slice(-4)}`;
}

// Charger la clé existante (sans pré-remplir le champ)
chrome.storage.local.get(["openai_api_key"], (result) => {
  if (result.openai_api_key) {
    storedKey = result.openai_api_key;
    apiKeyInput.placeholder = `${maskKey(storedKey)} — clé déjà configurée`;
    apiKeyInput.required = false;
    toggleVisibility.style.display = "none";
  }
});

// Toggle visibilité (utile seulement quand on tape une nouvelle clé)
toggleVisibility.addEventListener("click", () => {
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleVisibility.textContent = "🙈 Masquer la clé";
  } else {
    apiKeyInput.type = "password";
    toggleVisibility.textContent = "👁️ Afficher la clé";
  }
});

apiKeyInput.addEventListener("input", () => {
  // Quand l'utilisateur commence à taper, afficher l'option de visibilité
  toggleVisibility.style.display = apiKeyInput.value.length > 0 ? "block" : "none";
});

function showStatus(message, isSuccess = true) {
  statusDiv.textContent = message;
  statusDiv.className = "status show " + (isSuccess ? "success" : "error");
  setTimeout(() => statusDiv.classList.remove("show"), 3000);
}

function validateApiKey(key) {
  if (!key || key.trim().length === 0) return "La clé API ne peut pas être vide";
  if (!key.startsWith("sk-")) return "La clé API doit commencer par 'sk-'";
  if (key.length < 20) return "La clé API semble trop courte";
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = apiKeyInput.value.trim();

  // Champ vide + clé déjà stockée = pas de modif
  if (!apiKey && storedKey) {
    showStatus("Aucune modification (clé existante conservée)", true);
    return;
  }

  const error = validateApiKey(apiKey);
  if (error) {
    showStatus(error, false);
    return;
  }

  try {
    await chrome.storage.local.set({ openai_api_key: apiKey });
    storedKey = apiKey;
    apiKeyInput.value = "";
    apiKeyInput.type = "password";
    apiKeyInput.placeholder = `${maskKey(storedKey)} — clé déjà configurée`;
    apiKeyInput.required = false;
    toggleVisibility.textContent = "👁️ Afficher la clé";
    toggleVisibility.style.display = "none";
    showStatus("✓ Clé API enregistrée avec succès", true);
    chrome.runtime.sendMessage({ type: "CONFIG_UPDATED" });
  } catch (error) {
    showStatus("Erreur lors de la sauvegarde: " + error.message, false);
  }
});
