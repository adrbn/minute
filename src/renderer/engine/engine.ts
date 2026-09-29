// Moteur de capture (fenêtre invisible) : micro + son de l'ordinateur,
// détection de parole, découpage, envoi des extraits au process principal.
import * as ort from 'onnxruntime-web/wasm';
import type { Channel, EngineBridge, EngineStartOptions } from '../../shared/types';
import { FRAME, FRAME_MS, rms, Segmenter, toInt16 } from './segmenter';
import { SileroVad } from './vad';
import { VoicePrint } from './voice';

declare global {
  interface Window {
    engine: EngineBridge;
    __minuteStart?: (o: EngineStartOptions) => Promise<{ me: boolean; them: boolean }>;
    __minuteLoopback?: () => Promise<boolean>;
  }
}

const bridge = window.engine;
ort.env.wasm.numThreads = 1; // pas de SharedArrayBuffer nécessaire

let modelBytes: ArrayBuffer | null = null;
async function model(): Promise<ArrayBuffer> {
  if (!modelBytes) modelBytes = await (await fetch('./models/silero_vad.onnx')).arrayBuffer();
  return modelBytes;
}

// Empreintes de voix (séparation des intervenants) : modèle chargé à la première utilisation.
let voicePrint: Promise<VoicePrint | null> | null = null;
function voiceModel(): Promise<VoicePrint | null> {
  voicePrint ??= fetch('./models/campplus_voxceleb.onnx')
    .then((r) => r.arrayBuffer())
    .then((b) => VoicePrint.create(ort, b))
    .catch((e) => {
      bridge.log(`empreinte vocale indisponible : ${(e as Error).message}`);
      return null;
    });
  return voicePrint;
}

// Horloge d'enregistrement (pauses exclues), alignée sur celle du process principal.
const clock = {
  startedAt: 0,
  pausedMs: 0,
  pausedAt: 0,
  now() {
    const paused = this.pausedMs + (this.pausedAt ? Date.now() - this.pausedAt : 0);
    return Date.now() - this.startedAt - paused;
  },
};

class Pipe {
  level = 0;
  private chain: Promise<void> = Promise.resolve();
  private carry = new Float32Array(0);
  stream: MediaStream | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  node: AudioWorkletNode | null = null;

  constructor(
    readonly ch: Channel,
    readonly vad: SileroVad,
    readonly seg: Segmenter,
    /** envois vers le process principal, dans l'ordre (l'empreinte vocale prend quelques centaines de ms) */
    readonly out: { chain: Promise<void> },
  ) {}

  /** Trame de 512 échantillons arrivée maintenant. */
  frame(f: Float32Array, arrivedAt = clock.now()) {
    if (paused || stopped) return;
    const t = arrivedAt - FRAME_MS;
    const lvl = levelOf(f);
    this.level = Math.max(this.level * 0.7, lvl);
    if (this.ch === 'them' && lvl > SYS_SOUND) sys.lastSound = performance.now();
    this.chain = this.chain.then(async () => {
      try {
        const p = await this.vad.prob(f);
        this.seg.push(f, p, t);
      } catch (e) {
        bridge.log(`vad ${this.ch}: ${(e as Error).message}`);
      }
    });
  }

  /** PCM 16 bits (macOS / AudioTee) → trames. */
  pcm16(buf: ArrayBuffer) {
    const i16 = new Int16Array(buf);
    const f = new Float32Array(this.carry.length + i16.length);
    f.set(this.carry, 0);
    for (let i = 0; i < i16.length; i++) f[this.carry.length + i] = i16[i] / 0x8000;
    const now = clock.now();
    const frames = Math.floor(f.length / FRAME);
    for (let k = 0; k < frames; k++) {
      const at = now - (frames - 1 - k) * FRAME_MS;
      this.frame(f.slice(k * FRAME, (k + 1) * FRAME), at);
    }
    this.carry = f.slice(frames * FRAME);
  }

