// Bancs de filtres Mel « façon Kaldi » (identiques à torchaudio.compliance.kaldi.fbank avec les
// réglages par défaut) : 80 bandes, trames de 25 ms toutes les 10 ms, fenêtre de Povey,
// préaccentuation 0,97, logarithme de l'énergie. C'est l'entrée attendue par les modèles
// d'empreinte vocale (CAM++ de 3D-Speaker).

const SR = 16000;
const FRAME = 400; // 25 ms
const SHIFT = 160; // 10 ms
const NFFT = 512;
export const MEL_BINS = 80;
const EPS = 1.1920928955078125e-7; // epsilon float32, plancher de Kaldi

const mel = (f: number) => 1127 * Math.log(1 + f / 700);

interface Tables {
  window: Float64Array;
  banks: { first: number; weights: Float64Array }[];
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint16Array;
}
let tables: Tables | null = null;

function setup(): Tables {
  if (tables) return tables;
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)), 0.85);

  // filtres triangulaires, espacés régulièrement sur l'échelle Mel entre 20 Hz et 8 kHz
  const lo = mel(20);
  const hi = mel(SR / 2);
  const delta = (hi - lo) / (MEL_BINS + 1);
  const bins = NFFT / 2;
  const banks: Tables['banks'] = [];
  for (let b = 0; b < MEL_BINS; b++) {
    const left = lo + b * delta;
    const center = left + delta;
    const right = center + delta;
    const w = new Float64Array(bins);
    let first = -1;
    let last = -1;
    for (let i = 0; i < bins; i++) {
      const m = mel((SR / NFFT) * i);
      if (m > left && m < right) {
        w[i] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
        if (first < 0) first = i;
        last = i;
      }
    }
    banks.push({ first: Math.max(0, first), weights: w.slice(Math.max(0, first), last + 1) });
  }

  // FFT radix 2
  const cos = new Float64Array(NFFT / 2);
  const sin = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / NFFT);
    sin[i] = Math.sin((-2 * Math.PI * i) / NFFT);
  }
  const rev = new Uint16Array(NFFT);
  const bitsN = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) {
    let r = 0;
    for (let b = 0; b < bitsN; b++) r |= ((i >> b) & 1) << (bitsN - 1 - b);
    rev[i] = r;
  }
  tables = { window, banks, cos, sin, rev };
  return tables;
}

function powerSpectrum(frame: Float64Array, t: Tables, out: Float64Array) {
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) re[t.rev[i]] = frame[i];
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = t.cos[k * step];
        const s = t.sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * c - im[b] * s;
        const xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  for (let i = 0; i <= NFFT / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
}

/**
 * Caractéristiques [trames × 80] d'un signal mono 16 kHz (échantillons dans [-1, 1]),
 * centrées (moyenne de chaque bande retirée sur l'extrait, comme le veut le modèle).
 */
export function fbank(pcm: Float32Array): { data: Float32Array; frames: number } {
  const t = setup();
  const frames = pcm.length < FRAME ? 0 : 1 + Math.floor((pcm.length - FRAME) / SHIFT);
  const data = new Float32Array(frames * MEL_BINS);
  const buf = new Float64Array(NFFT);
  const power = new Float64Array(NFFT / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const off = f * SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME; i++) mean += pcm[off + i];
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) buf[i] = pcm[off + i] - mean;
    for (let i = FRAME - 1; i > 0; i--) buf[i] -= 0.97 * buf[i - 1];
    buf[0] -= 0.97 * buf[0];
    for (let i = 0; i < FRAME; i++) buf[i] *= t.window[i];
    buf.fill(0, FRAME);
    powerSpectrum(buf, t, power);
    for (let b = 0; b < MEL_BINS; b++) {
      const { first, weights } = t.banks[b];
      let e = 0;
      for (let i = 0; i < weights.length; i++) e += weights[i] * power[first + i];
      data[f * MEL_BINS + b] = Math.log(Math.max(e, EPS));
    }
  }
  if (frames) {
    for (let b = 0; b < MEL_BINS; b++) {
      let m = 0;
      for (let f = 0; f < frames; f++) m += data[f * MEL_BINS + b];
      m /= frames;
      for (let f = 0; f < frames; f++) data[f * MEL_BINS + b] -= m;
    }
  }
  return { data, frames };
}

/** Similarité cosinus de deux empreintes. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
