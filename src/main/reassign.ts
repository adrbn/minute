// « Ce passage a été dit par quelqu'un d'autre » : l'utilisateur sélectionne du texte dans un bloc et
// choisit la voix. Le bloc est coupé aux limites de la sélection (ramenées à des mots entiers) et le
// passage reçoit la voix choisie. Fonction pure : le process principal applique le résultat.
import type { Channel, Segment, Voice } from '../shared/types';

export interface TextPoint {
  segId: string;
  /** position dans le texte de l'extrait (caractères) */
  offset: number;
}

export interface ReassignPlan {
  /** extraits à écrire (modifiés ou nouveaux) */
  put: Segment[];
  /** voix de la réunion, si une nouvelle a été créée */
  voices?: Record<string, Voice>;
  /** voix attribuée au passage */
  spk: string;
}

/** Début du mot qui contient `i` (ou `i` s'il est déjà entre deux mots). */
function wordStart(text: string, i: number): number {
  let k = Math.max(0, Math.min(text.length, i));
  // sélection commencée sur les espaces qui précèdent un mot : on part de ce mot
  while (k < text.length && /\s/.test(text[k])) k++;
  // sélection commencée après le dernier mot de l'extrait : rien à prendre ici
  if (k >= text.length) return text.length;
  while (k > 0 && !/\s/.test(text[k - 1])) k--;
  return k;
}

/** Fin du mot qui contient `i` (ponctuation collée comprise). */
function wordEnd(text: string, i: number): number {
  let k = Math.max(0, Math.min(text.length, i));
  while (k > 0 && /\s/.test(text[k - 1])) k--;
  while (k < text.length && !/\s/.test(text[k])) k++;
  // « mot ? » : la ponctuation détachée (typographie française) suit son mot
  const m = /^\s+[?!:;»]+/.exec(text.slice(k));
  return m ? k + m[0].length : k;
}

/** Nouvelle voix du canal `ch` : clé libre et lettre suivante. */
export function addVoice(voices: Record<string, Voice>, ch: Channel): { voices: Record<string, Voice>; key: string } {
  let k = 1;
  while (voices[`${ch}${k}`]) k++;
  const key = `${ch}${k}`;
  const n = Object.values(voices).reduce((m, v) => (v.owner ? m : Math.max(m, v.n)), 0) + 1;
  return { voices: { ...voices, [key]: { n } }, key };
}

/**
 * `segments` : tous les extraits de la réunion. `from` / `to` : la sélection (dans l'ordre ou non).
 * `target` : clé d'une voix existante, ou « new » pour en créer une. Renvoie null si rien à faire.
 */
export function planReassign(
  segments: Segment[],
  voices: Record<string, Voice>,
  from: TextPoint,
  to: TextPoint,
  target: string,
  newId: () => string,
): ReassignPlan | null {
  const ordered = [...segments].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  let a = ordered.findIndex((s) => s.id === from.segId);
  let b = ordered.findIndex((s) => s.id === to.segId);
  if (a < 0 || b < 0) return null;
  let start = from.offset;
  let end = to.offset;
  if (a > b || (a === b && start > end)) {
    [a, b] = [b, a];
    [start, end] = [end, start];
  }
  // la sélection reste dans un même canal (un bloc) : les extraits de l'autre canal intercalés ne bougent pas
  const ch = ordered[a].ch;
  const range = ordered.slice(a, b + 1).filter((s) => s.ch === ch && !s.pending && s.text.trim());
  if (!range.length) return null;

  let next = voices;
  let spk = target;
  if (target === 'new') {
    const added = addVoice(voices, ch);
    next = added.voices;
    spk = added.key;
  } else if (!voices[target]) return null;

  const put: Segment[] = [];
  for (const s of range) {
    const text = s.text;
    const i0 = s.id === ordered[a].id ? wordStart(text, start) : 0;
    const i1 = s.id === ordered[b].id ? wordEnd(text, end) : text.length;
    const head = text.slice(0, i0).trim();
    const mid = text.slice(i0, i1).trim();
    const tail = text.slice(i1).trim();
    if (!mid) continue;
    if (!head && !tail) {
      if (s.spk !== spk || !s.manual) put.push({ ...s, spk, manual: true });
      continue;
    }
    // temps répartis au prorata du texte ; l'audio d'origine reste attaché à chaque morceau
    const span = Math.max(3, s.t1 - s.t0);
    const at = (chars: number) => Math.round(s.t0 + (span * chars) / Math.max(1, text.length));
    const tA = head ? Math.max(s.t0 + 1, at(i0)) : s.t0;
    const tB = tail ? Math.min(s.t1 - 1, Math.max(tA + 1, at(i1))) : s.t1;
    // le premier morceau garde l'identifiant de l'extrait (et son empreinte de voix, s'il n'a pas changé de voix)
    if (head) put.push({ ...s, text: head, t1: tA });
    put.push({ ...s, id: head ? newId() : s.id, text: mid, t0: tA, t1: tB, spk, manual: true });
    if (tail) put.push({ ...s, id: newId(), text: tail, t0: tB, t1: s.t1 });
  }
  if (!put.length) return null;
  return { put, spk, ...(next !== voices ? { voices: next } : {}) };
}
