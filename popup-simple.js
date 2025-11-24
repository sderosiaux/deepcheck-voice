// popup-simple.js

const openOverlayBtn = document.getElementById("openOverlay");
const configNotice = document.getElementById("configNotice");
const mainControls = document.getElementById("mainControls");
const openConfigBtn = document.getElementById("openConfig");

// Vérifier si la clé API est configurée au chargement
async function checkApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  if (!result.openai_api_key) {
    configNotice.classList.remove("hidden");
    mainControls.style.opacity = "0.3";
    openOverlayBtn.disabled = true;
    return false;
  }
  return true;
}

// Ouvrir la page de configuration
openConfigBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Ouvrir l'overlay sur la page active
openOverlayBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Erreur:", chrome.runtime.lastError);
    }
    // Fermer la popup
    window.close();
  });
});

// Vérifier au chargement
checkApiKey();
