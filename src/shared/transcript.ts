// Mise en forme de la transcription — partagé main / interface pour que
// « ce qu'on voit » et « ce qu'on copie » soient toujours identiques.
import type { Channel, MeetingMeta, Segment } from './types';

export interface Turn {
  key: string;
  ch: Channel;
  t0: number;
  t1: number;
  segments: Segment[];
}

/** Regroupe les segments consécutifs d'une même voix en « tours de parole »
 *  (un long monologue est découpé en paragraphes d'environ 90 s). */
export function toTurns(segments: Segment[], maxGapMs = 20_000, maxTurnMs = 90_000): Turn[] {
  const turns: Turn[] = [];
  for (const s of segments) {
    const last = turns[turns.length - 1];
    if (last && last.ch === s.ch && s.t0 - last.t1 < maxGapMs && s.t0 - last.t0 < maxTurnMs) {
      last.segments.push(s);
      last.t1 = Math.max(last.t1, s.t1);
    } else {
      turns.push({ key: s.id, ch: s.ch, t0: s.t0, t1: s.t1, segments: [s] });
    }
  }
  return turns;
}

export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function durationLabel(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

export function speakerName(meta: Pick<MeetingMeta, 'speakers'>, ch: Channel): string {
  return ch === 'me' ? meta.speakers.me || 'Moi' : meta.speakers.them || 'Eux';
}

export function turnText(turn: Turn): string {
  return turn.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ');
}

export function wordCount(segments: Segment[]): number {
  let n = 0;
  for (const s of segments) n += s.text.split(/\s+/).filter(Boolean).length;
  return n;
}

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Texte brut prêt à coller (mail, Teams, Word…). */
export function transcriptToText(
  meta: MeetingMeta,
  segments: Segment[],
  opts: { timestamps?: boolean; header?: boolean } = {},
): string {
  const lines: string[] = [];
  if (opts.header !== false) {
    lines.push(`${meta.title} — ${dateLabel(meta.startedAt)} (${durationLabel(meta.durationMs)})`, '');
  }
  for (const turn of toTurns(segments.filter((s) => s.text.trim()))) {
    const who = speakerName(meta, turn.ch);
    const ts = opts.timestamps ? `[${clock(turn.t0)}] ` : '';
    lines.push(`${ts}${who} : ${turnText(turn)}`);
  }
  return lines.join('\n');
}

/** Transcription compacte pour les modèles d'IA : horodatée, voix explicites. */
export function transcriptForAi(meta: MeetingMeta, segments: Segment[]): string {
  return toTurns(segments.filter((s) => s.text.trim()))
    .map((turn) => `[${clock(turn.t0)}] ${speakerName(meta, turn.ch)} : ${turnText(turn)}`)
    .join('\n');
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Version riche (HTML) pour un collage propre dans Outlook / Word / Gmail. */
export function transcriptToHtml(
  meta: MeetingMeta,
  segments: Segment[],
  opts: { timestamps?: boolean; header?: boolean } = {},
): string {
  const out: string[] = [];
  if (opts.header !== false) {
    out.push(
      `<p><b>${esc(meta.title)}</b><br><span style="color:#8a8a8e">${esc(dateLabel(meta.startedAt))} · ${esc(
        durationLabel(meta.durationMs),
      )}</span></p>`,
    );
  }
  for (const turn of toTurns(segments.filter((s) => s.text.trim()))) {
    const color = turn.ch === 'me' ? '#0a64d8' : '#3a3a3c';
    const ts = opts.timestamps ? ` <span style="color:#8a8a8e">${clock(turn.t0)}</span>` : '';
    out.push(`<p><b style="color:${color}">${esc(speakerName(meta, turn.ch))}</b>${ts}<br>${esc(turnText(turn))}</p>`);
  }
  return out.join('\n');
}

/** Markdown minimal → HTML (pour coller un compte-rendu mis en forme). */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(4, h[1].length + 1);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      if (!inList) out.push('<ul>');
      inList = true;
      const box = li[1] ? (li[2].toLowerCase() === 'x' ? '☑ ' : '☐ ') : '';
      out.push(`<li>${box}${inline(li[3])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

/** Normalisation pour la recherche et la détection d'écho. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, ' ');
}

export function contentWords(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}
