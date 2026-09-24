import { app, clipboard, ClipboardItem, dialog, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import {
  clock,
  dateLabel,
  durationLabel,
  markdownToHtml,
  speakerName,
  toTurns,
  transcriptToHtml,
  transcriptToText,
  turnText,
  wordCount,
} from '../shared/transcript';
import type { CopyOptions, MeetingMeta, Segment } from '../shared/types';
import { store } from './store';

function pick(meta: MeetingMeta, segments: Segment[], range: CopyOptions['range']): Segment[] {
  const done = segments.filter((s) => s.text.trim());
  if (!done.length) return done;
  const end = done[done.length - 1].t1;
  switch (range) {
    case 'last5':
      return done.filter((s) => s.t1 >= end - 5 * 60_000);
    case 'last10':
      return done.filter((s) => s.t1 >= end - 10 * 60_000);
    case 'sinceBookmark': {
      const b = meta.bookmarks[meta.bookmarks.length - 1];
      return b ? done.filter((s) => s.t1 >= b.t) : done;
    }
    default:
      return done;
  }
}

const put = (text: string, html: string) => clipboard.write([new ClipboardItem({ 'text/plain': text, 'text/html': html })]);

/** Copie avec texte brut ET HTML : collage propre partout. */
export async function copyMeeting(id: string, opts: CopyOptions, withTimestampsDefault: boolean): Promise<{ words: number }> {
  const meta = store.meta(id);
  if (!meta) return { words: 0 };
  const segments = store.segments(id);
  const timestamps = opts.timestamps ?? withTimestampsDefault;
  if (opts.range === 'summary') {
    const md = meta.summary?.markdown ?? '';
    const text = `${meta.title}\n\n${md}`;
    await put(text, `<h2>${meta.title}</h2>${markdownToHtml(md)}`);
    return { words: md.split(/\s+/).filter(Boolean).length };
  }
  if (opts.range === 'notes') {
    await put(meta.notes, markdownToHtml(meta.notes));
    return { words: meta.notes.split(/\s+/).filter(Boolean).length };
  }
  const segs = pick(meta, segments, opts.range);
  const header = opts.range === 'all' || !opts.range;
  await put(transcriptToText(meta, segs, { timestamps, header }), transcriptToHtml(meta, segs, { timestamps, header }));
  return { words: wordCount(segs) };
}

export function meetingToMarkdown(meta: MeetingMeta, segments: Segment[]): string {
  const out: string[] = [`# ${meta.title}`, '', `*${dateLabel(meta.startedAt)} · ${durationLabel(meta.durationMs)}*`, ''];
  if (meta.summary?.markdown) out.push('## Compte-rendu', '', meta.summary.markdown.replace(/^## /gm, '### '), '');
  if (meta.notes.trim()) out.push('## Mes notes', '', meta.notes.trim(), '');
  if (meta.bookmarks.length) {
    out.push('## Moments marqués', '');
    for (const b of meta.bookmarks) out.push(`- **${clock(b.t)}** — ${b.label}`);
    out.push('');
  }
  out.push('## Transcription', '');
  for (const turn of toTurns(segments.filter((s) => s.text.trim()))) {
    out.push(`**${speakerName(meta, turn.ch)}** · ${clock(turn.t0)}  `, turnText(turn), '');
  }
  return out.join('\n');
}

function mdToDocx(md: string): Paragraph[] {
  const runs = (s: string): TextRun[] =>
    s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
      part.startsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part),
    );
  const paras: Paragraph[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (h) {
      paras.push(new Paragraph({ heading: h[1].length <= 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(h[2]) }));
    } else if (li) {
      const box = li[1] ? (li[2].toLowerCase() === 'x' ? '☑ ' : '☐ ') : '';
      paras.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(box), ...runs(li[3])] }));
    } else {
      paras.push(new Paragraph({ children: runs(line) }));
    }
  }
  return paras;
}

async function meetingToDocx(meta: MeetingMeta, segments: Segment[]): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(meta.title)] }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: `${dateLabel(meta.startedAt)} · ${durationLabel(meta.durationMs)}`, color: '8A8A8E' })],
    }),
  ];
  if (meta.summary?.markdown) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Compte-rendu')] }));
    children.push(...mdToDocx(meta.summary.markdown));
  }
  if (meta.notes.trim()) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Mes notes')] }));
    children.push(...mdToDocx(meta.notes));
  }
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Transcription')] }));
  for (const turn of toTurns(segments.filter((s) => s.text.trim()))) {
    children.push(
      new Paragraph({
        spacing: { before: 160 },
        children: [
          new TextRun({ text: speakerName(meta, turn.ch), bold: true, color: turn.ch === 'me' ? '0A64D8' : '3A3A3C' }),
          new TextRun({ text: `  ${clock(turn.t0)}`, color: '8A8A8E', size: 18 }),
        ],
      }),
      new Paragraph({ children: [new TextRun(turnText(turn))] }),
    );
  }
  const doc = new Document({
    creator: 'Minute',
    title: meta.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Réunion';
}

export async function exportMeeting(id: string, format: 'md' | 'txt' | 'docx', win: BrowserWindow | null): Promise<string | null> {
  const meta = store.meta(id);
  if (!meta) return null;
  const segments = store.segments(id);
  const d = new Date(meta.startedAt);
  const base = `${d.toISOString().slice(0, 10)} ${safeName(meta.title)}.${format}`;
  const opts = {
    defaultPath: join(app.getPath('documents'), base),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  if (format === 'docx') writeFileSync(res.filePath, await meetingToDocx(meta, segments));
  else if (format === 'md') writeFileSync(res.filePath, meetingToMarkdown(meta, segments), 'utf8');
  else writeFileSync(res.filePath, transcriptToText(meta, segments, { timestamps: true }), 'utf8');
  return res.filePath;
}