  async drain() {
    await this.chain;
    this.seg.flush();
    await this.out.chain;
    this.vad.reset();
  }

  close() {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
  }
}

function levelOf(f: Float32Array) {
  const r = rms(f);
  if (r <= 1e-6) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(r) + 55) / 50));
}

let ctx: AudioContext | null = null;
let pipes: Partial<Record<Channel, Pipe>> = {};
let paused = false;
let stopped = true;
let levelTimer: number | null = null;
/**
 * Son de l'ordinateur (Windows) : la capture « loopback » reste attachée à la sortie audio par défaut
 * du moment où elle a été ouverte. Si l'appel sort ailleurs (sortie par défaut changée, casque branché…),
 * elle reste « vivante » mais muette. On la rouvre quand les périphériques changent, ou quand elle est
 * parfaitement muette depuis 1 min alors qu'on parle au micro.
 */
const sys = { mode: 'off' as EngineStartOptions['systemMode'], lastSound: 0, lastMicSpeech: 0, lastRefresh: 0, refreshes: 0, warned: false };
/** au-dessus : quelque chose joue (même un souffle) ; en dessous : silence numérique */
const SYS_SOUND = 0.0003;
/** chaque démarrage / arrêt incrémente la génération : un démarrage dépassé s'annule de lui-même */
let generation = 0;
/** un modèle VAD par voix, créé une fois pour toute la vie de l'app */
const vads: Partial<Record<Channel, SileroVad>> = {};

async function makePipe(ch: Channel, livePreview: boolean, voices: boolean): Promise<Pipe> {
  let vad = vads[ch];
  if (!vad) vad = vads[ch] = await SileroVad.create(ort, await model());
  vad.reset();
  const out = { chain: Promise.resolve() };
  if (voices) void voiceModel(); // chargé pendant que la réunion démarre
  const seg = new Segmenter((s) => {
    const base = { ch, t0: s.t0, t1: s.t1, pcm: toInt16(s.pcm), interim: s.interim };
    if (!voices) return bridge.segment(base);
    out.chain = out.chain.then(async () => {
      let voice: number[] | undefined;
      if (!s.interim) {
        try {
          voice = await (await voiceModel())?.embed(s.pcm);
        } catch (e) {
          bridge.log(`empreinte ${ch}: ${(e as Error).message}`);
        }
      }
      bridge.segment({ ...base, voice });
    });
  }, livePreview);
  return new Pipe(ch, vad, seg, out);
}

async function attachStream(pipe: Pipe, stream: MediaStream) {
  if (!ctx) throw new Error('AudioContext absent');
  pipe.stream = stream;
  pipe.source = ctx.createMediaStreamSource(stream);
  pipe.node = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  pipe.node.port.onmessage = (e: MessageEvent<Float32Array>) => pipe.frame(e.data);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  pipe.source.connect(pipe.node);
  pipe.node.connect(mute).connect(ctx.destination);
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

async function getMic(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS,
    });
  } catch (e) {
    if (!deviceId) throw e;
    // micro choisi introuvable : micro par défaut
    return navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  }
}

async function attachMic(pipe: Pipe, stream: MediaStream) {
  await attachStream(pipe, stream);
  const track = stream.getAudioTracks()[0];
  bridge.status('me', true);
  const gen = generation;
  track.onended = () => {
    if (stopped || gen !== generation) return;
    bridge.status('me', false, 'Micro déconnecté — reconnexion au micro par défaut…');
    pipe.close();
    setTimeout(async () => {
      if (stopped || gen !== generation) return;
      try {
        const s = await getMic('');
        if (stopped || gen !== generation) return s.getTracks().forEach((t) => t.stop());
        await attachMic(pipe, s);
      } catch (err) {
        bridge.status('me', false, `Micro indisponible : ${(err as Error).message}`);
      }
    }, 800);
  };
}

/** Son de l'ordinateur (Windows) : demandé en PREMIER, tant que le « geste utilisateur » est valide. */
async function getLoopback(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  const audio = stream.getAudioTracks();
  if (!audio.length) throw new Error('Aucune piste audio système');
  return new MediaStream(audio);
}

