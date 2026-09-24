import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../../shared/i18n';

/** Rendu Markdown léger : titres, listes, cases à cocher, gras, horodatages cliquables. */
export function Markdown({
  text,
  streaming,
  onToggle,
  onTime,
}: {
  text: string;
  streaming?: boolean;
  onToggle?: (lineIndex: number) => void;
  onTime?: (ms: number) => void;
}) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (key: number) => {
    if (list.length) blocks.push(<ul key={`ul${key}`}>{list}</ul>);
    list = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (h) {
      flush(i);
      const Tag = h[1].length <= 2 ? 'h2' : 'h3';
      blocks.push(<Tag key={i}>{inline(h[2], onTime)}</Tag>);
    } else if (li) {
      if (li[1]) {
        const done = li[2].toLowerCase() === 'x';
        list.push(
          <li key={i} className={`task ${done ? 'done' : ''}`}>
            <button className={`check ${done ? 'on' : ''}`} onClick={() => onToggle?.(i)} aria-label={t('Cocher')}>
              {done && <Check />}
            </button>
            <span>{inline(li[3], onTime)}</span>
          </li>,
        );
      } else list.push(<li key={i}>{inline(li[3], onTime)}</li>);
    } else if (!line.trim()) {
      flush(i);
    } else {
      flush(i);
      blocks.push(<p key={i}>{inline(line, onTime)}</p>);
    }
  });
  flush(lines.length);
  return <div className={`md ${streaming ? 'streaming' : ''}`}>{blocks}</div>;
}

function inline(s: string, onTime?: (ms: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith('[')) {
      const [a, b, c] = [Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : null];
      const ms = (c === null ? a * 60 + b : a * 3600 + b * 60 + c) * 1000;
      out.push(
        <button key={k++} className="tref" onClick={() => onTime?.(ms)}>
          {tok.slice(1, -1)}
        </button>,
      );
    } else out.push(<i key={k++}>{tok.slice(1, -1)}</i>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Coche / décoche la case de la ligne `index` dans le texte Markdown. */
export function toggleTask(md: string, index: number): string {
  const lines = md.split(/\r?\n/);
  const l = lines[index];
  if (l === undefined) return md;
  lines[index] = /\[ \]/.test(l) ? l.replace('[ ]', '[x]') : l.replace(/\[(x|X)\]/, '[ ]');
  return lines.join('\n');
}
