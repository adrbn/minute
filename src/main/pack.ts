// Phrases groupées : sur l'offre gratuite de Groq, chaque requête compte au moins 10 s d'audio.
// Quand le quota horaire se resserre, plusieurs phrases courtes partent dans une seule requête
// (séparées par un court silence), puis chacune retrouve son texte grâce à l'horodatage des mots.
import type { SttResult } from './groq';

/** silence entre deux phrases : Whisper y coupe ses segments, et les mots ne débordent pas */
const GAP_SEC = 0.5;
const RATE = 16000;

export interface Span {
  start: number;
  end: number;
}

/** Assemble des WAV PCM 16 bits mono 16 kHz ; renvoie le WAV et la place de chaque phrase (secondes). */
export function packWavs(wavs: Buffer[]): { wav: Buffer; spans: Span[] } {
  const gap = Buffer.alloc(Math.round(GAP_SEC * RATE) * 2);
  const parts: Buffer[] = [];
  const spans: Span[] = [];
  let at = 0;
  wavs.forEach((w, i) => {
    const pcm = w.subarray(44);
    if (i > 0) {
      parts.push(gap);
      at += GAP_SEC;
    }
    parts.push(pcm);
    spans.push({ start: at, end: at + pcm.length / (RATE * 2) });
    at += pcm.length / (RATE * 2);
  });
  const pcm = Buffer.concat(parts);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return { wav: Buffer.concat([header, pcm]), spans };
}

/** Phrase qui contient l'instant `t` (secondes), sinon la plus proche. */
function spanOf(spans: Span[], t: number): number {
  let best = 0;
  let dist = Infinity;
  spans.forEach((s, i) => {
    const d = t < s.start ? s.start - t : t > s.end ? t - s.end : 0;
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/**
 * Rend à chaque phrase son texte et ses indicateurs (pour les filtres anti-hallucination).
 * Chaque mot du texte ponctué de Whisper est placé d'après l'horodatage du mot correspondant ;
 * sans horodatage, le segment entier va à la phrase qui contient son milieu.
 */
export function splitPacked(r: SttResult, spans: Span[]): SttResult[] {
  const acc = spans.map(() => ({ tokens: [] as string[], w: 0, noSpeech: 0, logprob: 0, compression: 0 }));
  const words = r.words ?? [];
  const segments = r.segments?.length ? r.segments : [{ start: 0, end: spans[spans.length - 1]?.end ?? 0, text: r.text, noSpeech: r.noSpeech, avgLogprob: r.avgLogprob, compression: r.compression }];
  for (const seg of segments) {
    // la ponctuation détachée (« on commence ? ») suit le mot d'avant : un jeton par mot horodaté
    const tokens: string[] = [];
    for (const tok of seg.text.trim().split(/\s+/).filter(Boolean)) {
      if (tokens.length && !/[\p{L}\p{N}]/u.test(tok)) tokens[tokens.length - 1] += ` ${tok}`;
      else tokens.push(tok);
    }
    if (!tokens.length) continue;
    const ws = words.filter((w) => w.start >= seg.start - 0.05 && w.start < seg.end + 0.05);
    tokens.forEach((tok, i) => {
      const w = ws.length ? ws[Math.min(ws.length - 1, Math.floor((i * ws.length) / tokens.length))] : null;
      const k = spanOf(spans, w ? (w.start + w.end) / 2 : (seg.start + seg.end) / 2);
      const a = acc[k];
      a.tokens.push(tok);
      a.w += 1;
      a.noSpeech += seg.noSpeech;
      a.logprob += seg.avgLogprob;
      a.compression += seg.compression;
    });
  }
  return acc.map((a) => ({
    text: a.tokens.join(' '),
    language: r.language,
    noSpeech: a.w ? a.noSpeech / a.w : 1,
    avgLogprob: a.w ? a.logprob / a.w : -1,
    compression: a.w ? a.compression / a.w : 1,
  }));
}
