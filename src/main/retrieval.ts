// Recherche des passages utiles pour répondre à une question sur une longue réunion :
// une seule requête courte au lieu de relire toute la transcription par morceaux
// (l'offre gratuite de Groq limite le débit à quelques milliers de tokens par minute).
import { clock, normalize, toTurns, turnText, voiceLabel } from '../shared/transcript';
import type { MeetingMeta, Segment } from '../shared/types';

const STOP = new Set(
  `les des une est que qui quoi quel quelle quels quelles dans pour avec sur par pas plus moins aux
  nous vous ils elles elle lui leur leurs cet cette ces son ses mon mes ton tes notre nos votre vos
  ont avons avez suis sommes etes sont etait etaient ete etre avoir fait faire faut dit dire
  parle parler parlait parlent parlons discute discuter aborde aborder evoque evoquer mentionne
  question questions reunion quand comment pourquoi combien alors donc mais car tout tous toute toutes
  tres bien aussi encore deja oui non ouais euh ben bon voila cest quil quelle quon ceux celle celui
  chose choses truc trucs quelque quelques peu beaucoup avait aura sera serait pourrait peut peuvent
  moi toi soi eux entre vers chez sans sous depuis pendant apres avant rien ici etc via the and`.split(/\s+/),
);

interface Passage {
  t0: number;
  line: string;
  words: string[];
  counts: Map<string, number>;
  squashed: string;
}

/** même mot à une flexion près (« budget » / « budgets », « inscrit » / « inscrits ») */
const sameWord = (a: string, b: string) => {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.length - s.length <= 3 && l.startsWith(s);
};
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface Retrieved {
  /** extraits horodatés, dans l'ordre chronologique */
  text: string;
  /** termes de la question retrouvés dans la réunion */
  matched: string[];
  passages: number;
}

/**
 * Sélectionne les passages les plus pertinents (BM25, tolérant aux mots collés
 * « culturetech » / « culture tech » et aux fautes de transcription) dans la limite de `budgetChars`.
 */
export function retrieve(meta: MeetingMeta, segments: Segment[], question: string, budgetChars: number): Retrieved | null {
  const passages: Passage[] = toTurns(segments.filter((s) => s.text.trim())).map((turn) => {
    const text = turnText(turn);
    const ws = words(text);
    const counts = new Map<string, number>();
    for (const w of ws) counts.set(w, (counts.get(w) ?? 0) + 1);
    return {
      t0: turn.t0,
      line: `[${clock(turn.t0)}] ${voiceLabel(meta, turn.ch, turn.spk)} : ${text}`,
      words: ws,
      counts,
      squashed: normalize(text).replace(/[^a-z0-9]/g, ''),
    };
  });
  if (!passages.length) return null;

  // termes de la question (+ mots accolés deux à deux : « culture tech » → « culturetech »)
  const qWords = words(question).filter((w) => !STOP.has(w));
  const terms = new Set(qWords);
  for (let i = 0; i + 1 < qWords.length; i++) terms.add(qWords[i] + qWords[i + 1]);

  // mot absent de la réunion : on essaie les mots proches (erreur de transcription d'un nom)
  const vocab = new Set(passages.flatMap((p) => p.words));
  const tf = (p: Passage, term: string) => {
    let f = 0;
    for (const [w, c] of p.counts) if (sameWord(w, term)) f += c;
    // mot collé dans la question, séparé dans la transcription (ou l'inverse)
    return f || (term.length >= 7 && p.squashed.includes(term) ? 1 : 0);
  };
  const expanded = new Map<string, string[]>();
  for (const term of terms) {
    if (passages.some((p) => tf(p, term) > 0)) {
      expanded.set(term, [term]);
      continue;
    }
    if (term.length < 5) continue;
    const max = term.length >= 8 ? 2 : 1;
    const near = [...vocab].filter((w) => w.length >= 4 && distance(term, w, max) <= max);
    if (near.length && near.length <= 6) expanded.set(term, near);
  }
  if (!expanded.size) return null;

  const n = passages.length;
  const avg = passages.reduce((a, p) => a + p.words.length, 0) / n;
  const stats = [...expanded.values()].map((variants) => {
    const df = passages.filter((q) => variants.some((v) => tf(q, v) > 0)).length;
    return { variants, idf: Math.log(1 + (n - df + 0.5) / (df + 0.5)) };
  });
  const scores = passages.map((p) => {
    let score = 0;
    for (const { variants, idf } of stats) {
      const f = Math.max(...variants.map((v) => tf(p, v)));
      if (f) score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * p.words.length) / avg));
    }
    return score;
  });

  const order = scores
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0]);
  if (!order.length) return null;

  // les meilleurs passages, avec leur contexte immédiat, tant que ça rentre
  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    if (i < 0 || i >= n || chosen.has(i)) return true;
    const cost = passages[i].line.length + 1;
    if (used + cost > budgetChars) return false;
    chosen.add(i);
    used += cost;
    return true;
  };
  for (const [, i] of order) {
    if (!take(i)) break;
    take(i + 1);
    take(i - 1);
  }
  if (!chosen.size) {
    // un seul passage énorme : on le tronque plutôt que de ne rien envoyer
    const i = order[0][1];
    return { text: passages[i].line.slice(0, budgetChars), matched: [...expanded.keys()], passages: 1 };
  }

  const idx = [...chosen].sort((a, b) => a - b);
  const out: string[] = [];
  idx.forEach((i, k) => {
    if (k > 0 && i !== idx[k - 1] + 1) out.push('…');
    out.push(passages[i].line);
  });
  return { text: out.join('\n'), matched: [...expanded.keys()], passages: idx.length };
}
