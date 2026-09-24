// Fusionner deux réunions (un enregistrement coupé puis relancé) ou en séparer une en deux.
// Fonctions pures : elles calculent le résultat, main.ts l'applique sur le disque.
import type { MeetingMeta, Segment, Voice } from '../shared/types';

export interface MergePlan {
  /** modifications de la réunion conservée (la plus ancienne) */
  patch: Partial<MeetingMeta>;
  /** transcription complète de la réunion fusionnée */
  segments: Segment[];
}

/**
 * Ajoute `b` à la suite de `a` (a = la plus ancienne) : les phrases de b sont décalées de l'écart
 * entre les deux débuts, ses voix gardent leurs propres lettres, notes et moments marqués suivent.
 * L'ancien compte-rendu ne couvrant plus toute la réunion, il est retiré (à régénérer).
 */
export function planMerge(a: MeetingMeta, aSegs: Segment[], b: MeetingMeta, bSegs: Segment[]): MergePlan {
  const offset = Math.max(0, b.startedAt - a.startedAt);
  const voices: Record<string, Voice> = { ...(a.voices ?? {}) };
  const keyOf = new Map<string, string>();
  let n = Math.max(0, ...Object.values(voices).map((v) => v.n));
  const ownerKey = Object.entries(voices).find(([, v]) => v.owner)?.[0];
  for (const [k, v] of Object.entries(b.voices ?? {})) {
    // la voix de l'utilisateur reste une seule et même voix
    if (v.owner && ownerKey) {
      keyOf.set(k, ownerKey);
      continue;
    }
    const ch = k.replace(/\d+$/, '');
    let i = 1;
    while (voices[`${ch}${i}`]) i++;
    const key = `${ch}${i}`;
    keyOf.set(k, key);
    voices[key] = v.owner ? { ...v } : { ...v, n: ++n };
  }
  const moved = bSegs.map((s) => {
    const seg: Segment = { ...s, t0: s.t0 + offset, t1: s.t1 + offset };
    if (s.spk) seg.spk = keyOf.get(s.spk) ?? s.spk;
    return seg;
  });
  const segments = [...aSegs, ...moved].sort((x, y) => x.t0 - y.t0 || x.id.localeCompare(y.id));
  const end = Math.max(a.startedAt + a.durationMs, b.startedAt + b.durationMs);
  const attendees = [...new Set([...(a.attendees ?? []), ...(b.attendees ?? [])])];
  return {
    segments,
    patch: {
      durationMs: end - a.startedAt,
      endedAt: Math.max(a.endedAt ?? 0, b.endedAt ?? 0) || undefined,
      notes: [a.notes.trim(), b.notes.trim()].filter(Boolean).join('\n\n'),
      bookmarks: [...a.bookmarks, ...b.bookmarks.map((bm) => ({ ...bm, t: bm.t + offset }))].sort((x, y) => x.t - y.t),
      ...(attendees.length ? { attendees } : {}),
      ...(a.voices || b.voices ? { voices } : {}),
      hasAudio: a.hasAudio || b.hasAudio,
      summary: undefined,
      followUp: undefined,
    },
  };
}

export interface SplitPlan {
  /** ce qui reste dans la réunion d'origine */
  keep: Segment[];
  keepPatch: Partial<MeetingMeta>;
  /** la suite, qui devient une nouvelle réunion (horodatée à partir de 0) */
  move: Segment[];
  newMeta: MeetingMeta;
}

/** Coupe la réunion juste avant la phrase `atSegId` : cette phrase ouvre la nouvelle réunion. */
export function planSplit(meta: MeetingMeta, segs: Segment[], atSegId: string, newId: string): SplitPlan {
  const at = segs.find((s) => s.id === atSegId);
  if (!at) throw new Error('Phrase introuvable.');
  const cut = at.t0;
  const keep = segs.filter((s) => s.t0 < cut);
  const move = segs.filter((s) => s.t0 >= cut).map((s) => ({ ...s, t0: s.t0 - cut, t1: s.t1 - cut }));
  if (!keep.length || !move.length) throw new Error('Rien à séparer ici : choisissez une phrase au milieu de la réunion.');
  const used = (list: Segment[]) => new Set(list.map((s) => s.spk).filter(Boolean) as string[]);
  const pick = (keys: Set<string>) =>
    meta.voices ? Object.fromEntries(Object.entries(meta.voices).filter(([k, v]) => keys.has(k) || v.owner)) : undefined;
  const keepEnd = Math.max(...keep.map((s) => s.t1));
  const newMeta: MeetingMeta = {
    ...meta,
    id: newId,
    title: `${meta.title} (suite)`,
    startedAt: meta.startedAt + cut,
    durationMs: Math.max(0, meta.durationMs - cut),
    notes: '',
    bookmarks: meta.bookmarks.filter((b) => b.t >= cut).map((b) => ({ ...b, t: b.t - cut })),
    voices: pick(used(move)),
    summary: undefined,
    followUp: undefined,
    pinned: false,
    wordCount: 0,
    preview: '',
  };
  return {
    keep,
    move,
    newMeta,
    keepPatch: {
      durationMs: keepEnd,
      endedAt: meta.startedAt + keepEnd,
      bookmarks: meta.bookmarks.filter((b) => b.t < cut),
      ...(meta.voices ? { voices: pick(used(keep)) } : {}),
      summary: undefined,
      followUp: undefined,
    },
  };
}
