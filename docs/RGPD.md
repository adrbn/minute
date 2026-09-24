# Minute et le RGPD — note pour le délégué à la protection des données

Minute transcrit des réunions (micro de l'utilisateur et son de l'ordinateur) et peut en rédiger
un compte-rendu. Cette note décrit les données traitées, où elles vont et comment l'application
aide à respecter le RGPD. Elle distingue le **mode standard** et le **mode confidentiel**.

## Données traitées

| Donnée | Où elle est stockée | Durée |
|---|---|---|
| Transcription (texte, horodatage, voix distinguées) | Sur l'ordinateur de l'utilisateur, `Documents/Minute/` | Jusqu'à suppression ; en mode confidentiel, effacement automatique (7, 30, 90 jours ou 1 an) |
| Audio des phrases | Sur l'ordinateur, le temps de la transcription | Mode standard : conservé 30 jours par défaut (réglable, ou 0) ; mode confidentiel : **effacé dès la transcription** |
| Empreintes de voix (« qui parle ») | Sur l'ordinateur, dans le dossier de la réunion | Supprimées avec la réunion ; calculées localement, jamais envoyées |
| Notes, comptes-rendus | Sur l'ordinateur | Supprimés avec la réunion |
| Clés d'API | Chiffrées par le système (DPAPI Windows / Trousseau macOS) | Jusqu'à suppression par l'utilisateur |

Aucune donnée n'est envoyée à l'auteur de Minute : pas de compte, pas de télémétrie, pas de serveur Minute.

## Mode standard

- **Transcription** : l'audio de chaque phrase est envoyé à **Groq** (États-Unis), avec la clé de
  l'utilisateur. Groq est un sous-traitant ; vérifier le cadre contractuel (DPA, transferts hors UE).
- **Comptes-rendus** : le texte est envoyé au fournisseur d'IA choisi (Groq, Anthropic, Google
  ou OpenAI) avec la clé de l'utilisateur.
- **Agenda** : lecture seule des événements (Google Agenda ou lien iCal) pour titrer les réunions.

## Mode confidentiel (Windows)

Activable dans Réglages › Confidentialité. Une fois actif :

1. **Transcription locale** : le moteur open source whisper.cpp tourne sur l'ordinateur
   (serveur n'écoutant que `127.0.0.1`). L'audio ne quitte pas la machine.
2. **Verrou réseau** : toute connexion sortante hors de l'ordinateur est refusée par l'application
   (processus principal et fenêtres). Seul `127.0.0.1` / `localhost` reste joignable.
3. **Pas d'audio conservé** : l'extrait audio est effacé dès que la phrase est transcrite.
4. **Durée de conservation** : les réunions plus anciennes que la durée choisie sont supprimées
   définitivement (hors corbeille), sauf celles que l'utilisateur épingle.
5. **IA** : uniquement une IA installée sur l'ordinateur (Ollama ou LM Studio). Sans elle, pas de
   compte-rendu automatique ; la transcription fonctionne.

Le moteur et le modèle sont téléchargés une seule fois, avant l'activation, depuis leurs sources
officielles (GitHub `ggml-org/whisper.cpp`, Hugging Face `ggerganov/whisper.cpp`), et leur
empreinte SHA-256 est vérifiée.

## Information des participants

Enregistrer une réunion suppose d'en informer les participants (articles 13 et 14 du RGPD) et de
reposer sur une base légale (intérêt légitime pour un compte-rendu interne, ou consentement).
Minute fournit un **message prêt à coller** dans la conversation de la visio (Réglages ›
Confidentialité › Informer les participants), qui indique l'outil, le traitement local ou non,
et la possibilité de s'y opposer.

## Points d'attention

- Réunions RH, médicales ou portant sur des données sensibles (article 9) : utiliser le mode
  confidentiel et une durée de conservation courte.
- La séparation des voix produit des données biométriques au sens large (empreintes vocales) :
  elles restent locales, liées à une réunion et supprimées avec elle ; l'option peut être
  désactivée (Réglages › Transcription › Distinguer les intervenants).
- Poste de travail : le chiffrement du disque (BitLocker) protège les réunions stockées.
