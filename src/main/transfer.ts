// Passer une réunion d'un Minute à un autre (Mac ↔ Windows) :
//   .minute  tout ce que contient la réunion (titre, voix, notes, moments, compte-rendu, transcription), sans l'audio
//   .md      un export Markdown de Minute, relu : on retrouve titre, date, compte-rendu, notes, moments et transcription
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { t } from '../shared/i18n';
import en from '../shared/locales/en.json';
import it from '../shared/locales/it.json';
import type { Bookmark, Channel, MeetingMeta, Segment, Voice } from '../shared/types';
import { newId, store } from './store';

export const BUNDLE_FORMAT = 'minute-meeting';
const BUNDLE_VERSION = 1;

export interface MeetingBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: number;
  /** version de Minute qui a exporté */
  app?: string;
  meta: MeetingMeta;
  segments: Segment[];
}

/** L'audio reste sur l'ordinateur d'origine : les phrases jamais transcrites n'ont donc rien à apporter. */
export function toBundle(meta: MeetingMeta, segments: Segment[], appVersion?: string): MeetingBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    app: appVersion,
    meta: { ...meta, hasAudio: false },
    segments: segments.filter((s) => !s.pending && s.text.trim()).map(({ audio: _a, pending: _p, ...s }) => s),
  };
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function parseBundle(raw: string): { meta: MeetingMeta; segments: Segment[] } {
  let b: Partial<MeetingBundle>;
  try {
    b = JSON.parse(raw) as Partial<MeetingBundle>;
  } catch {
    throw new Error(t('Ce fichier n’est pas une réunion Minute.'));
  }
  if (b?.format !== BUNDLE_FORMAT || !b.meta || !Array.isArray(b.segments)) throw new Error(t('Ce fichier n’est pas une réunion Minute.'));
  if (!isNum(b.version) || b.version > BUNDLE_VERSION) throw new Error(t('Fichier créé par une version plus récente de Minute : mettez Minute à jour.'));
  const m = b.meta;
  if (typeof m.id !== 'string' || typeof m.title !== 'string' || !isNum(m.startedAt)) throw new Error(t('Ce fichier n’est pas une réunion Minute.'));
  const segments = b.segments
    .filter((s): s is Segment => !!s && typeof s.id === 'string' && (s.ch === 'me' || s.ch === 'them') && isNum(s.t0) && isNum(s.t1) && typeof s.text === 'string')
    .map(({ audio: _a, pending: _p, ...s }) => s);
  const meta: MeetingMeta = {
    ...m,
    // une réunion encore en cours sur l'autre ordinateur arrive ici terminée, hors corbeille
    status: 'done',
    deletedAt: undefined,
    hasAudio: false,
    durationMs: isNum(m.durationMs) ? m.durationMs : 0,
    speakers: m.speakers ?? { me: 'Moi', them: 'Participants' },
    notes: typeof m.notes === 'string' ? m.notes : '',
    bookmarks: Array.isArray(m.bookmarks) ? m.bookmarks : [],
  };
  return { meta, segments };
}

// --- export Markdown (voir meetingToMarkdown) : ses titres sont dans la langue de l'interface qui l'a écrit
const DICTS = [en, it] as Record<string, string>[];
const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();
const names = (fr: string) => [fr, ...DICTS.map((d) => d[fr]).filter(Boolean)].map(norm);
const is = (s: string, fr: string) => names(fr).includes(norm(s));
/** titres de premier niveau du compte-rendu, rétrogradés en ### par l'export */
const SUMMARY_TOP = ['En bref', 'Décisions', 'Actions', 'Points clés', 'Questions ouvertes'];

const MONTHS = [
  ['janvier', 'january', 'gennaio'],
  ['février', 'february', 'febbraio'],
  ['mars', 'march', 'marzo'],
  ['avril', 'april', 'aprile'],
  ['mai', 'may', 'maggio'],
  ['juin', 'june', 'giugno'],
  ['juillet', 'july', 'luglio'],
  ['août', 'august', 'agosto'],
  ['septembre', 'september', 'settembre'],
  ['octobre', 'october', 'ottobre'],
  ['novembre', 'november', 'novembre'],
  ['décembre', 'december', 'dicembre'],
];

