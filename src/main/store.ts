// Stockage des réunions : un dossier par réunion, lisible par un humain.
//   meeting.json      métadonnées (titre, notes, moments, compte-rendu…)
//   transcript.jsonl  journal en ajout seul : chaque phrase est écrite dès qu'elle
//                     existe → rien n'est perdu si l'app ou le PC plante.
//   audio/*.wav       extraits audio (le temps de la transcription, puis selon réglage)
import { shell } from 'electron';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { normalize, sortSegments, wordCount } from '../shared/transcript';
import type { MeetingMeta, SearchHit, Segment } from '../shared/types';

type Entry = { meta: MeetingMeta; dir: string };
type LogLine = ({ k: 'seg' } & Segment) | { k: 'del'; id: string };

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function folderName(meta: MeetingMeta): string {
  const d = new Date(meta.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${meta.id}`;
}

function writeAtomic(file: string, content: string) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

export class MeetingStore {
  private index = new Map<string, Entry>();
  private segCache = new Map<string, { mtime: number; size: number; segments: Segment[] }>();
  root = '';

  load(root: string) {
    this.root = root;
    this.index.clear();
    this.segCache.clear();
    mkdirSync(root, { recursive: true });
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const file = join(dir, 'meeting.json');
      if (!existsSync(file)) continue;
      try {
        const meta = JSON.parse(readFileSync(file, 'utf8')) as MeetingMeta;
        if (meta?.id) this.index.set(meta.id, { meta, dir });
      } catch {
        /* dossier corrompu : ignoré, jamais supprimé */
      }
    }
  }

  list(): MeetingMeta[] {
    return [...this.index.values()].map((e) => e.meta).sort((a, b) => b.startedAt - a.startedAt);
  }

  has(id: string) {
    return this.index.has(id);
  }

  meta(id: string): MeetingMeta | null {
    return this.index.get(id)?.meta ?? null;
  }

  dir(id: string): string | null {
    return this.index.get(id)?.dir ?? null;
  }

  create(meta: MeetingMeta): MeetingMeta {
    const dir = join(this.root, folderName(meta));
    mkdirSync(join(dir, 'audio'), { recursive: true });
    this.index.set(meta.id, { meta, dir });
    writeAtomic(join(dir, 'meeting.json'), JSON.stringify(meta, null, 2));
    if (!existsSync(join(dir, 'transcript.jsonl'))) writeFileSync(join(dir, 'transcript.jsonl'), '');
    return meta;
  }

  update(id: string, patch: Partial<MeetingMeta>): MeetingMeta | null {
    const e = this.index.get(id);
    if (!e) return null;
    const { id: _ignored, ...rest } = patch;
    e.meta = { ...e.meta, ...rest };
    writeAtomic(join(e.dir, 'meeting.json'), JSON.stringify(e.meta, null, 2));
    return e.meta;
  }

  segments(id: string): Segment[] {
    const e = this.index.get(id);
    if (!e) return [];
    const file = join(e.dir, 'transcript.jsonl');
    let st: ReturnType<typeof statSync>;
    let raw: string;
    try {
      st = statSync(file);
      const cached = this.segCache.get(id);
      if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached.segments;
      raw = readFileSync(file, 'utf8');
    } catch {
      return []; // pas encore de texte, ou dossier déplacé entre-temps
    }
    const byId = new Map<string, Segment>();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as LogLine;
        if (l.k === 'del') byId.delete(l.id);
        else {
          const { k: _k, ...seg } = l;
          byId.set(seg.id, seg);
        }
      } catch {
        /* dernière ligne tronquée par un crash : on l'ignore */
      }
    }
    const segments = sortSegments([...byId.values()]);
    this.segCache.set(id, { mtime: st.mtimeMs, size: st.size, segments });
    return segments;
  }

  putSegment(id: string, seg: Segment) {
    const e = this.index.get(id);
    if (!e) return;
    appendFileSync(join(e.dir, 'transcript.jsonl'), JSON.stringify({ k: 'seg', ...seg }) + '\n', 'utf8');
  }

  /** Écrit d'un coup toute une transcription (import). */
  writeSegments(id: string, segments: Segment[]) {
    const e = this.index.get(id);
    if (!e) return;
    writeAtomic(join(e.dir, 'transcript.jsonl'), segments.map((s) => JSON.stringify({ k: 'seg', ...s })).join('\n') + '\n');
  }

  removeSegment(id: string, segId: string) {
    const e = this.index.get(id);
    if (!e) return;
    appendFileSync(join(e.dir, 'transcript.jsonl'), JSON.stringify({ k: 'del', id: segId }) + '\n', 'utf8');
  }

  /** Réécrit le journal sous forme compacte (en fin de réunion). */
  compact(id: string) {
    const e = this.index.get(id);
    if (!e) return;
    const segs = this.segments(id);
    writeAtomic(join(e.dir, 'transcript.jsonl'), segs.map((s) => JSON.stringify({ k: 'seg', ...s })).join('\n') + '\n');
    this.refreshStats(id);
  }

  refreshStats(id: string): MeetingMeta | null {
    const segs = this.segments(id).filter((s) => s.text);
    const preview = segs
      .slice(0, 6)
      .map((s) => s.text)
      .join(' ')
      .slice(0, 160);
    return this.update(id, { wordCount: wordCount(segs), preview });
  }

  audioDir(id: string): string | null {
    const d = this.dir(id);
    return d ? join(d, 'audio') : null;
  }

  audioFile(id: string, file: string): string | null {
    const d = this.audioDir(id);
    if (!d || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    return join(d, file);
  }

  deleteAudio(id: string) {
    const e = this.index.get(id);
    if (!e) return;
    const d = join(e.dir, 'audio');
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    // Sans audio, un segment encore en attente ne pourra jamais être transcrit : on le retire.
    const segs = this.segments(id)
      .filter((s) => !s.pending)
      .map(({ audio: _a, ...s }) => s);
    writeAtomic(join(e.dir, 'transcript.jsonl'), segs.map((s) => JSON.stringify({ k: 'seg', ...s })).join('\n') + '\n');
    this.update(id, { hasAudio: false });
  }

  /** Suppression définitive, sans passer par la corbeille (durée de conservation du mode confidentiel). */
  removePermanently(id: string) {
    const e = this.index.get(id);
    if (!e) return;
    this.index.delete(id);
    this.segCache.delete(id);
    rmSync(e.dir, { recursive: true, force: true });
  }

  async remove(id: string) {
    const e = this.index.get(id);
    if (!e) return;
    // d'abord hors de l'index : plus personne ne lit ni n'écrit dans le dossier pendant qu'il part à la corbeille
    this.index.delete(id);
    this.segCache.delete(id);
    try {
      await shell.trashItem(e.dir); // corbeille : récupérable
    } catch {
      rmSync(e.dir, { recursive: true, force: true });
    }
  }

  search(query: string, limit = 150): SearchHit[] {
    const phrase = /^".+"$/.test(query.trim());
    const q = normalize(query.replace(/"/g, '')).trim();
    if (q.length < 2) return [];
    const terms = phrase ? [q] : q.split(/\s+/).filter(Boolean);
    const matches = (s: string) => {
      const n = normalize(s);
      return terms.every((t) => n.includes(t));
    };
    const snippet = (s: string) => {
      const n = normalize(s);
      const i = Math.max(0, n.indexOf(terms[0]));
      const start = Math.max(0, i - 70);
      const end = Math.min(s.length, i + terms[0].length + 110);
      return (start > 0 ? '…' : '') + s.slice(start, end).trim() + (end < s.length ? '…' : '');
    };
    const hits: SearchHit[] = [];
    for (const meta of this.list()) {
      if (meta.deletedAt) continue; // la corbeille n'apparaît pas dans la recherche
      const base = { meetingId: meta.id, title: meta.title, startedAt: meta.startedAt };
      if (matches(meta.title)) hits.push({ ...base, kind: 'title', snippet: meta.preview });
      if (meta.notes && matches(meta.notes)) hits.push({ ...base, kind: 'notes', snippet: snippet(meta.notes) });
      if (meta.summary?.markdown && matches(meta.summary.markdown))
        hits.push({ ...base, kind: 'summary', snippet: snippet(meta.summary.markdown.replace(/[#*\-[\]]/g, ' ')) });
      for (const s of this.segments(meta.id)) {
        if (s.text && matches(s.text)) hits.push({ ...base, kind: 'segment', t: s.t0, ch: s.ch, snippet: snippet(s.text) });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  /** Supprime l'audio des réunions plus anciennes que `days` jours. */
  purgeOldAudio(days: number) {
    if (days < 0) return;
    const limit = Date.now() - days * 86_400_000;
    for (const meta of this.list()) {
      if (!meta.hasAudio || meta.status === 'recording' || meta.status === 'paused') continue;
      if ((meta.endedAt ?? meta.startedAt) > limit) continue;
      if (this.segments(meta.id).some((s) => s.pending)) continue;
      this.deleteAudio(meta.id);
    }
  }
}

export const store = new MeetingStore();