function micError(e: Error): string {
  if (e.name === 'NotAllowedError') return 'Accès au micro refusé par le système.';
  if (e.name === 'NotFoundError') return 'Aucun micro détecté.';
  if (e.name === 'NotReadableError') return 'Le micro est bloqué par une autre application.';
  return `Micro indisponible : ${e.message}`;
}

async function start(o: EngineStartOptions): Promise<{ me: boolean; them: boolean }> {
  if (!stopped) await stop(false);
  const gen = ++generation;
  const opened: MediaStream[] = [];
  const cancelled = () => {
    if (gen === generation) return false;
    opened.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    return true;
  };
  const result = { me: false, them: false };

  // 1. son de l'ordinateur d'abord (le geste utilisateur expire au bout de quelques secondes)
  let loopback: MediaStream | null = null;
  let loopbackError = '';
  if (o.captureSystem && o.systemMode === 'display') {
    try {
      loopback = await getLoopback();
      opened.push(loopback);
    } catch (e) {
      loopbackError = (e as Error).message;
    }
  }
  if (cancelled()) return result;

  // 2. micro
  let mic: MediaStream | null = null;
  try {
    mic = await getMic(o.micDeviceId);
    opened.push(mic);
  } catch (e) {
    bridge.status('me', false, micError(e as Error));
  }
  if (cancelled()) return result;

  // 3. chaîne audio + détection de parole
  stopped = false;
  paused = false;
  clock.startedAt = o.startedAt;
  clock.pausedMs = o.pausedMs ?? 0;
  clock.pausedAt = 0;
  ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' });
  await ctx.audioWorklet.addModule('./worklets/pcm-tap.js');
  if (ctx.state === 'suspended') await ctx.resume();
  if (cancelled()) return result;

  pipes.me = await makePipe('me', o.livePreview, o.voices);
  if (mic) {
    await attachMic(pipes.me, mic);
    result.me = true;
  }
  if (o.captureSystem) {
    pipes.them = await makePipe('them', o.livePreview, o.voices);
    if (o.systemMode === 'display') {
      if (loopback) {
        await attachStream(pipes.them, loopback);
        bridge.status('them', true);
        watchLoopbackEnd(loopback, gen);
        const now = performance.now();
        Object.assign(sys, { mode: 'display', lastSound: now, lastMicSpeech: 0, lastRefresh: now, refreshes: 0, warned: false });
        navigator.mediaDevices.ondevicechange = () => {
          // sortie audio changée : la capture doit suivre (le process principal la rouvre avec un « geste »)
          if (!stopped && gen === generation && sys.mode === 'display') setTimeout(() => bridge.requestLoopback(), 1000);
        };
        result.them = true;
      } else {
        bridge.status('them', false, `Son de l’ordinateur indisponible : ${loopbackError}`);
      }
    } else {
      result.them = true; // le PCM arrive du process principal (AudioTee)
    }
  }
  if (cancelled()) return result;

  levelTimer = window.setInterval(() => {
    const me = pipes.me?.level ?? 0;
    const them = pipes.them?.level ?? 0;
    bridge.levels({
      me: paused ? 0 : me,
      them: paused ? 0 : them,
      meSpeaking: !paused && !!pipes.me?.seg.isSpeaking,
      themSpeaking: !paused && !!pipes.them?.seg.isSpeaking,
    });
    if (pipes.me) pipes.me.level *= 0.6;
    if (pipes.them) pipes.them.level *= 0.6;
    watchSystemSilence();
  }, 90);
  return result;
}

function watchLoopbackEnd(stream: MediaStream, gen: number) {
  stream.getAudioTracks()[0].onended = () => {
    if (!stopped && gen === generation) bridge.status('them', false, 'Capture du son de l’ordinateur interrompue');
  };
}

