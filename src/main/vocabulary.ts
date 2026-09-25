// Vocabulaire qui s'enrichit avec le temps :
// 1. chaque correction faite à la main (double-clic sur une phrase) est apprise
//    et réappliquée automatiquement aux transcriptions suivantes ;
// 2. les noms propres et sigles récurrents des réunions sont proposés à l'ajout ;
// 3. les participants de l'agenda complètent le contexte donné à Whisper.
import { normalize } from '../shared/transcript';
import type { LearnedCorrection, MeetingMeta, Segment } from '../shared/types';

const STOP = new Set(
  'le la les un une des de du et est en que qui ne pas pour par sur au aux ce cet cette ces se sa son ses il elle on nous vous ils elles je tu me te mais ou donc or ni car avec dans plus moins tout tous très bien alors oui non ça cela comme aussi fait faire être avoir va vais sont été ok okay ouais ouai bah ben bon voilà voila merci bonjour salut hello donc euh hein allô allo super parfait génial d’accord'.split(
    ' ',
  ),
);

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Un terme « à apprendre » : nom propre, sigle, mot avec chiffres ou majuscules internes. */
function looksLikeTerm(s: string) {
  return /\p{Lu}/u.test(s) || /\d/.test(s);
}

/** Compare l'ancien et le nouveau texte d'une phrase corrigée et en déduit des substitutions. */
export function learnFromEdit(before: string, after: string): LearnedCorrection[] {
  const a = words(before);
  const b = words(after);
  if (!a.length || !b.length || a.length > 120 || b.length > 120) return [];
  // plus longue sous-suite commune (mots normalisés)
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: LearnedCorrection[] = [];
  let i = 0;
  let j = 0;
  let oldRun: string[] = [];
  let newRun: string[] = [];
  const flush = () => {
    if (oldRun.length && newRun.length && oldRun.length <= 3 && newRun.length <= 3) {
      const from = oldRun.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).join(' ');
      const to = newRun.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).join(' ');
      const nf = normalize(from);
      if (from.length >= 3 && to.length >= 2 && from !== to && looksLikeTerm(to) && !STOP.has(nf) && !STOP.has(normalize(to))) {
        out.push({ from, to, count: 1 });
      }
    }
    oldRun = [];
    newRun = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) newRun.push(b[j++]);
    else oldRun.push(a[i++]);
  }
  flush();
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Réapplique les corrections apprises (mot entier, sans tenir compte de la casse). */
export function applyCorrections(text: string, learned: LearnedCorrection[]): string {
  let out = text;
  for (const c of learned) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(c.from)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, c.to);
  }
  return out;
}

export function mergeLearned(list: LearnedCorrection[], add: LearnedCorrection[]): LearnedCorrection[] {
  const next = [...list];
  for (const c of add) {
    const k = next.findIndex((x) => normalize(x.from) === normalize(c.from));
    if (k >= 0) next[k] = { from: next[k].from, to: c.to, count: next[k].count + 1 };
    else next.push(c);
  }
  return next.slice(-300);
}

export function vocabularyList(vocab: string): string[] {
  return vocab
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Noms propres et sigles récurrents, pas encore dans le vocabulaire. */
export function suggestTerms(
  meetings: { meta: MeetingMeta; segments: Segment[] }[],
  vocab: string,
  learned: LearnedCorrection[],
): { term: string; count: number; meetings: number }[] {
  const known = new Set([...vocabularyList(vocab), ...learned.map((l) => l.to)].map((v) => normalize(v)));
  const stats = new Map<string, { term: string; count: number; meetings: Set<string> }>();
  for (const { meta, segments } of meetings) {
    for (const s of segments) {
      const toks = s.text.split(/\s+/);
      for (let k = 0; k < toks.length; k++) {
        const raw = toks[k];
        const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (w.length < 2) continue;
        const prev = k > 0 ? toks[k - 1] : '';
        const sentenceStart = k === 0 || /[.!?…:]$/.test(prev);
        const acronym = /^\p{Lu}{2,6}\d{0,2}$/u.test(w);
        const proper = /^\p{Lu}\p{Ll}{2,}$/u.test(w) && !sentenceStart;
        if (!acronym && !proper) continue;
        const key = normalize(w);
        if (known.has(key) || STOP.has(key)) continue;
        const e = stats.get(key) ?? { term: w, count: 0, meetings: new Set<string>() };
        e.count++;
        e.meetings.add(meta.id);
        stats.set(key, e);
      }
    }
  }
  return [...stats.values()]
    .filter((e) => e.count >= 3 && e.meetings.size >= 2)
    .sort((x, y) => y.meetings.size - x.meetings.size || y.count - x.count)
    .slice(0, 24)
    .map((e) => ({ term: e.term, count: e.count, meetings: e.meetings.size }));
}

/** Prénoms qui sont aussi des mots courants en anglais, français ou italien (« I will », « la pierre », « sarà »). */
const COMMON_WORD_NAMES = new Set(
  (
    'will bill mark grace hope rose pat sue may june april frank rich rob guy jack joy faith art chase dawn drew gene max ' +
    'nick ray sandy summer amber carol chip crystal daisy glen holly iris ivy jade lily lance miles norm penny pearl reed ' +
    'ruby rusty sky sunny wade woody autumn brook cliff dean don hunter mason pepper basil cash heather hazel olive violet ' +
    'sage roger jean ben al ' +
    'pierre claire prudence constance aime aimee blanche celeste desire desiree juste modeste pascal clement aurore colombe ' +
    'victoire marine melodie violette perle capucine ambre cerise prune fleur lys parfait fortune noel olivier marin ' +
    'constant innocent honore ange ' +
    'bianca serena felice rosa gioia fortunato giusto leone vera marina stella aurora speranza innocente benedetto onesto ' +
    'viola chiara angelo sole luce sereno franco grazia fiore primo santo massimo vittoria letizia libero fausto ' +
    'salvatore alba sara gemma perla ambra fede mia bruno moreno candido lupo'
  ).split(' '),
);

/** La phrase s'adresse-t-elle à l'utilisateur (son prénom y figure) ? */
export function mentions(text: string, name: string): boolean {
  const first = name.trim().split(/\s+/)[0];
  if (!first || first.length < 2 || /^moi$/i.test(first)) return false;
  const key = normalize(first);
  if (COMMON_WORD_NAMES.has(key)) return namedInPerson(text, key);
  const re = new RegExp(`(?<![\\p{L}])${escapeRe(key)}(?![\\p{L}])`, 'u');
  return re.test(normalize(text));
}

/**
 * Prénom ambigu : Whisper l'écrit avec une majuscule quand c'est un nom. On ne le compte qu'avec
 * sa majuscule, et en début de phrase seulement s'il est interpellé (« Will, tu… », « Will ? ») :
 * « Will you share…? » ne sonne pas.
 */
function namedInPerson(text: string, key: string): boolean {
  for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    if (!/^\p{Lu}/u.test(m[0]) || normalize(m[0]) !== key) continue;
    const sentenceStart = /(^|[.!?…])[^\p{L}\p{N}]*$/u.test(text.slice(0, m.index));
    const calledOut = /^\s*([,!?.…:;]|$)/.test(text.slice(m.index + m[0].length));
    if (!sentenceStart || calledOut) return true;
  }
  return false;
}
