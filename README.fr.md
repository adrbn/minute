<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Icône de Minute" />

# Minute

### Vos réunions, transcrites en direct.

Minute écrit chaque mot pendant que les gens parlent encore, et sait qui a dit quoi.<br/>
Copiez n’importe quel passage, rattrapez ce que vous avez manqué, posez une question à la réunion, obtenez le compte-rendu. Sans quitter votre appel.

<br/>

<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-Setup-Windows.exe"><img src="docs/images/telecharger-windows.png" width="290" height="50" alt="Télécharger pour Windows" /></a>
&nbsp;
<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-arm64.dmg"><img src="docs/images/telecharger-macos.png" width="276" height="50" alt="Télécharger pour macOS" /></a>

<sub>Windows 10 et 11 · macOS 14.2 ou plus récent (<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-x64.dmg">Mac Intel</a>) · Gratuit et open source · <a href="README.md">Read in English</a></sub>

[![Dernière version](https://img.shields.io/github/v/release/adrbn/minute?label=version&color=3558A2)](https://github.com/adrbn/minute/releases/latest)
[![Windows et macOS](https://img.shields.io/badge/Windows%20%C2%B7%20macOS-3558A2)](#installer)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-3558A2)](LICENSE)

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" width="900" alt="Minute : une réunion transcrite en direct, chaque voix dans sa couleur, le compte-rendu à côté, et la Dynamic Island au premier plan" />
</picture>

</div>

## Le problème

La plupart des outils de prise de notes vous font attendre la fin de la réunion pour voir une seule ligne. D’ici là,
impossible de copier ce qui vient d’être décidé ou de vérifier un chiffre, et si vous avez décroché deux minutes,
c’est perdu.

Minute écrit la transcription **pendant** la réunion, environ une seconde après chaque phrase. Il capte le microphone
et l’audio système comme deux sources distinctes : il fonctionne avec Teams, Zoom, Meet ou toute autre application,
sans ajouter de robot à l’appel.

## Ce que fait Minute

**La transcription en direct, avec qui parle.** Chaque voix est reconnue à son timbre, sur votre ordinateur, et
reçoit sa couleur. Cliquez sur une voix pour la nommer, ou laissez **Deviner qui parle** s’en charger d’après la
conversation (« Priya, tu peux… » → c’est Priya qui répond).

**Plusieurs langues dans la même réunion.** Français, anglais, italien… chaque phrase reste dans sa langue.

**La Dynamic Island.** Pendant la réunion, la fenêtre s’efface : une pastille flottante affiche la dernière phrase.
Ouvrez-la pour les sous-titres, des notes rapides et vos questions, sans revenir dans Minute.

<div align="center">
<img src="docs/images/island.png" width="380" alt="La Dynamic Island : en pastille avec la dernière phrase, et ouverte avec les sous-titres" />
</div>

**Rattraper, demander, résumer.** « Qu’est-ce que j’ai raté ? » résume les 2, 5 ou 10 dernières minutes en quelques
points, en commençant par ce qui vous concerne. « Qu’a-t-on décidé pour le budget ? » répond avec des liens vers les
moments exacts, même dans une réunion de deux heures. À la fin : résumé, décisions, actions, points clés, questions
ouvertes et e-mail de suivi.

**Tout copier, à tout moment.** Toute la réunion, les 5 ou 10 dernières minutes, ou depuis un moment marqué, en
texte brut ou mis en forme pour Outlook, Word ou Teams.

**Votre agenda.** Google Agenda ou n’importe quel lien iCal : la prochaine réunion est prête à transcrire, avec son
titre et ses participants. Minute peut vous prévenir 10 et 5 minutes avant.

**Mode confidentiel.** Pour les réunions sensibles (Windows) : la transcription se fait à 100 % sur votre ordinateur,
toute connexion extérieure est bloquée, aucun son n’est gardé, et les réunions sont supprimées après la durée de
conservation que vous choisissez.

<div align="center">
<img src="docs/images/private-mode.png" width="600" alt="Réglages › Confidentialité : le mode confidentiel et ce qu’il garantit" />
</div>

**Et les détails.** Recherche dans toutes vos réunions · archives et corbeille de 30 jours · fusionner ou séparer
des réunions · 9 thèmes de couleur, clair et sombre · mises à jour automatiques (jamais pendant une réunion) ·
signaler un problème en un clic · interface en français, anglais et italien.

## Installer

**Windows 10 ou 11** : téléchargez [`Minute-Setup-Windows.exe`](https://github.com/adrbn/minute/releases/latest/download/Minute-Setup-Windows.exe)
et lancez-le. Il s’installe pour votre compte, sans droits d’administrateur.

> Windows peut afficher « Windows a protégé votre ordinateur » (l’app n’est pas encore signée avec un certificat
> payant) : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.

**macOS 14.2 ou plus récent** : téléchargez le `.dmg` de votre Mac
([Apple Silicon](https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-arm64.dmg) ou
[Intel](https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-x64.dmg)) et glissez Minute dans
**Applications**.

> La première fois, clic droit sur Minute › **Ouvrir**. Si macOS dit que l’app est endommagée, lancez
> `xattr -cr /Applications/Minute.app` dans le Terminal. À la première réunion, autorisez **Microphone** et
> **Enregistrement audio du système**.

## Démarrer

1. **Créez une clé Groq gratuite** (une minute, voir plus bas) et collez-la quand Minute la demande.
2. Vérifiez que le vumètre du microphone réagit.
3. Cliquez sur le bouton rouge, ou utilisez le raccourci global <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>R</kbd>.

En cours de réunion, le bouton **Réduire** passe la fenêtre en Dynamic Island.

## Clés et connexions

Minute n’a ni serveur ni compte : il utilise **vos** clés, gardées chiffrées par votre système (DPAPI sous Windows,
Trousseau sous macOS). Une seule est obligatoire.

### Groq : la transcription (gratuit)

1. Allez sur **[console.groq.com](https://console.groq.com)** et connectez-vous.
2. Ouvrez **API Keys › Create API Key**, nommez-la « Minute », validez.
3. Copiez la clé (elle commence par `gsk_`) : elle ne sera plus affichée.
4. Dans Minute : **Réglages › Transcription › Clé Groq**, collez, **Enregistrer**. Un ✓ confirme qu’elle marche.

L’offre gratuite permet 20 requêtes par minute et environ deux heures d’audio par heure ; Minute gère ce budget
pour vous. Au pire, les phrases arrivent avec quelques secondes de retard, rien n’est jamais perdu. La même clé
rédige aussi les comptes-rendus.

### Comptes-rendus avec une autre IA (facultatif)

Choisissez le fournisseur dans **Réglages › Intelligence** et collez sa clé :

| Fournisseur | Où obtenir une clé | Bon à savoir |
|---|---|---|
| **Groq** | déjà fait | Gratuit et rapide. Par défaut. |
| **Claude** (Anthropic) | [console.anthropic.com › API Keys](https://console.anthropic.com/settings/keys) | La meilleure qualité de rédaction. Payant à l’usage (quelques centimes par compte-rendu). |
| **Gemini** (Google) | [aistudio.google.com › Get API key](https://aistudio.google.com/apikey) | Offre gratuite généreuse, contexte très long. |
| **OpenAI** | [platform.openai.com › API keys](https://platform.openai.com/api-keys) | Modèles GPT. Payant à l’usage. |

### Google Agenda

**Le plus simple : un lien iCal** (lecture seule, rien à configurer chez Google). Dans Google Agenda :
**Paramètres › [votre agenda] › Intégrer l’agenda › Adresse secrète au format iCal**. Copiez-la, puis dans Minute :
**Réglages › Agenda › Lien iCal**. Pour Outlook : **Paramètres › Calendrier › Calendriers partagés › Publier un
calendrier**, et copiez le lien **ICS**.

**Avec « Se connecter avec Google »** (organisations où les liens secrets sont désactivés) : un administrateur crée
une fois un client OAuth pour tout le monde.

1. [console.cloud.google.com](https://console.cloud.google.com) › **Nouveau projet** (« Minute »).
2. **API et services › Bibliothèque** › *Google Calendar API* › **Activer**.
3. **API et services › Écran de consentement OAuth** : **Interne** (Google Workspace), ou **Externe** avec vos
   adresses en utilisateurs test pour un compte Gmail. Ajoutez le champ d’application `…/auth/calendar.events.readonly`.
4. **Identifiants › Créer des identifiants › ID client OAuth** › **Application de bureau** › **Créer**.
5. Copiez l’**ID client** et le **code secret** ; dans Minute : **Réglages › Agenda › Avancé**, collez,
   **Enregistrer**, puis **Se connecter avec Google**.

Minute lit seulement vos événements (titre, horaires, participants, lien de l’appel), rien d’autre dans votre compte.

### Mode confidentiel (sans clé)

**Réglages › Confidentialité.** Minute télécharge une fois le moteur open source
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (environ 570 Mo, ou 200 Mo pour le modèle rapide), puis
bloque toute connexion extérieure. Pour les comptes-rendus, installez [LM Studio](https://lmstudio.ai) ou
[Ollama](https://ollama.com) : Minute les trouve tout seul.

> La transcription locale demande un ordinateur récent. Sur un processeur de bureau sans carte graphique dédiée,
> choisissez le modèle **Rapide** pour suivre le rythme de la parole.

## Raccourcis clavier

| | Windows | macOS |
|---|---|---|
| Démarrer / terminer une réunion (deux appuis pour terminer) | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>R</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>⌘</kbd><kbd>R</kbd> |
| Marquer un moment | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>M</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>⌘</kbd><kbd>M</kbd> |
| Copier la transcription | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>C</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>⌘</kbd><kbd>C</kbd> |
| Dynamic Island | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>T</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>⌘</kbd><kbd>T</kbd> |

## Vos données

- Les réunions restent **sur votre ordinateur**, dans `Documents/Minute` : un dossier lisible par réunion.
- En mode standard, seul **le son de chaque phrase** part chez Groq pour être transcrit, et seul **le texte** part
  vers l’IA choisie pour les comptes-rendus. La reconnaissance des voix se fait sur votre ordinateur.
- Aucune télémétrie, aucun compte, aucun serveur Minute.
- Pour les organisations : une [note RGPD pour votre délégué à la protection des données](docs/RGPD.md).

## Questions fréquentes

<details>
<summary><b>L’anglais est traduit en français dans ma transcription</b></summary>

Réglez **Réglages › Transcription › Langue des réunions** sur **Plusieurs langues (détection)**, le réglage par
défaut : chaque phrase reste dans sa langue.
</details>

<details>
<summary><b>Rien ne s’affiche pour les autres participants</b></summary>

Vérifiez que **Audio système** est activé sur l’écran d’accueil. Sous macOS, autorisez **Enregistrement audio
du système** dans *Réglages Système › Confidentialité et sécurité*.
</details>

<details>
<summary><b>La Dynamic Island apparaît-elle quand je partage mon écran ?</b></summary>

Non par défaut : elle est masquée des partages d’écran et des captures. Pour l’afficher, désactivez
**Réglages › Mode compact › Masquer des partages d’écran et captures**.
</details>

<details>
<summary><b>J’ai supprimé une réunion par erreur</b></summary>

Elle est dans la **Corbeille** (en bas de la barre latérale) pendant 30 jours : clic droit › **Restaurer**.
</details>

## Soutien et retours

Minute est gratuit, open source et fait sur mon temps libre. S’il vous fait gagner du temps,
[**offrez-moi un café sur Ko-fi**](https://ko-fi.com/adrbn) ☕

- **Un problème ?** Dans Minute : **Réglages › À propos › Signaler un problème** prépare un ticket GitHub pour vous,
  avec un journal technique (jamais le contenu de vos réunions). Ou [ouvrez un ticket](https://github.com/adrbn/minute/issues/new/choose).
- **Une idée ?** [Proposez-la](https://github.com/adrbn/minute/issues/new?template=feature_request.yml).

## Compiler depuis les sources

```bash
npm install
npm start          # compile et lance
npm test           # tests unitaires
npm run dist:win   # installateur Windows → release/
```

Pousser un tag `v*` compile Windows et macOS sur GitHub Actions et publie la version, avec les fichiers que lit la
mise à jour automatique. Electron · React · TypeScript · Silero VAD et CAM++ (ONNX, WebAssembly) · whisper.cpp.
Composants tiers : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

[MIT](LICENSE) © 2026 Adrien Robino
