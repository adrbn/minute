# Composants tiers

Minute est une application originale. Elle s'appuie sur ces composants open source :

| Composant | Rôle | Licence |
|---|---|---|
| [Electron](https://www.electronjs.org/) | application de bureau | MIT |
| [React](https://react.dev/) | interface | MIT |
| [Silero VAD](https://github.com/snakers4/silero-vad) (modèle v5) | détection de parole | MIT |
| [3D-Speaker — CAM++](https://github.com/modelscope/3D-Speaker) (`speech_campplus_sv_en_voxceleb_16k`), export ONNX de [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | empreinte de voix (qui parle ?) | Apache-2.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | exécution des modèles Silero et CAM++ | MIT |
| [AudioTee](https://github.com/makeusabrew/audiotee) — © 2025 Nick Payne | capture du son système sous macOS | MIT |
| [Lucide](https://lucide.dev/) | icônes | ISC |
| [docx](https://github.com/dolanmiu/docx) | export Word | MIT |
| [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) | comptes-rendus avec Claude (optionnel) | MIT |

Services externes (avec la clé API de l'utilisateur) : Groq (transcription Whisper, IA),
et au choix Anthropic, Google Gemini ou OpenAI pour les comptes-rendus.