/** « mardi 3 novembre 2026 à 15:40 », « Tuesday 3 November 2026 at 15:40 », « martedì 3 novembre 2026 alle ore 15:40 » */
export function parseDateLabel(s: string): number | null {
  const m = /(\d{1,2})\s+(\p{L}+)\s+(\d{4})\D+?(\d{1,2})[:.h](\d{2})/u.exec(s);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.includes(norm(m[2])));
  if (month < 0) return null;
  return new Date(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5])).getTime();
}

/** « 1 h 41 », « 1h 41 », « 2 h », « 41 min », « < 1 min » */
export function parseDurationLabel(s: string): number | null {
  if (/<\s*1\s*min/.test(s)) return 30_000;
  const h = /(\d+)\s*h\s*(\d{1,2})?/.exec(s);
  if (h) return (Number(h[1]) * 60 + Number(h[2] ?? 0)) * 60_000;
  const m = /(\d+)\s*min/.exec(s);
  return m ? Number(m[1]) * 60_000 : null;
}

/** « 05:12 » ou « 1:05:12 » → ms */
function parseClock(s: string): number {
  return s.split(':').reduce((acc, x) => acc * 60 + Number(x), 0) * 1000;
}

export interface MarkdownOptions {
  meName: string;
  themName: string;
  /** langue parlée (le Markdown ne la dit pas : celle des réglages) */
  language: string;
  /** date retenue si la ligne de date est illisible (date du fichier) */
  fallbackStart: number;
}

