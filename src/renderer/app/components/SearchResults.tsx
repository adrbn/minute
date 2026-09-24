import { FileText, Loader2, MessageSquare, NotebookPen, Type } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { t, locale } from '../../../shared/i18n';
import { clock, normalize } from '../../../shared/transcript';
import type { SearchHit } from '../../../shared/types';
import { minute } from '../api';

function highlight(text: string, query: string): ReactNode[] {
  const terms = normalize(query.replace(/"/g, '')).split(/\s+/).filter((w) => w.length > 1);
  if (!terms.length) return [text];
  const n = normalize(text);
  const marks: [number, number][] = [];
  for (const w of terms) {
    let i = n.indexOf(w);
    while (i >= 0) {
      marks.push([i, i + w.length]);
      i = n.indexOf(w, i + w.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let last = 0;
  marks.forEach(([a, b], k) => {
    if (a < last) return;
    out.push(text.slice(last, a), <mark key={k}>{text.slice(a, b)}</mark>);
    last = b;
  });
  out.push(text.slice(last));
  return out;
}

export function SearchResults({ query, onOpen }: { query: string; onOpen: (id: string, t?: number) => void }) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    setHits(null);
    const timer = setTimeout(() => void minute.meetings.search(query).then(setHits), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const icon = (k: SearchHit['kind']) =>
    k === 'title' ? <Type size={14} /> : k === 'notes' ? <NotebookPen size={14} /> : k === 'summary' ? <FileText size={14} /> : <MessageSquare size={14} />;

  const meetings = hits ? new Set(hits.map((h) => h.meetingId)).size : 0;
  const count = () => {
    const vars = { n: hits?.length ?? 0, m: meetings };
    if (vars.n <= 1) return t('{n} passage dans {m} réunion', vars);
    return meetings > 1 ? t('{n} passages dans {m} réunions', vars) : t('{n} passages dans {m} réunion', vars);
  };

  return (
    <div className="content">
      <div className="titlebar drag">
        <div className="meeting-head">
          <div className="meeting-title" style={{ pointerEvents: 'none' }}>
            {t('Résultats pour « {query} »', { query })}
          </div>
          <div className="meeting-sub">{hits === null ? t('Recherche…') : count()}</div>
        </div>
      </div>
      <div className="results" style={{ borderTop: '1px solid var(--sep)' }}>
        {hits === null && (
          <div className="empty">
            <Loader2 className="spin" />
          </div>
        )}
        {hits?.length === 0 && (
          <div className="empty">
            <h2>{t('Aucun résultat')}</h2>
            <p>{t('Essayez un autre mot, ou mettez une expression entre guillemets pour la chercher telle quelle.')}</p>
          </div>
        )}
        {hits?.map((h, i) => (
          <button key={i} className="result" onClick={() => onOpen(h.meetingId, h.t)}>
            <div className="rt">
              {icon(h.kind)}
              <span>{h.title}</span>
              <span className="faint">
                {new Date(h.startedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                {h.t !== undefined ? ` · ${clock(h.t)}` : ''}
              </span>
            </div>
            <div className="rs">{highlight(h.snippet, query)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
