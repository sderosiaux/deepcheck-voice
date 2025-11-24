# DeepCheck Voice - Extension Chrome de Tuteur Vocal

Extension Chrome qui transforme n'importe quelle page web en session de tutorat vocal interactive.

## Fonctionnalités

- **Extraction automatique** du contenu de la page
- **Transcription vocale** avec GPT-4o-transcribe
- **Tuteur intelligent** avec GPT-5-mini
- **Synthèse vocale** naturelle
- **Interface minimaliste** et intuitive

## Architecture

### Modèles utilisés

1. **gpt-4o-transcribe** - Transcription de votre voix en texte
2. **gpt-5-mini** - Logique du tuteur pédagogique
3. **gpt-4o-mini-tts** - Synthèse vocale (Text-to-Speech)

### Fichiers

- `manifest.json` - Configuration Chrome MV3
- `background.js` - Service worker avec appels OpenAI API
- `popup.html` - Interface utilisateur
- `popup.js` - Logique UI, enregistrement et lecture audio

## Installation

### 1. Chargement dans Chrome

1. Ouvrez Chrome et allez sur `chrome://extensions/`
2. Activez le "Mode développeur" (coin supérieur droit)
3. Cliquez sur "Charger l'extension non empaquetée"
4. Sélectionnez le dossier `chrome-ext-tutor`

### 2. Configuration de la clé API

1. Cliquez sur l'icône de l'extension dans la barre d'outils Chrome
2. Si aucune clé n'est configurée, un message s'affiche
3. Cliquez sur "Ouvrir la configuration" ou faites clic-droit sur l'icône > "Options"
4. Entrez votre clé API OpenAI (obtenue sur [platform.openai.com/api-keys](https://platform.openai.com/api-keys))
5. Cliquez sur "Enregistrer"

La clé est stockée localement dans votre navigateur de manière sécurisée via `chrome.storage.local`.

## Utilisation

1. **Naviguez** vers une page web avec du contenu texte
2. **Cliquez** sur l'icône de l'extension dans la barre d'outils
3. **Démarrer la session** - Le tuteur analyse la page et pose une question
4. **Écoutez** la question posée par le tuteur
5. **Répondre** - Cliquez sur le bouton micro et donnez votre réponse à voix haute
6. **Stop** - Arrêtez l'enregistrement pour soumettre votre réponse
7. Le tuteur analyse votre réponse, donne un feedback et pose une nouvelle question

## Fonctionnement

### Flux de session

```
Page → Extraction texte → GPT-5-mini (1ère question) → TTS
     ↓
Votre réponse → GPT-4o-transcribe → GPT-5-mini (analyse) → TTS
     ↓
Boucle jusqu'à maîtrise du concept ou fin de session
```

### Format des réponses du tuteur

Le tuteur répond toujours en JSON :

```json
{
  "feedback": "Feedback court sur votre réponse",
  "question": "Nouvelle question pour approfondir",
  "mastery_score": 0.7,
  "session_done": false
}
```

## Système de prompt

Le tuteur suit une approche pédagogique stricte :

1. Vérifie la compréhension d'un concept
2. Écoute et analyse votre réponse
3. Donne un feedback court (1-2 phrases)
4. Pose une nouvelle question
5. Reste sur le même concept si pas clair
6. Change d'angle si la réponse est floue
7. Passe au concept suivant seulement si maîtrise confirmée

## Permissions

- `activeTab` - Accès à l'onglet actif pour extraire le texte
- `scripting` - Injection de script pour lire le DOM
- `storage` - Stockage local (sessions)
- `https://api.openai.com/*` - Appels API OpenAI

## Limites et notes

- Limite de 12000 caractères du texte de page (optimisation tokens)
- Format audio : WebM pour l'enregistrement, MP3 pour la lecture
- Language : Français uniquement
- Nécessite une connexion internet active
- Nécessite l'autorisation d'accès au microphone

## Développement

### Structure du code

**background.js** :
- Gestion des sessions (stockage en mémoire)
- Appels API OpenAI (transcription, chat, TTS)
- Conversion base64 pour compatibilité MV3

**popup.js** :
- Gestion de l'enregistrement audio (MediaRecorder)
- Lecture audio (Audio API)
- Communication avec le service worker
- Mise à jour de l'interface

### Debug

1. Ouvrez Chrome DevTools sur la popup : clic droit sur l'icône → Inspecter
2. Service worker : `chrome://extensions/` → DeepCheck Voice → "Inspecter les vues"
3. Console pour voir les erreurs et logs

## Améliorations possibles

- [ ] Historique des sessions
- [ ] Export des transcriptions
- [ ] Choix de la voix TTS
- [ ] Support multilingue
- [ ] Mode Realtime API pour latence réduite
- [ ] Visualisation du mastery_score
- [ ] Sauvegarde locale avec chrome.storage

## License

MIT
