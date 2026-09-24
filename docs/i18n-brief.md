# Traduire l'interface de Minute (consignes)

Minute (app Electron + React + TypeScript, dépôt `C:\Users\adrien.robino\Desktop\minute`) est écrite en français.
On ajoute l'anglais et l'italien avec `src/shared/i18n.ts` :

```ts
import { t, locale } from '<chemin relatif>/shared/i18n';
t('Nouvelle réunion')                        // la clé est la phrase française, exactement
t('Version {v} disponible', { v: version })  // variables entre accolades
new Date(x).toLocaleDateString(locale(), …)  // au lieu de 'fr-FR'
```

## Ce que tu fais, pour chacun de TES fichiers (et seulement ceux-là)

1. Entoure de `t('…')` **chaque texte visible par l'utilisateur** : textes JSX, `title`, `aria-label`,
   `placeholder`, `alt`, messages de toast, erreurs affichées, libellés de menus, notifications système,
   boîtes de dialogue, textes des réglages.
2. Phrases avec des morceaux variables : un seul `t()` avec des `{variables}`, jamais de concaténation de
   morceaux traduits séparément. Pluriel : `n > 1 ? t('{n} réunions', { n }) : t('{n} réunion', { n })`.
3. **Jamais `t()` au niveau du module** (constante évaluée au chargement) : la langue n'est connue qu'ensuite.
   Garde la chaîne française dans la constante et appelle `t(libellé)` au moment d'afficher, ou transforme
   la constante en fonction.
4. Remplace `'fr-FR'` par `locale()` pour les dates, heures et nombres.
5. **Ne traduis pas** : les commentaires, `console.*`, `diagLog(...)`, les noms de classes CSS, les clés et
   identifiants, les noms de marques (Minute, Groq, Claude, Gemini, OpenAI, Teams, Zoom, Meet, Google, Natively,
   whisper.cpp, LM Studio, Ollama, GitHub, Ko-fi), les raccourcis clavier, le contenu envoyé aux IA (prompts).
6. Garde exactement le texte français existant comme clé (apostrophes typographiques ’, espaces insécables,
   « guillemets » compris) : ne réécris pas les phrases françaises.
7. Ajoute chaque nouvelle clé dans `src/shared/locales/en.json` et `src/shared/locales/it.json`
   (la clé est la phrase française, la valeur sa traduction ; mêmes noms de `{variables}`) :
   ```json
   { "Nouvelle réunion": "New meeting" }
   ```
8. Vérifie avec `npx tsc -p tsconfig.json --noEmit` : tes fichiers doivent compiler (d'autres fichiers sont
   modifiés en même temps par d'autres personnes : ignore leurs erreurs éventuelles, ne les touche pas).

## Ton et style

- Anglais : sobre et naturel comme une app Apple, « sentence case » (« New meeting », pas « New Meeting »),
  on s'adresse à l'utilisateur en « you ».
- Italien : naturel et moderne comme les apps Apple en italien, impératif à la 2e personne (« Inserisci », « Scegli »).
- Même longueur que le français quand c'est possible (boutons étroits).

## Glossaire (à respecter partout)

| Français | English | Italiano |
|---|---|---|
| Minute | Minute | Minute |
| réunion | meeting | riunione |
| transcription | transcript (le texte) / transcription (le processus) | trascrizione |
| compte-rendu | summary | resoconto |
| Réglages | Settings | Impostazioni |
| Dynamic Island | Dynamic Island | Dynamic Island |
| pastille (de l'île) | pill | pillola |
| sous-titres | captions | sottotitoli |
| Direct (onglet) | Live | Diretta |
| Notes | Notes | Note |
| Question (onglet) / Demander à la réunion | Ask / Ask the meeting | Domanda / Chiedi alla riunione |
| Rattrapage | Catch-up | Riepilogo |
| Marquer un moment | Mark a moment | Segna un momento |
| Réduire (vers l'île) | Minimize | Riduci |
| Terminer (la réunion) | End | Termina |
| Copier | Copy | Copia |
| Participants / Participant A | Participants / Participant A | Partecipanti / Partecipante A |
| Qui parle / Deviner qui parle | Who's speaking / Guess who's speaking | Chi parla / Indovina chi parla |
| Votre micro / Le son de la visio | Your microphone / Call audio | Il tuo microfono / Audio della chiamata |
| Son de l'ordinateur | Computer audio | Audio del computer |
| Mode confidentiel | Private mode | Modalità riservata |
| Corbeille / Archives | Trash / Archive | Cestino / Archivio |
| Plusieurs langues | Multiple languages | Più lingue |
| clé (d'API) | key | chiave |
| Signaler un problème | Report a problem | Segnala un problema |
| Mise à jour | Update | Aggiornamento |
