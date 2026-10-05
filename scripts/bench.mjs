// Banc d'essai : npm run bench (ou node scripts/bench.mjs stt | voices)
// Transcription (WER, facteur temps réel) et regroupement des voix sur 4 réunions du corpus AMI
// (CC BY 4.0), avec le code de l'app : transcribe / transcribeLocal, cleanResult, VoicePrint (CAM++)
// et Voices. Tout est téléchargé dans bench-data/ (ignoré par git).
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
const LANGUAGE = 'auto';
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
  const files = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n');
  const read = (f) => execFileSync('unzip', ['-p', zip, f], { maxBuffer: 64e6 }).toString('latin1');
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

/** PCM 16 bits mono 16 kHz d'un fichier WAV. */
function readWav(file) {
  const b = readFileSync(file);
  let fmt;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      if (fmt?.ch !== 1 || fmt.rate !== SR || fmt.bits !== 16) throw new Error(`${file} : attendu 16 kHz mono 16 bits`);
      return b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${file} : pas de données audio`);
}
const slice = (pcm, t0, t1) => pcm.subarray(Math.max(0, Math.round(t0 * SR)) * 2, Math.min(pcm.length >> 1, Math.round(t1 * SR)) * 2);
const float = (pcm) => Float32Array.from({ length: pcm.length >> 1 }, (_, i) => pcm.readInt16LE(2 * i) / 32768);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Moteurs disponibles. `run` renvoie le résultat et le temps passé dans l'appel (attentes de quota exclues). */
function engines(app) {
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

  let server = '';
  try {
    server = execFileSync('which', ['whisper-server'], { encoding: 'utf8' }).trim();
  } catch {
    console.log('whisper-server introuvable (brew install whisper-cpp) : whisper.cpp non mesuré.');
    return list;
  }
  // localStt cherche whisper-server.exe (version Windows de l'app) : un relais vers le binaire de ce Mac
  const dir = join(DATA, 'whisper', app.WHISPER_VERSION);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'whisper-server.exe'), `#!/bin/sh\nexec "${server}" "$@"\n`, { mode: 0o755 });
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

async function transcription(app, refs, pcms) {
  const rows = [];
  for (const e of engines(app)) {
    await e.start?.();
    let errors = 0;
    let n = 0;
    let ms = 0;
    let audio = 0;
    const per = {};
    for (const m of MEETINGS) {
      const hyp = [];
      for (const [a, b] of refs[m].chunks.list) {
        const { r, ms: t } = await e.run(app.pcm16ToWav(slice(pcms[m], a, b)), app.buildPrompt('', hyp.join(' ')));
        hyp.push(app.cleanResult(r));
        process.stderr.write('.');
        ms += t;
        audio += b - a;
      }
      writeFileSync(join(DATA, `hyp.${e.id}.${m}.txt`), hyp.join('\n'));
      const ref = tokens(refs[m].words.map((w) => w.text).join(' '));
      const err = editDistance(ref, tokens(hyp.join(' ')));
      per[m] = err / ref.length;
      errors += err;
      n += ref.length;
      console.log(`${e.name} · ${m} : WER ${(100 * per[m]).toFixed(1)} %`);
    }
    e.stop?.();
    rows.push({ engine: e.name, wer: errors / n, rtf: ms / 1000 / audio, audio, per });
  }
  return rows;
}

async function speakers(app, refs, pcms) {
  app.ort.env.wasm.numThreads = 1; // comme le moteur de l'app
  const model = readFileSync(join(ROOT, 'src/renderer/public/models/campplus_voxceleb.onnx'));
  const print = await app.VoicePrint.create(app.ort, model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength));
  const rows = [];
  for (const m of MEETINGS) {
    // segmentation de référence (oracle) : un extrait par tour de parole AMI, tous sur le même micro
    let segs = refs[m].turns.map((t, i) => ({ id: `${m}-${i}`, ch: 'me', t0: Math.round(t.t0 * 1000), t1: Math.round(t.t1 * 1000), text: '', ref: t.spk }));
    let voices = {};
    const voicesOf = new app.Voices({
      dir: () => null,
      meta: () => ({ voices }),
      segments: () => segs,
      setVoices: (_id, v) => (voices = v),
      putSegment: (_id, seg) => (segs = segs.map((s) => (s.id === seg.id ? seg : s))),
    });
    for (const s of segs) {
      const spk = voicesOf.assign(m, s, await print.embed(float(slice(pcms[m], s.t0 / 1000, s.t1 / 1000))));
      segs = segs.map((x) => (x.id === s.id ? { ...x, spk } : x));
    }
    voicesOf.refine(m); // passe de fin de réunion
    const row = {
      meeting: m,
      real: new Set(segs.map((s) => s.ref)).size,
      found: Object.keys(voices).length,
      accuracy: attribution(segs.map((s) => ({ ref: s.ref, hyp: s.spk, dur: s.t1 - s.t0 }))),
    };
    console.log(`voix · ${m} : ${row.real} réels, ${row.found} trouvés, ${(100 * row.accuracy).toFixed(1)} % du temps bien attribué`);
    rows.push(row);
  }
  return rows;
}

