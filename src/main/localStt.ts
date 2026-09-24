// Transcription locale (mode confidentiel) : whisper.cpp tourne sur cet ordinateur, en serveur HTTP
// qui n'écoute que 127.0.0.1. Moteur et modèle sont téléchargés une fois (avant d'activer le verrou
// réseau), puis plus rien ne sort de la machine.
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { LocalStatus } from '../shared/types';
import { t } from '../shared/i18n';
import { SttError, type SttResult } from './groq';

const WHISPER_VERSION = 'v1.9.2';
const ENGINE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-blas-bin-x64.zip`;

export type LocalModel = 'turbo' | 'small';
/** `label` reste en français ici : traduit par t() au moment de l'afficher. */
export const LOCAL_MODELS: Record<LocalModel, { file: string; mb: number; label: string }> = {
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', mb: 547, label: 'Précis — large v3 turbo' },
  small: { file: 'ggml-small-q5_1.bin', mb: 181, label: 'Rapide — small' },
};
const modelUrl = (file: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

const root = () => join(app.getPath('userData'), 'whisper');
const engineDir = () => join(root(), WHISPER_VERSION);
const serverExe = () => findFile(engineDir(), 'whisper-server.exe');
const modelPath = (m: LocalModel) => join(root(), LOCAL_MODELS[m].file);

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    }
  }
  return null;
}

export type { LocalStatus };

let download: LocalStatus['download'];
let lastError: string | undefined;
let proc: ChildProcess | null = null;
let port = 0;
let runningModel: LocalModel | null = null;
let starting: Promise<void> | null = null;
const listeners = new Set<(s: LocalStatus) => void>();
export const onLocalStatus = (cb: (s: LocalStatus) => void) => listeners.add(cb);
const emit = () => listeners.forEach((l) => l(localStatus()));

export function localStatus(): LocalStatus {
  return {
    supported: process.platform === 'win32',
    engine: !!serverExe(),
    models: { turbo: existsSync(modelPath('turbo')), small: existsSync(modelPath('small')) },
    running: !!proc && !proc.killed,
    download,
    error: lastError,
  };
}

/** Téléchargement en flux vers un fichier .part, avec progression, puis renommage atomique. */
async function fetchTo(url: string, dest: string, what: string, expectSha256?: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(t('Téléchargement impossible ({status})', { status: res.status }));
  // empreinte SHA-256 publiée par la source : vérifiée à l'arrivée
  const sha = expectSha256;
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  const hash = createHash('sha256');
  let received = 0;
  let lastEmit = 0;
  download = { what, received, total };
  emit();
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.byteLength;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        download = { what, received, total };
        emit();
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    rmSync(part, { force: true });
    throw e;
  }
  if (sha && /^[0-9a-f]{64}$/.test(sha) && hash.digest('hex') !== sha) {
    rmSync(part, { force: true });
    throw new Error(t('Fichier corrompu (empreinte SHA-256 différente) — réessayez.'));
  }
  renameSync(part, dest);
}

/** Décompresse le moteur avec l'outil intégré à Windows (aucune dépendance). */
function unzip(zip: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`],
      { windowsHide: true },
    );
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(t('Décompression impossible (code {code})', { code: String(code) })))));
  });
}

