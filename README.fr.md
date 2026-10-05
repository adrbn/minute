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

> L’app est signée et notarisée par Apple : elle s’ouvre directement. À la première réunion, autorisez **Microphone** et
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

### Votre propre serveur de transcription (facultatif)

Minute peut transcrire **hors ligne**, sur votre propre serveur de transcription compatible OpenAI : par exemple
[Speaches](https://github.com/speaches-ai/speaches) (faster-whisper) sur un serveur maison avec carte graphique, ou
NVIDIA [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) sur une machine sans carte graphique.
Aucun quota, et l’audio reste chez vous. **Réglages › Transcription › Mode : Hors ligne**, puis adresse, modèle et clé
facultatifs, **Tester**. Seul le mode choisi transcrit : hors ligne, rien ne part chez Groq ; si le serveur ne répond
pas, les phrases attendent son retour. Les réglages et la clé de l’autre mode restent enregistrés : on repasse
**En ligne** (Groq) d’un clic.

Sur l’offre gratuite de Groq, chaque modèle Whisper a son propre quota : quand `whisper-large-v3-turbo` est épuisé,
Minute passe tout seul à `whisper-large-v3`.

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
| Démarrer / terminer une réunion (deux appuis pour terminer) | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>R</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>R</kbd> |
| Marquer un moment | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>M</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>M</kbd> |
| Copier la transcription | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>C</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>C</kbd> |
| Dynamic Island | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>T</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>T</kbd> |

## Vos données

- Les réunions restent **sur votre ordinateur**, dans `Documents/Minute` : un dossier lisible par réunion.
- En mode standard, seul **le son de chaque phrase** part chez Groq pour être transcrit (en mode hors ligne : vers votre
  serveur, et nulle part ailleurs), et seul **le texte** part vers l’IA choisie pour les comptes-rendus. La reconnaissance des voix se fait sur votre ordinateur.
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

## Banc d’essai

Mesuré avec `npm run bench` ([scripts/bench.mjs](scripts/bench.mjs)), qui fait tourner le code de l’app
(appels de transcription, invite, filtre, empreintes vocales CAM++, regroupement des voix) sur quatre réunions du
corpus AMI. **5 octobre 2026 · Apple M1, 16 Go · Minute 0.6.10.** Chiffres publiés tels qu’ils sont sortis.

> **AMI est en anglais : ces chiffres ne disent rien du français.**

**Transcription** (4 réunions, 92 min d’audio, 14 634 mots de référence)

| Moteur | WER | Facteur temps réel |
|---|---|---|
| whisper.cpp turbo (`ggml-large-v3-turbo-q5_0.bin`) | 34,2 % | 0,281 |
| whisper.cpp small (`ggml-small-q5_1.bin`) | 36,5 % | 0,085 |
| Groq `whisper-large-v3-turbo` | non mesuré | non mesuré |

Par réunion (turbo / small) : ES2004a 29,8 / 32,2 % · IS1009a 26,6 / 29,6 % · TS3003a 26,1 / 28,5 % ·
EN2002a 40,5 / 42,5 %.

- **Groq n’a pas été mesuré** : pas de `GROQ_API_KEY` dans l’environnement pour ce passage. Ajoutez-la et relancez.
- **WER** (taux d’erreur sur les mots) = (substitutions + suppressions + insertions) / mots de référence, cumulé sur
  les 4 réunions. Normalisation : minuscules, ponctuation retirée, espaces fusionnés. Rien d’autre : les hésitations
  (« um », « uh »), la parole superposée que le moteur n’écrit pas et les nombres écrits en chiffres comptent comme
  des erreurs.
- **Audio** : la piste Mix-Headset (tous les micros-casques mélangés), envoyée par morceaux de 16 s au plus, coupés
  entre deux mots comme le fait le découpage de l’app, avec l’invite et le filtre de l’app, langue `auto`.
- **Facteur temps réel** = temps de traitement / durée de l’audio envoyé (plus bas = plus rapide). Chargement du
  modèle exclu.
- **whisper.cpp** : le mode local de l’app n’existe que sous Windows (v1.9.2, version processeur). Sur ce Mac, le
  banc pilote le même code `localStt.ts` avec le `whisper-server` 1.9.4 de Homebrew, qui calcule sur la puce
  graphique (Metal). Les vitesses ne valent pas pour un PC Windows.

**Locuteurs** (empreintes CAM++, puis le regroupement `Voices` de l’app avec ses vrais seuils)

| Réunion | Locuteurs réels | Trouvés | Temps de parole bien attribué |
|---|---|---|---|
| ES2004a | 4 | 4 | 80,8 % |
| IS1009a | 4 | 4 | 78,2 % |
| TS3003a | 4 | 5 | 84,3 % |
| EN2002a | 4 | 3 | 60,7 % |

- **Segmentation de référence (oracle)** : les tours de parole annotés sont fournis. On mesure le regroupement des
  voix, pas la détection de la parole. Chaque tour donne une empreinte, passée à `assign`, puis la passe de fin de
  réunion `refine`. La consolidation en cours de réunion (`consolidate`, toutes les 2 minutes) n’est pas rejouée.
- **Attribution** = part du temps de parole donnée à la bonne personne, après la meilleure correspondance un à un
  entre groupes trouvés et locuteurs réels (toutes les affectations sont essayées). Les tours où plusieurs personnes
  parlent en même temps sont pris tels quels.

**Données** : [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), Université d’Édimbourg,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr). Audio Mix-Headset et annotations manuelles v1.6.2
(mots et tours de parole) des réunions de test ES2004a, IS1009a, TS3003a et EN2002a, téléchargés par le script dans
`bench-data/` (ignoré par git, aucun audio dans ce dépôt). Les annotations officielles donnent les mots et les tours
de parole d’une seule source : ni la copie Hugging Face ni des fichiers RTTM séparés n’ont été nécessaires.

## Compiler depuis les sources

```bash
npm install
npm start          # compile et lance
npm test           # tests unitaires
npm run bench      # banc d’essai (télécharge ~200 Mo d’audio AMI + modèles whisper.cpp)
npm run dist:win   # installateur Windows → release/
```

Pousser un tag `v*` compile Windows et macOS sur GitHub Actions et publie la version, avec les fichiers que lit la
mise à jour automatique. Electron · React · TypeScript · Silero VAD et CAM++ (ONNX, WebAssembly) · whisper.cpp.
Composants tiers : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

[MIT](LICENSE) © 2026 Adrien Robino
