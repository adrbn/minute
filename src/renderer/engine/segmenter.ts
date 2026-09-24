// Découpe le flux en « phrases » pour Whisper.
// Objectif : des extraits de 3 à 16 s coupés sur de vraies pauses, pour que
// le texte arrive vite, reste cohérent, et ménage le quota Groq (10 s minimum
// facturées par requête).
export const FRAME = 512;
export const FRAME_MS = 32;
const PRE_FRAMES = 10; // 320 ms conservés avant le début de parole
const TAIL_FRAMES = 6; // ~190 ms gardés après la fin
const START_FRAMES = 3; // ~96 ms de parole franche pour déclencher
const MAX_MS = 16_000;
const MIN_SPEECH_MS = 280;

export interface SegmentOut {
  t0: number;
  t1: number;
  pcm: Float32Array;
  interim: boolean;
}

export class Segmenter {
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private probs: number[] = [];
  private speaking = false;
  private t0 = 0;
  private posRun = 0;
  private silenceRun = 0;
  private speechFrames = 0;
  private lastInterimAt = 0;

  constructor(
    private readonly emit: (s: SegmentOut) => void,
    public livePreview: boolean,
  ) {}

  get isSpeaking() {
    return this.speaking;
  }

  /** `t` = instant (ms d'enregistrement) du début de la trame. */
  push(frame: Float32Array, p: number, t: number) {
    if (!this.speaking) {
      this.pre.push(frame);
      if (this.pre.length > PRE_FRAMES) this.pre.shift();
      this.posRun = p >= 0.5 ? this.posRun + 1 : 0;
      if (this.posRun >= START_FRAMES) {
        this.speaking = true;
        this.frames = [...this.pre];
        this.probs = this.pre.map((_, i) => (i >= this.pre.length - this.posRun ? p : 0));
        this.t0 = t - (this.pre.length - 1) * FRAME_MS;
        this.pre = [];
        this.silenceRun = 0;
        this.speechFrames = this.posRun;
        this.lastInterimAt = t;
      }
      return;
    }

    this.frames.push(frame);
    this.probs.push(p);
    if (p >= 0.5) {
      this.speechFrames++;
      this.silenceRun = 0;
    } else if (p < 0.35) {
      this.silenceRun++;
    }

    const dur = this.frames.length * FRAME_MS;
    // plus la phrase est longue, plus on coupe volontiers sur une pause courte
    const redemption = dur < 2500 ? 900 : dur < 8000 ? 600 : dur < 13_000 ? 350 : 220;
    if (this.silenceRun * FRAME_MS >= redemption) {
      this.finish(this.frames.length - this.silenceRun + TAIL_FRAMES);
      return;
    }
    if (dur >= MAX_MS) {
      this.cutAtBestPause();
      return;
    }
    if (this.livePreview && t - this.lastInterimAt >= 3000 && this.speechFrames * FRAME_MS >= 1200) {
      this.lastInterimAt = t;
      this.emit({ t0: this.t0, t1: t + FRAME_MS, pcm: concat(this.frames), interim: true });
    }
  }

  /** Termine la phrase en cours (pause, arrêt). */
  flush() {
    if (this.speaking) this.finish(this.frames.length);
    this.pre = [];
    this.posRun = 0;
  }

  private finish(keep: number) {
    keep = Math.min(this.frames.length, Math.max(1, keep));
    const kept = this.frames.slice(0, keep);
    const rest = this.frames.slice(keep);
    if (this.speechFrames * FRAME_MS >= MIN_SPEECH_MS) {
      this.emit({ t0: this.t0, t1: this.t0 + kept.length * FRAME_MS, pcm: concat(kept), interim: false });
    }
    this.speaking = false;
    this.frames = [];
    this.probs = [];
    this.pre = rest.slice(-PRE_FRAMES);
    this.posRun = 0;
    this.silenceRun = 0;
    this.speechFrames = 0;
  }

  /** Phrase trop longue : coupe au creux de parole le plus net des 4 dernières secondes. */
  private cutAtBestPause() {
    const n = this.probs.length;
    const from = Math.max(8, n - Math.round(4000 / FRAME_MS));
    let best = n - 1;
    let bestScore = Infinity;
    for (let i = from; i < n - 2; i++) {
      const w = (this.probs[i - 1] + this.probs[i] + this.probs[i + 1]) / 3;
      if (w < bestScore) {
        bestScore = w;
        best = i;
      }
    }
    const head = this.frames.slice(0, best);
    const tail = this.frames.slice(best);
    const tailProbs = this.probs.slice(best);
    this.emit({ t0: this.t0, t1: this.t0 + head.length * FRAME_MS, pcm: concat(head), interim: false });
    this.t0 = this.t0 + head.length * FRAME_MS;
    this.frames = tail;
    this.probs = tailProbs;
    this.speechFrames = tailProbs.filter((q) => q >= 0.5).length;
    this.silenceRun = 0;
    this.lastInterimAt = this.t0;
  }
}

export function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}

export function toInt16(pcm: Float32Array): ArrayBuffer {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}
