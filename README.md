# Minute

**Vos réunions, transcrites en direct.** Ce que vous dites (« Moi ») et ce que disent les autres
(« Eux » : Teams, Meet, Zoom…) s'affichent au fil de la conversation. Vous pouvez tout copier,
chercher ou résumer **pendant** la réunion, sans attendre la fin.

Windows 10/11 et macOS 14.2+ (Apple Silicon et Intel).

## Ce que Minute fait pour vous

| | |
|---|---|
| **Transcription en direct** | Micro et son de l'ordinateur captés séparément, texte provisoire pendant qu'on parle, puis définitif (environ 1 s après la fin de la phrase). |
| **Qui parle ? (bêta)** | Chaque voix est reconnue à son timbre, sur l'ordinateur : pastilles de couleur Ⓐ Ⓑ Ⓒ, un clic pour nommer (« Laura »). **Deviner qui parle** propose les prénoms d'après la conversation (« Elsa, tu peux… » → c'est B qui répond). |
| **Copier à tout moment** | Tout, les 5 ou 10 dernières minutes, depuis le dernier moment marqué… En texte **et** mis en forme (collage propre dans Outlook, Word, Teams). Raccourci global : `Ctrl+Alt+C` / `⌃⌥⌘C`. |
| **Moments marqués ★** | `Ctrl+Alt+M` / `⌃⌥⌘M` pendant la réunion : le passage est repéré et repris dans le compte-rendu. |
| **Notes** | Prenez quelques notes à côté de la transcription : le compte-rendu s'articule autour d'elles. |
| **« Vous avez décroché ? »** | Rattrapage des 2, 5 ou 10 dernières minutes en un clic, en signalant d'abord si on attend quelque chose de vous. |
| **Demander à la réunion** | « Qu'a-t-on décidé pour le budget ? » : réponse avec renvoi aux moments précis — même sur une réunion de 2 h (seuls les passages utiles sont relus). |
| **Compte-rendu automatique** | À la fin : titre, en bref, décisions, actions (cases à cocher), points clés, questions ouvertes. Puis l'**e-mail de suivi** en un clic. |
| **Dynamic Island** | Bouton **Réduire** (ou `Ctrl+Alt+T` / `⌃⌥⌘T`, ou réduire la fenêtre pendant une réunion) : la fenêtre s’efface au profit d’une île flottante. En pastille, la dernière phrase défile en direct (et un problème s’affiche en clair). Dépliée : **Direct** (sous-titres), **Notes**, **Question** — sans rouvrir l’app. Posée où l’on veut, aimantée près des bords, lancée d’un geste vers un coin ; redimensionnable par ses coins. Ne vole jamais le focus à la visio ; masquable des partages d’écran (réglage). |
| **Historique et recherche** | Toutes les réunions, recherche plein texte insensible aux accents, saut direct au passage. |
| **Réécouter** | Clic sur l'horodatage d'un passage (audio conservé 30 jours par défaut). |
| **Corriger** | Double-clic sur une phrase pour la corriger. Vocabulaire personnalisé (noms, sigles) pour que Whisper les écrive juste. |
| **Rien ne se perd** | Chaque phrase est écrite sur le disque dès qu'elle existe ; coupure réseau ou crash : l'audio est gardé et transcrit ensuite. |
| **Import Natively** | Reprend l'historique Natively (transcriptions + comptes-rendus), sans modifier Natively. |
| **Exports** | Word (.docx), Markdown, texte. |

## Installer

- **Windows** : lancer `Minute-x.y.z-Windows.exe`. Installation pour l'utilisateur, sans droits administrateur.
  L'app n'étant pas signée, Windows peut afficher « Windows a protégé votre ordinateur » :
  **Informations complémentaires › Exécuter quand même**.
- **macOS** : ouvrir le `.dmg` (arm64 = Apple Silicon, x64 = Intel), glisser Minute dans Applications.
  - Build **non signé** : au premier lancement, clic droit › **Ouvrir** ou, si macOS dit l'app « endommagée » :
    `xattr -cr /Applications/Minute.app`.
  - Au premier enregistrement, accepter **Micro** et **Enregistrement audio du système**.

## Premier lancement

1. Clé **Groq** (gratuite) : <https://console.groq.com/keys> › *Create API Key*. Elle est chiffrée par le
   système (DPAPI sous Windows, Trousseau sous macOS).
2. Choisir le micro, vérifier que la barre de niveau bouge.
3. (Optionnel) Importer l'historique Natively.

Pour les comptes-rendus, la clé Groq suffit. On peut aussi choisir **Claude**, **Gemini** ou **OpenAI** dans
*Réglages › Intelligence*.

## Confidentialité

Les réunions sont stockées **sur votre ordinateur**, dans `Documents/Minute` (un dossier lisible par
réunion). Seul l'audio des phrases part chez Groq pour être transcrit. Seul le texte part chez le
fournisseur d'IA choisi pour les comptes-rendus. La reconnaissance des voix est calculée **sur l'ordinateur**
(modèle CAM++, rien n'est envoyé).

## Limites de l'offre gratuite Groq

20 requêtes/min et 2 h d'audio facturé par heure. Minute découpe la parole en phrases de 3 à 16 s et
gère ce budget automatiquement : les aperçus instantanés passent après les transcriptions définitives. En
cas de limite, les phrases arrivent avec un peu de retard, **sans perte**. Avec un compte Groq payant,
Minute le détecte et lève le frein.

---

## Développement

```bash
npm install
npm start          # build + lancement
npm test           # tests de la logique (filtres, découpage, écho…)
npm run typecheck
npm run dist:win   # installeur Windows → release/
```

Tester sans clé Groq : `npm run mock:groq`, puis lancer l'app avec
`MINUTE_GROQ_BASE=http://127.0.0.1:8765/openai/v1`.
`MINUTE_PROFILE_DIR` et `MINUTE_STORAGE` isolent un profil de test.

### Architecture

```
src/
  main/        process principal (Node)
    recorder.ts   file de transcription persistante, budget Groq, écho, reprise après crash
    groq.ts       client Whisper + budget (RPM / secondes d'audio)
    filters.ts    hallucinations Whisper, écho micro, prompt de contexte
    store.ts      dossiers de réunion (meeting.json + transcript.jsonl en ajout seul)
    ai.ts, llm.ts comptes-rendus / rattrapage / questions (Groq, Claude, Gemini, OpenAI)
    macAudio.ts   son système macOS via AudioTee
    natively.ts   import de l'historique Natively (lecture seule)
  renderer/
    engine/    fenêtre invisible : capture micro + son système, Silero VAD, découpage en phrases
    app/       interface principale (React)
    mini/      mode compact (Dynamic Island + panneau de sous-titres)
  main/compact.ts  fenêtre compacte : modes exclusifs, lancer façon PiP, morphing ancré
  shared/      types et mise en forme communs (ce qu'on voit = ce qu'on copie)
```

- **Son de l'ordinateur** : Windows via la boucle système de Chromium (`getDisplayMedia` + `loopback`,
  sans sélecteur) ; macOS via [AudioTee](https://github.com/makeusabrew/audiotee) (Core Audio Taps),
  compilé en binaire universel par la CI.
- **Découpage** : Silero VAD v5 (ONNX, WASM) sur des trames de 32 ms. Plus la phrase est longue, plus
  la coupure sur une pause courte devient probable ; au-delà de 16 s, coupure au creux de parole le plus net.

### Build macOS

Le Mac ne peut pas être compilé depuis Windows. Le workflow `.github/workflows/build.yml` le fait sur
GitHub (onglet *Actions › Build › Run workflow*, ou tag `v*` pour publier une release).
Pour une app **signée et notarisée** (installation sans alerte chez des collègues), ajouter dans les
secrets du dépôt : `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` (certificat *Developer ID Application*),
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Il faut un compte Apple Developer (99 $/an).

Composants tiers : voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
