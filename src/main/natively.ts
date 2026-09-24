// Import de l'historique Natively (lecture seule de sa base SQLite).
import { app } from 'electron';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MeetingMeta, NativelyInfo, Segment } from '../shared/types';
import { isHallucination, stripHallucinations } from './filters';
import { settings } from './settings';
import { store } from './store';

function dbPath(): string {
  return join(app.getPath('appData'), 'natively', 'natively.db');
}

type Row = Record<string, unknown>;

/** Copie base + journal WAL pour lire un instantané cohérent sans toucher l'original. */
function openSnapshot() {
  const src = dbPath();
  const dir = mkdtempSync(join(tmpdir(), 'minute-natively-'));
  const dst = join(dir, 'natively.db');
  copyFileSync(src, dst);
  for (const ext of ['-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, dst + ext);
  const db = new DatabaseSync(dst);
  return {
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const imported = () => new Set(settings().appState<string[]>('nativelyImported') ?? []);

export function detectNatively(): NativelyInfo {
  if (!existsSync(dbPath())) return { found: false, meetings: 0, alreadyImported: 0 };
  try {
    const snap = openSnapshot();
    try {
      const rows = snap.db.prepare('SELECT id FROM meetings').all() as Row[];
      const done = imported();
      return { found: true, meetings: rows.length, alreadyImported: rows.filter((r) => done.has(String(r.id))).length };
    } finally {
      snap.close();
    }
  } catch {
    return { found: false, meetings: 0, alreadyImported: 0 };
  }
}

interface NativelySummary {
  legacySummary?: string;
  detailedSummary?: {
    overview?: string;
    tldr?: string[];
    keyPoints?: string[];
    decisions?: { text: string }[];
    actionItems?: string[];
    actionItemsV3?: { text: string; owner?: string; deadline?: string }[];
    actionItemsStructured?: { text: string; owner?: string; deadline?: string }[];
    openQuestions?: { text: string }[];
    sections?: { title: string; bullets: string[] }[];
    sectionsV3?: { title: string; bullets: { text: string }[] }[];
    followUpDraft?: string | { subject?: string; body?: string };
  };
}

function summaryToMarkdown(raw: string | null): { md: string; followUp?: string } {
  if (!raw) return { md: '' };
  let s: NativelySummary;
  try {
    s = JSON.parse(raw) as NativelySummary;
  } catch {
    return { md: '' };
  }
  const d = s.detailedSummary ?? {};
  const out: string[] = [];
  const brief = d.overview || (d.tldr ?? []).join(' ');
  if (brief) out.push('## En bref', brief, '');
  if (d.decisions?.length) out.push('## Décisions', ...d.decisions.map((x) => `- ${x.text}`), '');
  const actions = d.actionItemsV3?.length ? d.actionItemsV3 : d.actionItemsStructured?.length ? d.actionItemsStructured : null;
  if (actions) {
    out.push('## Actions', ...actions.map((a) => `- [ ] ${a.owner ? `**${a.owner}** — ` : ''}${a.text}${a.deadline ? ` (${a.deadline})` : ''}`), '');
  } else if (d.actionItems?.length) {
    out.push('## Actions', ...d.actionItems.map((a) => `- [ ] ${a}`), '');
  }
  const sections = d.sectionsV3?.length
    ? d.sectionsV3.map((x) => ({ title: x.title, bullets: x.bullets.map((b) => b.text) }))
    : d.sections ?? [];
  if (sections.length || d.keyPoints?.length) {
    out.push('## Points clés');
    for (const sec of sections) out.push(`### ${sec.title}`, ...sec.bullets.map((b) => `- ${b}`));
    if (!sections.length) out.push(...(d.keyPoints ?? []).map((k) => `- ${k}`));
    out.push('');
  }
  if (d.openQuestions?.length) out.push('## Questions ouvertes', ...d.openQuestions.map((q) => `- ${q.text}`), '');
  let md = out.join('\n').trim();
  if (!md && s.legacySummary) md = s.legacySummary.trim();
  const f = d.followUpDraft;
  const followUp = typeof f === 'string' ? f : f?.body ? `Objet : ${f.subject ?? ''}\n\n${f.body}` : undefined;
  return { md, followUp: followUp || undefined };
}

export function importNatively(): { imported: number; skipped: number } {
  const snap = openSnapshot();
  const done = imported();
  let count = 0;
  let skipped = 0;
  try {
    const meetings = snap.db
      .prepare('SELECT id, title, start_time, duration_ms, summary_json FROM meetings ORDER BY start_time')
      .all() as Row[];
    const cfg = settings().get();
    for (const m of meetings) {
      const nid = String(m.id);
      if (done.has(nid)) {
        skipped++;
        continue;
      }
      const startedAt = Number(m.start_time) || Date.now();
      const rows = snap.db
        .prepare("SELECT speaker, content, timestamp_ms FROM transcripts WHERE meeting_id = ? AND speaker IN ('user','interviewer') ORDER BY timestamp_ms, id")
        .all(nid) as Row[];
      // Natively stocke des fragments courts : on les regroupe en phrases lisibles.
      const segments: Segment[] = [];
      for (const r of rows) {
        // Natively a gardé les hallucinations de Whisper sur les silences : on les écarte.
        const text = stripHallucinations(String(r.content ?? '').trim());
        if (!text || isHallucination(text) || /^(merci|merci beaucoup)[\s.!]*$/i.test(text) || /^[\s.…,!?-]*$/.test(text)) continue;
        const ch = r.speaker === 'user' ? 'me' : 'them';
        const ts = Number(r.timestamp_ms);
        const t = ts > 1e12 ? Math.max(0, ts - startedAt) : Math.max(0, ts);
        const last = segments[segments.length - 1];
        if (last && last.ch === ch && t - last.t1 < 4000 && last.text.length < 600) {
          last.text += ' ' + text;
          last.t1 = Math.max(last.t1, t);
        } else {
          segments.push({ id: `n${segments.length.toString(36)}_${nid.slice(0, 6)}`, ch, t0: t, t1: t, text });
        }
      }
      const { md, followUp } = summaryToMarkdown(m.summary_json as string | null);
      const duration = Number(m.duration_ms) || (segments.length ? segments[segments.length - 1].t1 : 0);
      const meta: MeetingMeta = {
        id: `nat${nid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`,
        title: String(m.title || 'Réunion importée'),
        titleIsAuto: false,
        startedAt,
        endedAt: startedAt + duration,
        durationMs: duration,
        status: 'done',
        source: 'natively',
        speakers: { me: cfg.meName || 'Moi', them: cfg.themName || 'Participants' },
        notes: '',
        bookmarks: [],
        summary: md ? { markdown: md, generatedAt: startedAt + duration, provider: 'Natively', model: '' } : undefined,
        followUp,
        wordCount: 0,
        preview: '',
        hasAudio: false,
        language: 'fr',
      };
      if (store.has(meta.id)) {
        done.add(nid);
        skipped++;
        continue;
      }
      store.create(meta);
      store.writeSegments(meta.id, segments);
      store.refreshStats(meta.id);
      done.add(nid);
      count++;
    }
  } finally {
    snap.close();
    settings().appState('nativelyImported', [...done]);
  }
  return { imported: count, skipped };
}