/** Capture du son de l'ordinateur muette depuis 1 min alors qu'on parle au micro : on la rouvre. */
function watchSystemSilence() {
  if (sys.mode !== 'display' || !pipes.them || paused || stopped) return;
  const now = performance.now();
  if (pipes.me?.seg.isSpeaking) sys.lastMicSpeech = now;
  const silentFor = now - sys.lastSound;
  if (sys.warned && silentFor < 1000) {
    sys.warned = false;
    sys.refreshes = 0;
    bridge.status('them', true);
  }
  if (silentFor < 60_000 || now - sys.lastMicSpeech > 60_000 || now - sys.lastRefresh < 60_000) return;
  sys.lastRefresh = now;
  sys.refreshes++;
  bridge.log(`son de l'ordinateur muet depuis ${Math.round(silentFor / 1000)} s alors qu'on parle : reconnexion (${sys.refreshes})`);
  bridge.requestLoopback();
  // 5 min de silence malgré les reconnexions : peut-être personne d'autre ne parle, peut-être l'appel sort ailleurs
  if (sys.refreshes >= 5 && !sys.warned) {
    sys.warned = true;
    bridge.status('them', false, 'Aucun son de l’appel reçu depuis 5 min. Si les autres parlent, vérifiez la sortie audio de l’appel.');
  }
}

/** Rouvre la capture du son de l'ordinateur (appelé par le process principal, avec « geste utilisateur »). */
async function refreshLoopback(): Promise<boolean> {
  const pipe = pipes.them;
  if (stopped || !ctx || !pipe?.node || sys.mode !== 'display') return false;
  const gen = generation;
  try {
    const s = await getLoopback();
    if (stopped || gen !== generation || pipes.them !== pipe || !ctx || !pipe.node) {
      s.getTracks().forEach((t) => t.stop());
      return false;
    }
    const old = pipe.stream;
    const src = ctx.createMediaStreamSource(s);
    src.connect(pipe.node);
    pipe.source?.disconnect();
    pipe.source = src;
    pipe.stream = s;
    old?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    watchLoopbackEnd(s, gen);
    bridge.log('son de l’ordinateur : capture rouverte');
    return true;
  } catch (e) {
    bridge.log(`son de l’ordinateur : réouverture impossible (${(e as Error).message})`);
    return false;
  }
}

async function stop(notify = true) {
  generation++;
  stopped = true;
  sys.mode = 'off';
  navigator.mediaDevices.ondevicechange = null;
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  const all = Object.values(pipes) as Pipe[];
  all.forEach((p) => p.close());
  // la VAD finit les trames déjà reçues, puis la dernière phrase part
  await Promise.all(all.map((p) => p.drain()));
  pipes = {};
  await ctx?.close().catch(() => undefined);
  ctx = null;
  if (notify) bridge.stopped();
}

window.__minuteStart = start;
window.__minuteLoopback = refreshLoopback;
// Diagnostic : charge la VAD et mesure une trame de silence (≈ 0).
(window as unknown as { __minuteSelfTest: () => Promise<number> }).__minuteSelfTest = async () => {
  const vad = await SileroVad.create(ort, await model());
  return vad.prob(new Float32Array(FRAME));
};
bridge.onPause(() => {
  paused = true;
  clock.pausedAt = Date.now();
  for (const p of Object.values(pipes) as Pipe[]) void p.drain();
});
bridge.onResume(() => {
  if (clock.pausedAt) clock.pausedMs += Date.now() - clock.pausedAt;
  clock.pausedAt = 0;
  paused = false;
});
bridge.onStop(() => void stop(true));
bridge.onSystemPcm((buf) => pipes.them?.pcm16(buf));

// Préchauffe les modèles pour un démarrage instantané.
void model().then(async (m) => {
  try {
    vads.me ??= await SileroVad.create(ort, m);
    vads.them ??= await SileroVad.create(ort, m);
  } catch (e) {
    bridge.log(`préchauffage VAD : ${(e as Error).message}`);
  }
});