async function main() {
  const parts = process.argv.slice(2);
  const want = (p) => !parts.length || parts.includes(p);
  mkdirSync(DATA, { recursive: true });
  process.env.MINUTE_USERDATA = DATA; // dossier de l'app (stub electron) : moteur et modèles whisper.cpp
  const { build } = createRequire(import.meta.url)('esbuild');
  const out = join(ROOT, 'node_modules', '.cache', 'minute-bench', 'app.mjs');
  await build({
    stdin: {
      contents: [
        "export * as ort from 'onnxruntime-web/wasm';",
        "export { Voices } from './src/main/voices';",
        "export { VoicePrint } from './src/renderer/engine/voice';",
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

  download(`https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/${ANNOTATIONS}`, join(DATA, ANNOTATIONS));
  const refs = {};
  const pcms = {};
  for (const m of MEETINGS) {
    const wav = join(DATA, `${m}.Mix-Headset.wav`);
    download(`https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/${m}/audio/${m}.Mix-Headset.wav`, wav);
    const ref = reference(m);
    refs[m] = { ...ref, chunks: chunks(ref) };
    pcms[m] = readWav(wav);
    const c = refs[m].chunks;
    console.log(`${m} : ${(pcms[m].length / 2 / SR / 60).toFixed(1)} min, ${ref.words.length} mots, ${ref.turns.length} tours, ${c.list.length} envois (${c.hard} coupes franches)`);
  }

  // un calcul lourd à la fois : transcription, puis voix
  const stt = want('stt') ? await transcription(app, refs, pcms) : [];
  const voices = want('voices') ? await speakers(app, refs, pcms) : [];
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const result = { date: new Date().toISOString().slice(0, 10), machine: `${cpus()[0].model}, ${Math.round(totalmem() / 2 ** 30)} GB`, version: pkg.version, stt, voices };
  writeFileSync(join(DATA, `results.${parts.join('-') || 'all'}.json`), JSON.stringify(result, null, 1));

  const pct = (x) => `${(100 * x).toFixed(1)} %`;
  console.log(`\n${result.date} · ${result.machine} · Minute ${result.version}\n`);
  if (stt.length) {
    console.log('| Engine | WER | Real-time factor |\n|---|---|---|');
    for (const r of stt) console.log(`| ${r.engine} | ${pct(r.wer)} | ${r.rtf.toFixed(3)} |`);
  }
  if (voices.length) {
    console.log('\n| Meeting | Real speakers | Found | Speaking time attributed correctly |\n|---|---|---|---|');
    for (const r of voices) console.log(`| ${r.meeting} | ${r.real} | ${r.found} | ${pct(r.accuracy)} |`);
  }
}

if (process.argv[1]?.endsWith('bench.mjs')) await main();