/** Empreintes officielles publiées par GitHub (moteur) et Hugging Face (modèles). */
async function engineSha(): Promise<string | undefined> {
  try {
    const r = await fetch(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${WHISPER_VERSION}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as { assets?: { name: string; digest?: string }[] };
    return j.assets?.find((a) => a.name === 'whisper-blas-bin-x64.zip')?.digest?.replace(/^sha256:/, '');
  } catch {
    return undefined;
  }
}
async function modelSha(file: string): Promise<string | undefined> {
  try {
    const r = await fetch(modelUrl(file), { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    return r.headers.get('x-linked-etag')?.replace(/"/g, '') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Installe le moteur (20 Mo) puis le modèle choisi — une seule fois. */
export async function installLocal(model: LocalModel): Promise<void> {
  if (process.platform !== 'win32') throw new Error(t('La transcription locale est proposée sous Windows.'));
  lastError = undefined;
  mkdirSync(root(), { recursive: true });
  try {
    if (!serverExe()) {
      const zip = join(root(), `whisper-${WHISPER_VERSION}.zip`);
      await fetchTo(ENGINE_URL, zip, t('Moteur whisper.cpp'), await engineSha());
      await unzip(zip, engineDir());
      rmSync(zip, { force: true });
      if (!serverExe()) throw new Error(t('Moteur incomplet (whisper-server.exe introuvable).'));
    }
    if (!existsSync(modelPath(model))) {
      const { file, label } = LOCAL_MODELS[model];
      await fetchTo(modelUrl(file), modelPath(model), t(label), await modelSha(file));
    }
  } catch (e) {
    lastError = (e as Error).message;
    throw e;
  } finally {
    download = undefined;
    emit();
  }
}

export function removeLocalModel(model: LocalModel) {
  if (runningModel === model) stopLocal();
  rmSync(modelPath(model), { force: true });
  emit();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

/** Lance le serveur whisper.cpp (sur 127.0.0.1 uniquement) et attend qu'il réponde. */
export function startLocal(model: LocalModel): Promise<void> {
  if (proc && !proc.killed && runningModel === model) return starting ?? Promise.resolve();
  stopLocal();
  starting = (async () => {
    const exe = serverExe();
    if (!exe || !existsSync(modelPath(model))) throw new Error(t('Moteur local non installé.'));
    port = await freePort();
    const threads = Math.max(2, Math.min(8, cpus().length - 1));
    // un seul candidat, pas de nouvelle tentative à température plus haute : ~30 % plus rapide sur processeur
    const fast = ['-bo', '1', '-nf'];
    proc = spawn(exe, ['-m', modelPath(model), '--host', '127.0.0.1', '--port', String(port), '-t', String(threads), ...fast], {
      windowsHide: true,
      stdio: 'ignore',
    });
    runningModel = model;
    proc.on('exit', () => {
      proc = null;
      runningModel = null;
      emit();
    });
    // le chargement du modèle prend quelques secondes
    const until = Date.now() + 60_000;
    for (;;) {
      if (!proc) throw new Error(t('Le moteur local s’est arrêté au démarrage.'));
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
        if (r.status < 500) break;
      } catch {
        /* pas encore prêt */
      }
      if (Date.now() > until) throw new Error(t('Le moteur local ne répond pas.'));
      await new Promise((r) => setTimeout(r, 400));
    }
    emit();
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function stopLocal() {
  proc?.kill();
  proc = null;
  runningModel = null;
}
app.on('will-quit', stopLocal);

/** Même contrat que la transcription Groq : texte + indices de confiance. */
export async function transcribeLocal(wav: Buffer, opts: { model: LocalModel; language: string; prompt: string }): Promise<SttResult> {
  try {
    await startLocal(opts.model);
  } catch (e) {
    throw new SttError((e as Error).message, 'server');
  }
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  if (opts.language && opts.language !== 'auto') fd.append('language', opts.language);
  else fd.append('language', 'auto');
  if (opts.prompt) fd.append('prompt', opts.prompt);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new SttError(t('Moteur local indisponible ({error})', { error: (e as Error).message }), 'server');
  }
  if (!res.ok) throw new SttError(t('Moteur local : erreur {status}', { status: res.status }), 'server');
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? '').trim(), noSpeech: 0, avgLogprob: 0, compression: 1 };
}

/** Taille d'un modèle installé (Mo), pour l'affichage. */
export const installedSize = (m: LocalModel) => (existsSync(modelPath(m)) ? Math.round(statSync(modelPath(m)).size / 1048576) : 0);