export function parseMinuteMarkdown(md: string, o: MarkdownOptions): { meta: MeetingMeta; segments: Segment[] } {
  const lines = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  const title = first >= 0 ? /^#\s+(.+)$/.exec(lines[first])?.[1]?.trim() : undefined;
  if (!title) throw new Error(t('Ce fichier n’est pas un export Markdown de Minute.'));

  type Part = 'summary' | 'notes' | 'bookmarks' | 'transcript';
  const head: string[] = [];
  const parts: Partial<Record<Part, string[]>> = {};
  let cur: string[] = head;
  for (const line of lines.slice(first + 1)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    const part: Part | null = !h
      ? null
      : is(h[1], 'Compte-rendu')
        ? 'summary'
        : is(h[1], 'Mes notes')
          ? 'notes'
          : is(h[1], 'Moments marqués')
            ? 'bookmarks'
            : is(h[1], 'Transcription')
              ? 'transcript'
              : null;
    if (part && !parts[part]) {
      cur = parts[part] = [];
      continue;
    }
    cur.push(line);
  }
  if (!parts.transcript) throw new Error(t('Ce fichier n’est pas un export Markdown de Minute.'));

  const when = head.map((l) => /^\*(.+)\*\s*$/.exec(l.trim())?.[1]).find(Boolean) ?? '';
  const [dateText, durText = ''] = when.split(' · ');

  const summaryMd = (parts.summary ?? [])
    .map((l) => {
      const h3 = /^###\s+(.+?)\s*$/.exec(l);
      return h3 && SUMMARY_TOP.some((s) => is(h3[1], s)) ? `## ${h3[1]}` : l;
    })
    .join('\n')
    .trim();
  const notes = (parts.notes ?? []).join('\n').trim();

  const bookmarks: Bookmark[] = [];
  for (const l of parts.bookmarks ?? []) {
    const b = /^-\s+\*\*(\d{1,2}(?::\d{2}){1,2})\*\*\s+—\s+(.*)$/.exec(l.trim());
    if (b) bookmarks.push({ id: `b${bookmarks.length.toString(36)}`, t: parseClock(b[1]), label: b[2].trim() });
  }

  // tours de parole : « **Nom** · 05:12 » puis le texte
  const turns: { label: string; t0: number; text: string[] }[] = [];
  for (const l of parts.transcript) {
    const h = /^\*\*(.+?)\*\*\s+·\s+(\d{1,2}(?::\d{2}){1,2})\s*$/.exec(l);
    if (h) turns.push({ label: h[1].trim(), t0: parseClock(h[2]), text: [] });
    else if (l.trim() && turns.length) turns[turns.length - 1].text.push(l.trim());
  }

  // qui parle : « Moi » (ou le nom choisi), « Participants », « Participant B », ou une voix nommée
  const me = new Set([...names('Moi'), norm(o.meName || '')].filter(Boolean));
  const them = new Set([...names('Participants'), 'eux', norm(o.themName || '')].filter(Boolean));
  const voices: Record<string, Voice> = {};
  const named = new Map<string, string>();
  let nextN = 1;
  const who = (label: string): { ch: Channel; spk?: string } => {
    const n = norm(label);
    if (me.has(n)) return { ch: 'me' };
    if (them.has(n)) return { ch: 'them' };
    const p = /^(?:participant|partecipante)\s+([a-z]|\d+)$/.exec(n);
    if (p) {
      const num = /\d/.test(p[1]) ? Number(p[1]) : p[1].toUpperCase().charCodeAt(0) - 64;
      const spk = `v${num}`;
      voices[spk] = { n: num };
      nextN = Math.max(nextN, num + 1);
      return { ch: 'them', spk };
    }
    let spk = named.get(n);
    if (!spk) {
      spk = `n${named.size + 1}`;
      named.set(n, spk);
      voices[spk] = { n: 0, name: label };
    }
    return { ch: 'them', spk };
  };
  const segments: Segment[] = turns
    .map((turn, i) => ({ turn, i, text: turn.text.join(' ').trim() }))
    .filter((x) => x.text)
    .map(({ turn, i, text }) => {
      const next = turns[i + 1];
      const words = text.split(/\s+/).length;
      const t1 = Math.max(turn.t0, Math.min(next ? next.t0 : Infinity, turn.t0 + Math.max(1500, words * 400)));
      return { id: `m${i.toString(36)}`, ...who(turn.label), t0: turn.t0, t1, text };
    });
  // les voix nommées prennent les numéros libres, après les « Participant X »
  for (const v of Object.values(voices)) if (!v.n) v.n = nextN++;

  const startedAt = parseDateLabel(dateText) ?? o.fallbackStart;
  const durationMs = parseDurationLabel(durText) ?? (segments.length ? segments[segments.length - 1].t1 : 0);
  const meta: MeetingMeta = {
    id: newId(),
    title,
    titleIsAuto: false,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    status: 'done',
    source: 'minute',
    speakers: { me: o.meName || 'Moi', them: o.themName || 'Participants' },
    notes,
    bookmarks,
    summary: summaryMd ? { markdown: summaryMd, generatedAt: startedAt + durationMs, provider: 'Import', model: '' } : undefined,
    wordCount: 0,
    preview: '',
    hasAudio: false,
    language: o.language,
    voices: Object.keys(voices).length ? voices : undefined,
  };
  return { meta, segments };
}

/**
 * Ajoute à l'historique la réunion d'un fichier .minute ou .md.
 * Déjà là (même réunion, ou même titre à la même heure) : rien n'est ajouté, on renvoie celle qui existe.
 */
export function importMeetingFile(file: string, who: Omit<MarkdownOptions, 'fallbackStart'>): { id: string; added: boolean } {
  const raw = readFileSync(file, 'utf8');
  const ext = extname(file).toLowerCase();
  const { meta, segments } =
    ext === '.md' || ext === '.markdown'
      ? parseMinuteMarkdown(raw, { ...who, fallbackStart: statSync(file).mtimeMs })
      : parseBundle(raw.replace(/^﻿/, ''));
  const same = store
    .list()
    .find((m) => !m.deletedAt && (m.id === meta.id || (m.title === meta.title && Math.abs(m.startedAt - meta.startedAt) < 60_000)));
  if (same) return { id: same.id, added: false };
  if (store.has(meta.id)) meta.id = newId(); // la même, dans la corbeille : on garde les deux
  store.create(meta);
  store.writeSegments(meta.id, segments);
  store.refreshStats(meta.id);
  return { id: meta.id, added: true };
}
