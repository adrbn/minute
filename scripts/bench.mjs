// Banc d'essai : npm run bench (ou node scripts/bench.mjs stt | voices | stt-fr | load)
// Transcription (WER, facteur temps réel, charge processeur) et regroupement des voix sur 4 réunions du
// corpus AMI (CC BY 4.0), avec le code de l'app : transcribe / transcribeLocal, cleanResult, VoicePrint
// (CAM++) et Voices. Tout est téléchargé dans bench-data/ (ignoré par git).
//   stt-fr : WER en français sur des phrases FLEURS (CC BY 4.0), 349 Mo à télécharger (FR_N = nombre de phrases)
//   load   : rejoue des réunions en temps réel (STREAMS flux, MINUTES minutes) et mesure retard et charge :
//            la machine suit-elle le rythme sans s'essouffler ? Lancer MINUTES=20 pour juger la chauffe.
// Variables : ENGINES=parakeet,small (limiter les moteurs), THREADS (fils de Parakeet), LANGUAGE (défaut auto).
// Parakeet : npm i --no-save sherpa-onnx-node@1.13.8 (le modèle int8, 487 Mo, est téléchargé tout seul).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Normalisation du WER : minuscules, ponctuation retirée, espaces fusionnés. */
export const tokens = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);

/** Distance d'édition entre deux suites de mots (substitutions + suppressions + insertions). */
export function editDistance(ref, hyp) {
  let prev = Int32Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = new Int32Array(hyp.length + 1);
    cur[0] = i;
    for (let j = 1; j <= hyp.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[hyp.length];
}

export function wer(ref, hyp) {
  const r = tokens(ref);
  return r.length ? editDistance(r, tokens(hyp)) / r.length : 0;
}

/**
 * Part du temps de parole donnée au bon locuteur, avec la meilleure correspondance groupe → locuteur :
 * toutes les affectations sont essayées (un groupe = au plus un locuteur ; 5 locuteurs max).
 * `segs` : { ref: locuteur réel, hyp: groupe trouvé (ou undefined), dur }.
 */
export function attribution(segs) {
  const refs = [...new Set(segs.map((s) => s.ref))];
  const hyps = [...new Set(segs.map((s) => s.hyp).filter((h) => h !== undefined))];
  const time = new Map();
  let total = 0;
  for (const s of segs) {
    total += s.dur;
    if (s.hyp !== undefined) time.set(`${s.hyp}\0${s.ref}`, (time.get(`${s.hyp}\0${s.ref}`) ?? 0) + s.dur);
  }
  const best = (i, used) => {
    if (i === refs.length) return 0;
    let b = best(i + 1, used); // ce locuteur n'a pas de groupe
    for (const h of hyps) {
      if (!used.includes(h)) b = Math.max(b, (time.get(`${h}\0${refs[i]}`) ?? 0) + best(i + 1, [...used, h]));
    }
    return b;
  };
  return total ? best(0, []) / total : 0;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'bench-data');
const MEETINGS = ['ES2004a', 'IS1009a', 'TS3003a', 'EN2002a'];
const ANNOTATIONS = 'ami_public_manual_1.6.2.zip';
const SR = 16000;
/** au plus 16 s par envoi, comme le segmenteur de l'app (MAX_MS) */
const CHUNK = 16;
/** réglage par défaut de l'app : chaque phrase dans sa langue */
const LANGUAGE = process.env.LANGUAGE ?? 'auto';
const GROQ_MODEL = 'whisper-large-v3-turbo';

function download(url, dest) {
  if (existsSync(dest)) return;
  console.log(`téléchargement ${url}`);
  execFileSync('curl', ['-fsSL', '-C', '-', '--retry', '10', '--retry-all-errors', '--speed-limit', '2000', '--speed-time', '20', '-o', `${dest}.part`, url], { stdio: 'inherit' });
  renameSync(`${dest}.part`, dest);
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const unxml = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Mots (horodatés, par locuteur) et tours de parole de référence d'une réunion, depuis les annotations AMI. */
function reference(m) {
  const zip = join(DATA, ANNOTATIONS);
  const files = execFileSync('tar', ['-tf', zip], { encoding: 'utf8', maxBuffer: 64e6 }).split(/\r?\n/);
  const read = (f) => execFileSync('tar', ['-xOf', zip, f], { maxBuffer: 64e6 }).toString('latin1');
  const words = [];
  const turns = [];
  for (const f of files.filter((f) => f.startsWith(`words/${m}.`))) {
    const spk = f.split('.')[1];
    let last = 0;
    for (const [, tag, text] of read(f).matchAll(/<w\b([^>]*)>([^<]*)<\/w>/g)) {
      if (attr(tag, 'punc')) continue;
      const t0 = Number(attr(tag, 'starttime') ?? last);
      const t1 = Number(attr(tag, 'endtime') ?? t0);
      last = t1;
      words.push({ spk, t0, t1, text: unxml(text) });
    }
  }
  for (const f of files.filter((f) => f.startsWith(`segments/${m}.`))) {
    const spk = f.split('.')[1];
    for (const [tag] of read(f).matchAll(/<segment\b[^>]*>/g)) {
      turns.push({ spk, t0: Number(attr(tag, 'transcriber_start')), t1: Number(attr(tag, 'transcriber_end')) });
    }
  }
  return { words: words.sort((a, b) => a.t0 - b.t0), turns: turns.filter((t) => t.t1 > t.t0).sort((a, b) => a.t0 - b.t0) };
}

/** Envois de 16 s au plus, coupés entre deux mots de la référence (sinon coupe franche). */
function chunks(ref) {
  const spans = ref.words.map((w) => [w.t0, w.t1]);
  const regions = [];
  for (const [a, b] of spans) {
    const last = regions.at(-1);
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else regions.push([a, b]);
  }
  const list = [];
  let hard = 0;
  for (const [a0, b] of regions) {
    const cur = list.at(-1);
    if (cur && b - cur[0] <= CHUNK) {
      cur[1] = b;
      continue;
    }
    let a = a0;
    for (; b - a > CHUNK; a += CHUNK, hard++) list.push([a, a + CHUNK]);
    list.push([a, b]);
  }
  return { list, hard };
}

/** PCM 16 bits mono 16 kHz d'un fichier WAV (les WAV FLEURS, en flottants 32 bits, sont convertis). */
function readWav(file) {
  const b = readFileSync(file);
  let fmt;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      const data = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
      if (fmt?.ch === 1 && fmt.rate === SR && fmt.tag === 3 && fmt.bits === 32) {
        const out = Buffer.alloc(data.length / 2);
        for (let i = 0; i < data.length / 4; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data.readFloatLE(4 * i))) * 32767), 2 * i);
        return out;
      }
      if (fmt?.ch !== 1 || fmt.rate !== SR || fmt.bits !== 16) throw new Error(`${file} : attendu 16 kHz mono 16 bits`);
      return data;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${file} : pas de données audio`);
}
const slice = (pcm, t0, t1) => pcm.subarray(Math.max(0, Math.round(t0 * SR)) * 2, Math.min(pcm.length >> 1, Math.round(t1 * SR)) * 2);
const float = (pcm) => Float32Array.from({ length: pcm.length >> 1 }, (_, i) => pcm.readInt16LE(2 * i) / 32768);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Temps processeur cumulé de toute la machine (ms) : `busy` travaillé, `all` total. */
const cpuTimes = () =>
  cpus().reduce((a, { times: t }) => ({ busy: a.busy + t.user + t.nice + t.sys + t.irq, all: a.all + t.user + t.nice + t.sys + t.irq + t.idle }), { busy: 0, all: 0 });

/** Bridage thermique du processeur sur Mac (100 = aucun) ; null ailleurs ou si rien n'est enregistré. */
function speedLimit() {
  if (process.platform !== 'darwin') return null;
  try {
    return Number(execFileSync('pmset', ['-g', 'therm'], { encoding: 'utf8' }).match(/CPU_Speed_Limit\s*=\s*(\d+)/)?.[1]) || null;
  } catch {
    return null;
  }
}

const PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';

/** Parakeet TDT v3 (int8) par sherpa-onnx-node, dans ce processus. Renvoie null si le paquet n'est pas installé. */
function parakeetEngine() {
  let sherpa;
  try {
    sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
  } catch {
    console.log('sherpa-onnx-node absent (npm i --no-save sherpa-onnx-node@1.13.8) : Parakeet non mesuré.');
    return null;
  }
  const dir = join(DATA, 'parakeet', PARAKEET);
  let recognizer;
  return {
    id: 'parakeet',
    name: 'Parakeet TDT v3 int8 (sherpa-onnx)',
    start: () => {
      if (!existsSync(dir)) {
        const tar = join(DATA, 'parakeet', `${PARAKEET}.tar.bz2`);
        mkdirSync(dirname(tar), { recursive: true });
        download(`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${PARAKEET}.tar.bz2`, tar);
        execFileSync('tar', ['xjf', tar, '-C', dirname(tar)]);
      }
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SR, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
          tokens: join(dir, 'tokens.txt'),
          numThreads: Number(process.env.THREADS) || Math.max(2, Math.min(8, cpus().length - 1)), // même règle que localStt
          provider: 'cpu',
          debug: 0,
          modelType: 'nemo_transducer',
        },
      });
    },
    stop: () => (recognizer = undefined),
    run: async (wav) => {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: SR, samples: float(wav.subarray(44)) }); // 44 : en-tête WAV de pcm16ToWav
      const t = performance.now();
      await recognizer.decodeAsync(stream);
      return { r: { text: recognizer.getResult(stream).text, noSpeech: 0, avgLogprob: 0, compression: 0 }, ms: performance.now() - t };
    },
  };
}

/** Phrases de test FLEURS en français (≤ 16 s, une par texte) : un « ensemble » prêt pour transcription(). */
function fleursFr() {
  const n = Number(process.env.FR_N ?? 100);
  const dir = join(DATA, 'fleurs-fr');
  mkdirSync(dir, { recursive: true });
  const base = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data/fr_fr';
  download(`${base}/test.tsv`, join(dir, 'test.tsv'));
  // colonnes : id, fichier, texte brut, texte normalisé, phonèmes, nombre d'échantillons, genre
  const seen = new Set();
  const rows = readFileSync(join(dir, 'test.tsv'), 'utf8')
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length > 5 && Number(c[5]) <= CHUNK * SR && !seen.has(c[3]) && seen.add(c[3]))
    .slice(0, n);
  const missing = rows.filter((c) => !existsSync(join(dir, 'test', c[1]))).map((c) => `test/${c[1]}`);
  if (missing.length) {
    const tar = join(dir, 'test.tar.gz');
    download(`${base}/audio/test.tar.gz`, tar);
    execFileSync('tar', ['xzf', tar, '-C', dir, ...missing], { stdio: 'inherit' });
  }
  const pieces = rows.map((c) => {
    const pcm = readWav(join(dir, 'test', c[1]));
    return { pcm, sec: pcm.length / 2 / SR };
  });
  return { id: 'FLEURS-fr', pieces, ref: rows.map((c) => c[3]).join(' ') };
}

/** Réunions AMI découpées comme l'app envoie l'audio : un ensemble par réunion. */
const amiSets = (refs, pcms) =>
  MEETINGS.map((m) => ({
    id: m,
    pieces: refs[m].chunks.list.map(([a, b]) => ({ pcm: slice(pcms[m], a, b), sec: b - a })),
    ref: refs[m].words.map((w) => w.text).join(' '),
  }));

/** Moteurs disponibles. `run` renvoie le résultat et le temps passé dans l'appel (attentes de quota exclues). */
function engines(app) {
  const only = process.env.ENGINES?.split(',');
  return allEngines(app).filter((e) => !only || only.includes(e.id));
}

function allEngines(app) {
  const list = [];
  const key = process.env.GROQ_API_KEY;
  if (key) {
    const budget = new app.Budget();
    list.push({
      id: 'groq',
      name: `Groq ${GROQ_MODEL}`,
      run: async (wav, prompt) => {
        const sec = wav.length / 32000;
        for (let tries = 0; ; tries++) {
          const wait = budget.delayFor(sec, 'final');
          if (wait) await sleep(wait);
          budget.record(sec);
          const t = performance.now();
          try {
            const r = await app.transcribe(key, wav, { model: GROQ_MODEL, language: LANGUAGE, prompt, timeoutMs: 60_000 }, budget);
            return { r, ms: performance.now() - t };
          } catch (e) {
            if (tries >= 4 || e.kind === 'auth' || e.kind === 'bad') throw e;
            if (e.kind === 'rate') budget.block(e.retryAfterMs);
            else await sleep(5000);
          }
        }
      },
    });
  } else console.log('GROQ_API_KEY absente : Groq non mesuré.');

  const parakeet = parakeetEngine();
  if (parakeet) list.push(parakeet);

  // Windows : l'app télécharge elle-même son whisper-server.exe. Ailleurs : un relais vers le binaire de ce Mac
  if (process.platform !== 'win32') {
    let server = '';
    try {
      server = execFileSync('which', ['whisper-server'], { encoding: 'utf8' }).trim();
    } catch {
      console.log('whisper-server introuvable (brew install whisper-cpp) : whisper.cpp non mesuré.');
      return list;
    }
    // localStt cherche whisper-server.exe (version Windows de l'app)
    const dir = join(DATA, 'whisper', app.WHISPER_VERSION);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'whisper-server.exe'), `#!/bin/sh\nexec "${server}" "$@"\n`, { mode: 0o755 });
  }
  for (const model of ['turbo', 'small']) {
    const { file } = app.LOCAL_MODELS[model];
    list.push({
      id: model,
      name: `whisper.cpp ${model} (${file})`,
      start: () => {
        download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`, join(DATA, 'whisper', file));
        return app.startLocal(model); // chargement du modèle hors chronométrage
      },
      stop: () => app.stopLocal(),
      run: async (wav, prompt) => {
        const t = performance.now();
        const r = await app.transcribeLocal(wav, { model, language: LANGUAGE, prompt });
        return { r, ms: performance.now() - t };
      },
    });
  }
  return list;
}

async function transcription(app, sets) {
  const rows = [];
  for (const e of engines(app)) {
    await e.start?.();
    let errors = 0;
    let n = 0;
    let ms = 0;
    let audio = 0;
    let busy = 0;
    let all = 0;
    const per = {};
    for (const set of sets) {
      const hyp = [];
      for (const { pcm, sec } of set.pieces) {
        const c0 = cpuTimes();
        const { r, ms: t } = await e.run(app.pcm16ToWav(pcm), app.buildPrompt('', hyp.join(' ')));
        const c1 = cpuTimes();
        busy += c1.busy - c0.busy;
        all += c1.all - c0.all;
        hyp.push(app.cleanResult(r));
        process.stderr.write('.');
        ms += t;
        audio += sec;
      }
      writeFileSync(join(DATA, `hyp.${e.id}.${set.id}.txt`), hyp.join('\n'));
      const ref = tokens(set.ref);
      const err = editDistance(ref, tokens(hyp.join(' ')));
      per[set.id] = err / ref.length;
      errors += err;
      n += ref.length;
      console.log(`${e.name} · ${set.id} : WER ${(100 * per[set.id]).toFixed(1)} %`);
    }
    e.stop?.();
    // cpu : part de la machine entière occupée pendant les appels ; cpuSec : secondes de processeur par seconde d'audio
    rows.push({ engine: e.name, wer: errors / n, rtf: ms / 1000 / audio, cpu: all ? busy / all : 0, cpuSec: busy / 1000 / audio, audio, per });
  }
  return rows;
}

const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];

/**
 * Rejoue en temps réel STREAMS flux (réunions AMI différentes : micro + son système) pendant MINUTES minutes
 * et mesure le retard de chaque envoi (fin de la phrase → texte rendu), la charge de toute la machine et le
 * bridage thermique (Mac). Sans Groq : il ne mesure que le réseau.
 */
async function load(app, refs, pcms) {
  const minutes = Number(process.env.MINUTES ?? 5);
  const streams = Math.min(MEETINGS.length, Number(process.env.STREAMS ?? 2));
  const rows = [];
  for (const e of engines(app).filter((x) => x.id !== 'groq')) {
    await e.start?.();
    const lags = [];
    const samples = [];
    const own = []; // part de la machine prise par ce processus seul (Parakeet tourne dedans ; whisper-server non)
    let ownLast = process.cpuUsage();
    const limit0 = speedLimit();
    let last = cpuTimes();
    const timer = setInterval(() => {
      const now = cpuTimes();
      samples.push((now.busy - last.busy) / (now.all - last.all));
      const u = process.cpuUsage(ownLast);
      own.push((u.user + u.system) / 1000 / ((now.all - last.all) / cpus().length));
      ownLast = process.cpuUsage();
      last = now;
    }, 2000);
    const t0 = performance.now();
    await Promise.all(
      MEETINGS.slice(0, streams).map(async (m) => {
        for (const [a, b] of refs[m].chunks.list) {
          if (b > minutes * 60) break;
          const ready = t0 + b * 1000; // la phrase est finie : on peut l'envoyer
          if (ready > performance.now()) await sleep(ready - performance.now());
          await e.run(app.pcm16ToWav(slice(pcms[m], a, b)), app.buildPrompt('', ''));
          lags.push((performance.now() - ready) / 1000);
        }
      }),
    );
    clearInterval(timer);
    e.stop?.();
    const p95 = quantile(lags, 0.95);
    const row = {
      engine: e.name,
      streams,
      minutes,
      sends: lags.length,
      lagP50: quantile(lags, 0.5),
      lagP95: p95,
      lagMax: Math.max(...lags),
      cpuAvg: samples.reduce((a, x) => a + x, 0) / (samples.length || 1),
      cpuMax: Math.max(0, ...samples),
      ownAvg: own.reduce((a, x) => a + x, 0) / (own.length || 1),
      speedLimit: [limit0, speedLimit()],
      verdict: p95 <= 5 ? 'suit' : p95 <= 15 ? 'à la limite' : 'décroche',
    };
    console.log(`charge · ${row.engine} : retard p95 ${p95.toFixed(1)} s (max ${row.lagMax.toFixed(1)} s), machine ${(100 * row.cpuAvg).toFixed(0)} % en moyenne (pic ${(100 * row.cpuMax).toFixed(0)} %, dont ce processus ${(100 * row.ownAvg).toFixed(0)} %) → ${row.verdict}`);
    rows.push(row);
  }
  return rows;
}

/** Part du temps de parole de référence donnée au bon groupe, quand les extraits ne suivent pas les tours de parole. */
export function overlapAttribution(turns, segs) {
  const pieces = [];
  for (const t of turns) {
    let covered = 0;
    for (const s of segs) {
      const d = Math.min(t.t1, s.t1) - Math.max(t.t0, s.t0);
      if (d <= 0) continue;
      pieces.push({ ref: t.spk, hyp: s.spk, dur: d });
      covered += d;
    }
    if (t.t1 - t.t0 > covered) pieces.push({ ref: t.spk, hyp: undefined, dur: t.t1 - t.t0 - covered });
  }
  return attribution(pieces);
}

/** Part du temps de parole de référence couverte par un extrait qui a reçu une voix. */
export function coverage(turns, segs) {
  let total = 0;
  let covered = 0;
  for (const t of turns) {
    total += t.t1 - t.t0;
    for (const s of segs) if (s.spk !== undefined) covered += Math.max(0, Math.min(t.t1, s.t1) - Math.max(t.t0, s.t0));
  }
  return total ? covered / total : 0;
}

/** Extraits tels que l'app les envoie : Silero VAD puis le segmenteur, trame par trame (ms). */
async function vadSegments(app, vad, pcm) {
  vad.reset();
  const out = [];
  const seg = new app.Segmenter((s) => !s.interim && out.push({ t0: s.t0, t1: s.t1 }), false);
  const f = float(pcm);
  for (let i = 0; i + app.FRAME <= f.length; i += app.FRAME) {
    const frame = f.subarray(i, i + app.FRAME);
    seg.push(frame, await vad.prob(frame), (i / SR) * 1000);
  }
  seg.flush();
  return out;
}

const loadModel = (rel) => {
  const b = readFileSync(join(ROOT, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

/**
 * Regroupement des voix, trois découpes : `oracle` (un extrait par tour de parole AMI), `vad` (la découpe
 * de l'app) et `split` (la découpe de l'app, puis coupe quand la voix change : voiceCuts).
 * Temps des empreintes CAM++ mesuré (facteur temps réel, un seul fil comme dans l'app).
 */
async function speakers(app, refs, pcms, modes = ['oracle', 'vad', 'split'], threshold = undefined) {
  app.ort.env.wasm.numThreads = 1; // comme le moteur de l'app
  const print = await app.VoicePrint.create(app.ort, loadModel('src/renderer/public/models/campplus_voxceleb.onnx'));
  const vad = modes.some((x) => x !== 'oracle') && (await app.SileroVad.create(app.ort, loadModel('src/renderer/public/models/silero_vad.onnx')));
  const rows = [];
  for (const m of MEETINGS) {
    const f = float(pcms[m]);
    const cut = (t0, t1) => f.subarray(Math.round((t0 / 1000) * SR), Math.round((t1 / 1000) * SR));
    const turns = refs[m].turns.map((t) => ({ spk: t.spk, t0: t.t0 * 1000, t1: t.t1 * 1000 }));
    const vadSegs = vad && (await vadSegments(app, vad, pcms[m]));
    for (const mode of modes) {
      let ms = 0;
      const timed = async (fn) => {
        const t = performance.now();
        const r = await fn();
        ms += performance.now() - t;
        return r;
      };
      let spans = mode === 'oracle' ? turns.map((t) => ({ t0: Math.round(t.t0), t1: Math.round(t.t1), ref: t.spk })) : vadSegs;
      if (mode === 'split') {
        const parts = [];
        for (const s of spans) {
          const at = await timed(() => app.voiceCuts(cut(s.t0, s.t1), (p) => print.embed(p), threshold));
          const edges = [0, ...at.map((a) => Math.round((a / SR) * 1000)), s.t1 - s.t0];
          for (let i = 0; i + 1 < edges.length; i++) parts.push({ t0: s.t0 + edges[i], t1: s.t0 + edges[i + 1] });
        }
        spans = parts;
      }
      let segs = spans.map((s, i) => ({ ...s, id: `${m}-${i}`, ch: 'me', text: '' }));
      let voices = {};
      const voicesOf = new app.Voices({
        dir: () => null,
        meta: () => ({ voices }),
        segments: () => segs,
        setVoices: (_id, v) => (voices = v),
        putSegment: (_id, seg) => (segs = segs.map((s) => (s.id === seg.id ? seg : s))),
      });
      for (const s of segs) {
        const spk = voicesOf.assign(m, s, await timed(() => print.embed(cut(s.t0, s.t1))));
        segs = segs.map((x) => (x.id === s.id ? { ...x, spk } : x));
      }
      voicesOf.refine(m); // passe de fin de réunion
      const row = {
        meeting: m,
        mode,
        real: new Set(turns.map((t) => t.spk)).size,
        found: Object.keys(voices).length,
        extracts: segs.length,
        accuracy: mode === 'oracle' ? attribution(segs.map((s) => ({ ref: s.ref, hyp: s.spk, dur: s.t1 - s.t0 }))) : overlapAttribution(turns, segs),
        covered: mode === 'oracle' ? 1 : coverage(turns, segs), // oracle : tours qui se chevauchent, tout est couvert
        rtf: ms / (pcms[m].length / 2 / SR) / 1000,
      };
      console.log(`voix · ${m} · ${mode} : ${row.real} réels, ${row.found} trouvés, ${row.extracts} extraits, ${(100 * row.accuracy).toFixed(1)} % du temps bien attribué, ${(100 * row.covered).toFixed(1)} % couvert, empreintes ×${row.rtf.toFixed(3)}`);
      rows.push(row);
    }
  }
  return rows;
}

async function main() {
  const parts = process.argv.slice(2);
  // sans argument : stt et voices (comme avant) ; stt-fr (349 Mo) et load (plusieurs minutes) seulement sur demande
  const want = (p) => parts.includes(p) || (!parts.length && p !== 'stt-fr' && p !== 'load');
  mkdirSync(DATA, { recursive: true });
  process.env.MINUTE_USERDATA = DATA; // dossier de l'app (stub electron) : moteur et modèles whisper.cpp
  const { build } = createRequire(import.meta.url)('esbuild');
  const out = join(ROOT, 'node_modules', '.cache', 'minute-bench', 'app.mjs');
  await build({
    stdin: {
      contents: [
        "export * as ort from 'onnxruntime-web/wasm';",
        "export { Voices } from './src/main/voices';",
        "export { VoicePrint, voiceCuts } from './src/renderer/engine/voice';",
        "export { SileroVad } from './src/renderer/engine/vad';",
        "export { Segmenter, FRAME } from './src/renderer/engine/segmenter';",
        "export { transcribe, Budget } from './src/main/groq';",
        "export { transcribeLocal, startLocal, stopLocal, LOCAL_MODELS, WHISPER_VERSION } from './src/main/localStt';",
        "export { cleanResult, buildPrompt } from './src/main/filters';",
        "export { pcm16ToWav } from './src/main/wav';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    external: ['onnxruntime-web'],
    alias: { electron: join(ROOT, 'tests/electron-stub.mjs') },
    logLevel: 'warning',
  });
  const app = await import(pathToFileURL(out).href);
  process.on('exit', () => app.stopLocal());

  const refs = {};
  const pcms = {};
  if (['stt', 'voices', 'load'].some(want)) {
    download(`https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/${ANNOTATIONS}`, join(DATA, ANNOTATIONS));
    for (const m of MEETINGS) {
      const wav = join(DATA, `${m}.Mix-Headset.wav`);
      download(`https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/${m}/audio/${m}.Mix-Headset.wav`, wav);
      const ref = reference(m);
      refs[m] = { ...ref, chunks: chunks(ref) };
      pcms[m] = readWav(wav);
      const c = refs[m].chunks;
      console.log(`${m} : ${(pcms[m].length / 2 / SR / 60).toFixed(1)} min, ${ref.words.length} mots, ${ref.turns.length} tours, ${c.list.length} envois (${c.hard} coupes franches)`);
    }

  }

  // un calcul lourd à la fois : transcription, puis voix
  const stt = want('stt') ? await transcription(app, amiSets(refs, pcms)) : [];
  const sttFr = want('stt-fr') ? await transcription(app, [fleursFr()]) : [];
  const loaded = want('load') ? await load(app, refs, pcms) : [];
  const sweep = process.env.CHANGE ? Number(process.env.CHANGE) : undefined; // seuil de voiceCuts à essayer
  const voices = want('voices') ? await speakers(app, refs, pcms, process.env.MODES?.split(','), sweep) : [];
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const result = { date: new Date().toISOString().slice(0, 10), machine: `${cpus()[0].model}, ${Math.round(totalmem() / 2 ** 30)} GB`, version: pkg.version, stt, sttFr, load: loaded, voices };
  writeFileSync(join(DATA, `results.${parts.join('-') || 'all'}.json`), JSON.stringify(result, null, 1));

  const pct = (x) => `${(100 * x).toFixed(1)} %`;
  console.log(`\n${result.date} · ${result.machine} · Minute ${result.version}\n`);
  for (const [title, rows] of [['', stt], ['\nFrançais (FLEURS)\n', sttFr]]) {
    if (!rows.length) continue;
    console.log(`${title}| Engine | WER | Real-time factor | CPU (whole machine) | CPU-seconds per audio-second |\n|---|---|---|---|---|`);
    for (const r of rows) console.log(`| ${r.engine} | ${pct(r.wer)} | ${r.rtf.toFixed(3)} | ${pct(r.cpu)} | ${r.cpuSec.toFixed(3)} |`);
  }
  if (loaded.length) {
    console.log('\n| Engine | Flux | Minutes | Retard p50 | Retard p95 | Retard max | Machine (moy. / pic) | Ce processus (moy.) | Bridage CPU (début → fin) | Verdict |\n|---|---|---|---|---|---|---|---|---|---|');
    for (const r of loaded) {
      const lim = r.speedLimit.map((x) => (x ? `${x} %` : 'aucun')).join(' → ');
      console.log(`| ${r.engine} | ${r.streams} | ${r.minutes} | ${r.lagP50.toFixed(1)} s | ${r.lagP95.toFixed(1)} s | ${r.lagMax.toFixed(1)} s | ${pct(r.cpuAvg)} / ${pct(r.cpuMax)} | ${pct(r.ownAvg)} | ${lim} | ${r.verdict} |`);
    }
  }
  if (voices.length) {
    console.log('\n| Meeting | Extracts | Real speakers | Found | Speaking time attributed correctly | Voice prints, real-time factor |\n|---|---|---|---|---|---|');
    for (const r of voices) console.log(`| ${r.meeting} | ${r.mode} | ${r.real} | ${r.found} | ${pct(r.accuracy)} | ${r.rtf.toFixed(3)} |`);
  }
}

if (process.argv[1]?.endsWith('bench.mjs')) await main();
