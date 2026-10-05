<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Minute icon" />

# Minute

### Your meetings, transcribed live.

Minute writes down every word while people are still talking — and knows who said what.<br/>
Copy any part, catch up on what you missed, ask the meeting a question, get the summary. Without leaving your call.

<br/>

<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-Setup-Windows.exe"><img src="docs/images/download-windows.png" width="260" height="50" alt="Download for Windows" /></a>
&nbsp;
<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-arm64.dmg"><img src="docs/images/download-macos.png" width="247" height="50" alt="Download for macOS" /></a>

<sub>Windows 10 and 11 · macOS 14.2 or later (<a href="https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-x64.dmg">Intel Mac</a>) · Free and open source · <a href="README.fr.md">Lire en français</a></sub>

[![Latest release](https://img.shields.io/github/v/release/adrbn/minute?label=release&color=3558A2)](https://github.com/adrbn/minute/releases/latest)
[![Windows and macOS](https://img.shields.io/badge/Windows%20%C2%B7%20macOS-3558A2)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-3558A2)](LICENSE)

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" width="900" alt="Minute: a meeting transcribed live, each voice in its own colour, the summary alongside, and the Dynamic Island floating in front" />
</picture>

</div>

## The problem

Most note-takers make you wait until the meeting is over to see a single line. Until then you can't copy
what was just decided, you can't check a figure, and if your mind wandered for two minutes, it's gone.

Minute writes the transcript **during** the meeting, about a second after each sentence. It captures your
microphone and the system audio as two separate sources, so it works with Teams, Zoom, Meet or any other app,
without adding a bot to the call.

## What it does

**Live transcript, with who's speaking.** Every voice is recognised by its timbre, on your computer, and gets
its own colour. Click a voice to name it — or let **Guess who's speaking** work it out from the conversation
("Priya, can you…" → it's Priya who answers).

**Several languages in one meeting.** French, English, Italian… each sentence stays in the language it was spoken in.

**The Dynamic Island.** During a meeting the window steps aside: a floating pill shows the last sentence. Open it for
live captions, quick notes and questions — without bringing Minute back.

<div align="center">
<img src="docs/images/island.png" width="380" alt="The Dynamic Island: as a pill with the latest sentence, and open with live captions" />
</div>

**Catch up, ask, summarise.** "What did I miss?" gives you the last 2, 5 or 10 minutes in a few bullets, starting with
anything that needs you. "What did we decide about the budget?" answers with links to the exact moments — even in a
two-hour meeting. At the end: summary, decisions, action items, key points, open questions, and the follow-up email.

**Copy anything, any time.** The whole meeting, the last 5 or 10 minutes, or since a marked moment — as plain text
or formatted for Outlook, Word or Teams.

**Your calendar.** Google Calendar or any iCal link: the next meeting is ready to record, with its title and attendees.
Minute can remind you 10 and 5 minutes before.

**Private mode.** For sensitive meetings (Windows): transcription runs 100 % on your computer, every outside
connection is blocked, no audio is kept, and meetings are deleted after the retention period you choose.

<div align="center">
<img src="docs/images/private-mode.png" width="600" alt="Settings › Privacy: private mode and what it guarantees" />
</div>

**And the details.** Search across all your meetings · archive and a 30-day trash · merge or split meetings ·
9 colour themes, light and dark · automatic updates (never during a meeting) · report a problem in one click ·
English, French and Italian interface.

## Install

**Windows 10 or 11** — download [`Minute-Setup-Windows.exe`](https://github.com/adrbn/minute/releases/latest/download/Minute-Setup-Windows.exe)
and run it. It installs for your account, no admin rights needed.

> Windows may say "Windows protected your PC" (the app isn't signed with a paid certificate yet):
> click **More info**, then **Run anyway**.

**macOS 14.2 or later** — download the `.dmg` for your Mac
([Apple Silicon](https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-arm64.dmg) or
[Intel](https://github.com/adrbn/minute/releases/latest/download/Minute-macOS-x64.dmg)) and drag Minute to **Applications**.

> The app is signed and notarized by Apple, so it opens straight away. On your first recording, allow **Microphone** and
> **System Audio Recording**.

## Get started

1. **Get a free Groq key** — one minute, see below — and paste it when Minute asks.
2. Check that your microphone's level bar moves.
3. Click the red button, or use the global shortcut <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>R</kbd>.

During a meeting, **Minimize** turns the window into the Dynamic Island.

## Keys and connections

Minute has no server and no account: it uses **your** keys, kept encrypted by your system (DPAPI on Windows,
Keychain on macOS). Only one is required.

### Groq — transcription (free)

1. Go to **[console.groq.com](https://console.groq.com)** and sign in.
2. Open **API Keys › Create API Key**, name it "Minute", confirm.
3. Copy the key (it starts with `gsk_`) — it won't be shown again.
4. In Minute: **Settings › Transcription › Groq key**, paste, **Save**. A ✓ confirms it works.

The free tier allows 20 requests per minute and about two hours of audio per hour; Minute manages that budget for
you. At worst, sentences arrive a few seconds late — nothing is ever lost. The same key also writes the summaries.

### Your own transcription server (optional)

Minute can transcribe **offline**, on your own OpenAI-compatible transcription server — for example
[Speaches](https://github.com/speaches-ai/speaches) (faster-whisper) on a home server with a GPU, or NVIDIA
[Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) on a CPU-only machine. No quota, and the
audio stays with you. **Settings › Transcription › Mode: Offline**, then address, optional model and key, **Test**.
Only the chosen mode transcribes: offline, nothing goes to Groq; if the server doesn't answer, sentences wait for it.
The other mode's settings and key stay saved: switch back **Online** (Groq) in one click.

On Groq's free plan, each Whisper model has its own quota: when `whisper-large-v3-turbo` runs out, Minute switches
to `whisper-large-v3` on its own.

### Summaries with another AI (optional)

Choose the provider in **Settings › Intelligence** and paste its key:

| Provider | Where to get a key | Good to know |
|---|---|---|
| **Groq** | already done | Free and fast. The default. |
| **Claude** (Anthropic) | [console.anthropic.com › API Keys](https://console.anthropic.com/settings/keys) | The best writing quality. Pay as you go (a few cents per summary). |
| **Gemini** (Google) | [aistudio.google.com › Get API key](https://aistudio.google.com/apikey) | Generous free tier, very long context. |
| **OpenAI** | [platform.openai.com › API keys](https://platform.openai.com/api-keys) | GPT models. Pay as you go. |

### Google Calendar

**The simplest way: an iCal link** (read-only, nothing to set up at Google). In Google Calendar:
**Settings › [your calendar] › Integrate calendar › Secret address in iCal format**. Copy it, then in Minute:
**Settings › Calendar › iCal link**. For Outlook: **Settings › Calendar › Shared calendars › Publish a calendar**,
and copy the **ICS** link.

**With "Sign in with Google"** (organisations where secret links are disabled): an administrator creates an
OAuth client once for everyone.

1. [console.cloud.google.com](https://console.cloud.google.com) › **New project** ("Minute").
2. **APIs & Services › Library** › *Google Calendar API* › **Enable**.
3. **APIs & Services › OAuth consent screen**: **Internal** (Google Workspace), or **External** with your addresses
   as test users for a Gmail account. Add the scope `…/auth/calendar.events.readonly`.
4. **Credentials › Create credentials › OAuth client ID** › **Desktop app** › **Create**.
5. Copy the **client ID** and **client secret**; in Minute: **Settings › Calendar › Advanced**, paste, **Save**,
   then **Sign in with Google**.

Minute only reads your events (title, times, attendees, call link) — nothing else in your account.

### Private mode (no key)

**Settings › Privacy.** Minute downloads the open-source [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
engine once (about 570 MB, or 200 MB for the fast model), then blocks every outside connection. For summaries,
install [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com): Minute finds them on its own.

> Local transcription needs a recent computer. On a desktop processor without a dedicated graphics card,
> pick the **Fast** model to keep up with speech.

## Keyboard shortcuts

| | Windows | macOS |
|---|---|---|
| Start / end a meeting (press twice to end) | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>R</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>R</kbd> |
| Mark a moment | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>M</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>M</kbd> |
| Copy the transcript | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>C</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>C</kbd> |
| Dynamic Island | <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>T</kbd> | <kbd>⌃</kbd><kbd>⌥</kbd><kbd>T</kbd> |

## Your data

- Meetings live **on your computer**, in `Documents/Minute`: one readable folder per meeting.
- In standard mode, only the **audio of each sentence** goes to Groq to be transcribed (in offline mode: to your
  server, and nowhere else), and only the **text** goes to the AI you picked for summaries. Voice recognition runs on your computer.
- No telemetry, no account, no Minute server.
- For organisations: a [GDPR note for your data protection officer](docs/RGPD.md) (in French).

## FAQ

<details>
<summary><b>English is translated into French in my transcript</b></summary>

Set **Settings › Transcription › Meeting language** to **Multiple languages (auto-detect)**, the default: each sentence stays in its
own language.
</details>

<details>
<summary><b>Nothing shows up for the other participants</b></summary>

Make sure **System audio** is on, on the home screen. On macOS, allow **System Audio Recording** in
*System Settings › Privacy & Security*.
</details>

<details>
<summary><b>Does the Dynamic Island show up when I share my screen?</b></summary>

Not by default: it's hidden from screen sharing and screenshots. To show it, turn off
**Settings › Compact mode › Hide from screen sharing and screenshots**.
</details>

<details>
<summary><b>I deleted a meeting by mistake</b></summary>

It's in the **Trash** (bottom of the sidebar) for 30 days: right-click › **Restore**.
</details>

## Support and feedback

Minute is free, open source and built in my spare time. If it saves you time,
[**buy me a coffee on Ko-fi**](https://ko-fi.com/adrbn) ☕

- **Found a problem?** In Minute: **Settings › About › Report a problem** fills in a GitHub issue for you, with a
  technical log (never any meeting content). Or [open an issue](https://github.com/adrbn/minute/issues/new/choose).
- **An idea?** [Suggest it](https://github.com/adrbn/minute/issues/new?template=feature_request.yml).

## Benchmark

Measured with `npm run bench` ([scripts/bench.mjs](scripts/bench.mjs)), which runs the app's own code (transcription
calls, prompt, filter, CAM++ voice prints, voice clustering) on four meetings of the AMI Meeting Corpus.
**2026-10-05 · Apple M1, 16 GB · Minute 0.6.10.** Published as they came out.

> **AMI is English. These numbers say nothing about French.**

**Transcription** (4 meetings, 92 min of audio, 14,634 reference words)

| Engine | WER | Real-time factor |
|---|---|---|
| whisper.cpp turbo (`ggml-large-v3-turbo-q5_0.bin`) | 34.2 % | 0.281 |
| whisper.cpp small (`ggml-small-q5_1.bin`) | 36.5 % | 0.085 |
| Groq `whisper-large-v3-turbo` | not measured | not measured |

Per meeting (turbo / small): ES2004a 29.8 / 32.2 % · IS1009a 26.6 / 29.6 % · TS3003a 26.1 / 28.5 % ·
EN2002a 40.5 / 42.5 %.

- **Groq was not measured**: no `GROQ_API_KEY` in the environment for this run. Set it and rerun to add it.
- **WER** = (substitutions + deletions + insertions) / reference words, pooled over the 4 meetings. Normalization:
  lowercase, punctuation removed, whitespace collapsed. Nothing else, so fillers ("um", "uh"), overlapping speech the
  engine doesn't write down, and numbers written as digits all count as errors.
- **Audio**: the Mix-Headset track (all headset mics mixed into one), sent in pieces of at most 16 s cut between words
  like the app's segmenter, with the app's prompt and filter, language `auto`.
- **Real-time factor** = processing time / duration of the audio sent (lower is faster). Model loading excluded.
- **whisper.cpp**: the app's local mode ships for Windows only (v1.9.2, CPU build). On this Mac the bench drives the
  same `localStt.ts` code with Homebrew's `whisper-server` 1.9.4, which runs on the GPU (Metal). The speeds don't
  carry over to a Windows PC.

**Speakers** (CAM++ voice prints, then the app's `Voices` clustering with its real thresholds)

| Meeting | Real speakers | Found | Speaking time attributed correctly |
|---|---|---|---|
| ES2004a | 4 | 4 | 80.8 % |
| IS1009a | 4 | 4 | 78.2 % |
| TS3003a | 4 | 5 | 84.3 % |
| EN2002a | 4 | 3 | 60.7 % |

- **Oracle segmentation**: the reference speaker turns are given. This measures how voices are grouped, not speech
  detection. Each turn gives one voice print, passed to `assign`, then the end-of-meeting `refine` pass runs. The
  in-meeting `consolidate` (every 2 minutes) is not replayed.
- **Attribution** = share of speaking time given to the right person, after the best one-to-one match between found
  groups and real speakers (every assignment is tried). Turns with overlapping speech are used as they are.

**Data**: [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), University of Edinburgh,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Mix-Headset audio and manual annotations v1.6.2 (words and
speaker segments) of the test-set meetings ES2004a, IS1009a, TS3003a and EN2002a, downloaded by the script into
`bench-data/` (ignored by git, no audio in this repo). The official annotations give words and speaker turns from one
source, so neither the Hugging Face copy nor separate RTTM files were needed.

## Build from source

```bash
npm install
npm start          # build and run
npm test           # unit tests
npm run bench      # benchmark (downloads ~200 MB of AMI audio + whisper.cpp models)
npm run dist:win   # Windows installer → release/
```

Pushing a `v*` tag builds Windows and macOS on GitHub Actions and publishes the release, including the files the
auto-updater reads. Electron · React · TypeScript · Silero VAD and CAM++ (ONNX, WebAssembly) · whisper.cpp.
Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © 2026 Adrien Robino
