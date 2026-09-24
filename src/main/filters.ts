// Nettoyage des résultats Whisper : hallucinations classiques et écho micro.
import { contentWords, normalize } from '../shared/transcript';
import type { Segment } from '../shared/types';
import type { SttResult } from './groq';

// Phrases que Whisper « invente » sur du silence ou de la musique (FR / IT / EN).
const ALWAYS_FAKE = [
  /amara\.org/i,
  /sous-?titr(age|es|é)/i,
  /radio-canada/i,
  /st' ?501/i,
  /abonnez-vous/i,
  /merci d'avoir regard[ée]/i,
  /sottotitoli (creati|a cura)/i,
  /qtss/i,
  /thanks? for watching/i,
  /subtitles by/i,
  /^\s*(\[|\()?(musique|music|applaudissements|rires|silence)(\]|\))?\s*\.?\s*$/i,
];

const WEAK_FAKE = [/^\s*(merci|merci beaucoup|thank you|thanks|grazie|bye|au revoir)[\s.!]*$/i];
const ONLY_PUNCT = /^[\s.…,!?;:'"«»-]*$/;

/** Hallucination certaine (texte seul, sans métadonnées Whisper) — sert aussi à l'import. */
export function isHallucination(text: string): boolean {
  return ALWAYS_FAKE.some((re) => re.test(text));
}

/** Retire les hallucinations « collées » dans un texte plus long (données importées). */
export function stripHallucinations(text: string): string {
  return text
    .replace(/sous-?titrage[^.!?]*(radio-canada|st' ?501|fr ?20\d\d)[^.!?]*[.!?]?/gi, '')
    .replace(/sous-?titres? réalisés? (par|para) la communauté d'amara\.org\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function cleanResult(r: SttResult): string {
  let text = r.text.replace(/\s+/g, ' ').trim();
  if (!text || ONLY_PUNCT.test(text)) return '';
  if (ALWAYS_FAKE.some((re) => re.test(text))) return '';
  if (WEAK_FAKE.some((re) => re.test(text)) && (r.noSpeech > 0.35 || r.avgLogprob < -0.6)) return '';
  if (r.noSpeech > 0.7 && r.avgLogprob < -0.8) return '';
  if (r.compression > 2.6) text = collapseRepeats(text);
  return text;
}

/** « oui oui oui oui oui… » → « oui oui oui… » */
function collapseRepeats(text: string): string {
  const words = text.split(' ');
  const out: string[] = [];
  for (const w of words) {
    const n = out.length;
    if (n >= 3 && out[n - 1] === w && out[n - 2] === w && out[n - 3] === w) continue;
    out.push(w);
  }
  return out.join(' ');
}

/**
 * Sans casque, le micro réentend les participants : même phrase sur « Moi » et « Eux ».
 * On mesure la part des mots du segment micro présents dans ce que disait « Eux » au même moment.
 */
export function isEcho(mine: Segment, theirs: Segment[]): boolean {
  const words = contentWords(mine.text);
  if (words.length < 3) {
    // phrase très courte : écho seulement si identique mot pour mot
    const n = normalize(mine.text).replace(/[^a-z0-9 ]/g, '').trim();
    return !!n && theirs.some((t) => normalize(t.text).includes(n)) && words.length > 0;
  }
  const pool = new Set(theirs.flatMap((t) => contentWords(t.text)));
  if (!pool.size) return false;
  const hit = words.filter((w) => pool.has(w)).length;
  return hit / words.length >= 0.6;
}

export function overlapping(segments: Segment[], s: Segment, marginMs = 4000): Segment[] {
  return segments.filter((o) => o.id !== s.id && o.t1 >= s.t0 - marginMs && o.t0 <= s.t1 + marginMs);
}

/** Contexte donné à Whisper : vocabulaire perso + fin de ce qui vient d'être dit. */
export function buildPrompt(vocabulary: string, previous: string): string {
  const vocab = vocabulary
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .join(', ');
  const tail = previous.slice(-420);
  const prompt = [vocab, tail].filter(Boolean).join('. ');
  return prompt.slice(-800);
}
