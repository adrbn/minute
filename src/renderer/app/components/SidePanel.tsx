import { Copy, History, Loader2, Mail, MessageSquareText, RotateCw, Send, Sparkles, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clock } from '../../../shared/transcript';
import type { AiEvent, AiKind, MeetingMeta, Segment } from '../../../shared/types';
import { minute, relativeTime } from '../api';
import { Markdown, toggleTask } from './Markdown';
import { useToast } from './ui';

export type PanelTab = 'notes' | 'summary' | 'assistant';

interface Stream {
  requestId: string;
  kind: AiKind;
  text: string;
  done: boolean;
  error?: string;
  progress?: string;
  question?: string;
}

/** Suit les réponses d'IA en cours pour une réunion. */
function useAi(meetingId: string) {
  const [streams, setStreams] = useState<Stream[]>([]);
  useEffect(() => {
    setStreams([]);
    return minute.on('ai', (e: AiEvent) => {
      if (e.meetingId !== meetingId) return;
      setStreams((prev) => {
        const i = prev.findIndex((s) => s.requestId === e.requestId);
        const base: Stream = i >= 0 ? prev[i] : { requestId: e.requestId, kind: e.kind, text: '', done: false };
        const next: Stream = {
          ...base,
          text: e.text || base.text,
          done: e.done,
          error: e.error,
          progress: e.progress ?? (e.text ? undefined : base.progress),
        };
        if (i >= 0) return prev.map((s, k) => (k === i ? next : s));
        return [...prev, next];
      });
    });
  }, [meetingId]);
  const run = async (kind: AiKind, extra: { question?: string; minutes?: number } = {}) => {
    const requestId = await minute.ai.run({ kind, meetingId, ...extra });
    setStreams((prev) =>
      prev.some((s) => s.requestId === requestId)
        ? prev.map((s) => (s.requestId === requestId ? { ...s, question: extra.question ?? (kind === 'catchup' ? `Rattrapage — ${extra.minutes} dernières minutes` : undefined) } : s))
        : [...prev, { requestId, kind, text: '', done: false, question: extra.question ?? (kind === 'catchup' ? `Rattrapage — ${extra.minutes} dernières minutes` : undefined) }],
    );
    return requestId;
  };
  return { streams, run, setStreams };
}

export function SidePanel({
  meta,
  segments,
  live,
  tab,
  onTab,
  onTime,
  hasAi,
  onOpenSettings,
}: {
  meta: MeetingMeta;
  segments: Segment[];
  live: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onTime: (ms: number) => void;
  hasAi: boolean;
  onOpenSettings: () => void;
}) {
  const ai = useAi(meta.id);
  const summaryStream = [...ai.streams].reverse().find((s) => s.kind === 'summary');
  const followStream = [...ai.streams].reverse().find((s) => s.kind === 'followup');
  const qa = ai.streams.filter((s) => s.kind === 'ask' || s.kind === 'catchup');

  // un compte-rendu généré automatiquement fait basculer l'onglet
  useEffect(() => {
    if (summaryStream && !summaryStream.done && tab !== 'summary' && !live) onTab('summary');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryStream?.requestId]);

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="segmented">
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => onTab('notes')}>
            Notes
          </button>
          <button className={tab === 'summary' ? 'active' : ''} onClick={() => onTab('summary')}>
            Compte-rendu
          </button>
          <button className={tab === 'assistant' ? 'active' : ''} onClick={() => onTab('assistant')}>
            Assistant
          </button>
        </div>
      </div>
      {tab === 'notes' && <NotesTab meta={meta} onTime={onTime} />}
      {tab === 'summary' && (
        <SummaryTab
          meta={meta}
          segments={segments}
          live={live}
          stream={summaryStream}
          follow={followStream}
          hasAi={hasAi}
          run={ai.run}
          onTime={onTime}
          onOpenSettings={onOpenSettings}
        />
      )}
      {tab === 'assistant' && (
        <AssistantTab
          qa={qa}
          live={live}
          hasAi={hasAi}
          run={ai.run}
          onTime={onTime}
          clear={() => ai.setStreams((p) => p.filter((s) => s.kind !== 'ask' && s.kind !== 'catchup'))}
          onOpenSettings={onOpenSettings}
        />
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ Notes
function NotesTab({ meta, onTime }: { meta: MeetingMeta; onTime: (ms: number) => void }) {
  const [text, setText] = useState(meta.notes);
  const [saved, setSaved] = useState(true);
  const timer = useRef<number | null>(null);
  const idRef = useRef(meta.id);

  useEffect(() => {
    idRef.current = meta.id;
    setText(meta.notes);
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  const onChange = (v: string) => {
    setText(v);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    const id = meta.id;
    timer.current = window.setTimeout(() => {
      void minute.meetings.update(id, { notes: v }).then(() => idRef.current === id && setSaved(true));
    }, 500);
  };

  return (
    <div className="panel-body">
      <textarea
        className="notes-area"
        placeholder={'Vos notes…\n\nNotez l’essentiel en quelques mots : Minute s’en servira pour rédiger un compte-rendu centré sur ce qui compte pour vous.'}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="faint" style={{ textAlign: 'right' }}>
        {saved ? 'Enregistré' : 'Enregistrement…'}
      </div>
      {meta.bookmarks.length > 0 && (
        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Moments marqués
          </div>
          <div className="chips">
            {meta.bookmarks.map((b) => (
              <button key={b.id} className="chip" onClick={() => onTime(b.t)}>
                <Star fill="currentColor" style={{ color: 'var(--orange)' }} /> {clock(b.t)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Compte-rendu
function SummaryTab({
  meta,
  segments,
  live,
  stream,
  follow,
  hasAi,
  run,
  onTime,
  onOpenSettings,
}: {
  meta: MeetingMeta;
  segments: Segment[];
  live: boolean;
  stream?: Stream;
  follow?: Stream;
  hasAi: boolean;
  run: (k: AiKind, extra?: { question?: string; minutes?: number }) => Promise<string>;
  onTime: (ms: number) => void;
  onOpenSettings: () => void;
}) {
  const toast = useToast();
  const generating = stream && !stream.done;
  const md = generating ? stream.text : meta.summary?.markdown ?? '';
  const followText = follow && !follow.done ? follow.text : meta.followUp ?? '';
  const pending = segments.some((s) => s.pending);

  useEffect(() => {
    if (stream?.done && stream.error) toast(stream.error, 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.done]);

  if (!hasAi) {
    return (
      <div className="panel-body">
        <div className="empty" style={{ height: 'auto', paddingTop: 40 }}>
          <Sparkles size={28} color="var(--accent)" />
          <p>Ajoutez une clé d’IA (votre clé Groq suffit) pour obtenir des comptes-rendus automatiques.</p>
          <button className="btn primary" onClick={onOpenSettings}>
            Ouvrir les réglages
          </button>
        </div>
      </div>
    );
  }

  if (!md && !generating) {
    return (
      <div className="panel-body">
        <div className="empty" style={{ height: 'auto', paddingTop: 40 }}>
          <Sparkles size={28} color="var(--accent)" />
          <h2 style={{ fontSize: 16 }}>Compte-rendu</h2>
          <p>
            {live
              ? 'Il sera rédigé automatiquement à la fin de la réunion. Vous pouvez aussi en demander un brouillon maintenant.'
              : 'Résumé, décisions, actions et questions ouvertes — rédigés à partir de la transcription et de vos notes.'}
          </p>
          <button className="btn primary" disabled={!segments.length || pending} onClick={() => void run('summary')}>
            <Sparkles /> {live ? 'Brouillon maintenant' : 'Rédiger le compte-rendu'}
          </button>
          {pending && <span className="faint">Transcription en cours de finalisation…</span>}
          {stream?.error && <span className="faint" style={{ color: 'var(--red)' }}>{stream.error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="panel-body">
      {generating && (
        <div className="row faint">
          <Loader2 size={14} className="spin" /> {stream.progress || 'Rédaction du compte-rendu…'}
        </div>
      )}
      <Markdown
        text={md}
        streaming={!!generating}
        onTime={onTime}
        onToggle={(i) => {
          if (!meta.summary) return;
          void minute.meetings.update(meta.id, { summary: { ...meta.summary, markdown: toggleTask(meta.summary.markdown, i) } });
        }}
      />
      {!generating && meta.summary && (
        <>
          <div className="row wrap">
            <button
              className="btn small"
              onClick={async () => {
                await minute.meetings.copy(meta.id, { range: 'summary' });
                toast('Compte-rendu copié — prêt à coller dans un e-mail ou Word', 'success');
              }}
            >
              <Copy /> Copier
            </button>
            <button className="btn small" onClick={() => void run('followup')} disabled={!!follow && !follow.done}>
              <Mail /> E-mail de suivi
            </button>
            <span className="spacer" />
            <button className="icon-btn" title="Régénérer" onClick={() => void run('summary')}>
              <RotateCw />
            </button>
          </div>
          <div className="faint">
            {meta.summary.provider}
            {meta.summary.model ? ` · ${meta.summary.model}` : ''} · {relativeTime(meta.summary.generatedAt)}
          </div>
        </>
      )}
      {followText && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <Mail size={15} color="var(--accent)" />
            <b>E-mail de suivi</b>
            <span className="spacer" />
            {follow && !follow.done ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <button
                className="btn small"
                onClick={async () => {
                  await navigator.clipboard.writeText(followText);
                  toast('E-mail copié', 'success');
                }}
              >
                <Copy /> Copier
              </button>
            )}
          </div>
          <div className="selectable" style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>
            {followText}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Assistant
function AssistantTab({
  qa,
  live,
  hasAi,
  run,
  onTime,
  clear,
  onOpenSettings,
}: {
  qa: Stream[];
  live: boolean;
  hasAi: boolean;
  run: (k: AiKind, extra?: { question?: string; minutes?: number }) => Promise<string>;
  onTime: (ms: number) => void;
  clear: () => void;
  onOpenSettings: () => void;
}) {
  const [q, setQ] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [qa]);

  if (!hasAi) {
    return (
      <div className="panel-body">
        <div className="empty" style={{ height: 'auto', paddingTop: 40 }}>
          <MessageSquareText size={28} color="var(--accent)" />
          <p>Ajoutez une clé d’IA pour interroger vos réunions.</p>
          <button className="btn primary" onClick={onOpenSettings}>
            Ouvrir les réglages
          </button>
        </div>
      </div>
    );
  }

  const ask = () => {
    const question = q.trim();
    if (!question) return;
    setQ('');
    void run('ask', { question });
  };

  return (
    <div className="panel-body">
      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>
          {live ? 'Vous avez décroché ?' : 'Rattrapage'}
        </div>
        <div className="chips">
          {[2, 5, 10].map((m) => (
            <button key={m} className="chip" onClick={() => void run('catchup', { minutes: m })}>
              <History /> {m} dernières min
            </button>
          ))}
        </div>
      </div>
      <div className="section-title">Demander à la réunion</div>
      <div className="ask">
        <input
          className="field"
          placeholder="Ex. : qu’a-t-on décidé pour le budget ?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button className="btn primary" onClick={ask} disabled={!q.trim()} aria-label="Envoyer">
          <Send />
        </button>
      </div>
      {!qa.length && (
        <div className="chips">
          {['Qu’attend-on de moi ?', 'Quels chiffres ont été cités ?', 'Quelles sont les prochaines étapes ?'].map((s) => (
            <button key={s} className="chip" onClick={() => void run('ask', { question: s })}>
              {s}
            </button>
          ))}
        </div>
      )}
      {qa.map((s) => (
        <div key={s.requestId} className="card qa">
          {s.question && <div className="q">{s.question}</div>}
          {s.error ? (
            <div style={{ color: 'var(--red)' }}>{s.error}</div>
          ) : s.text ? (
            <Markdown text={s.text} streaming={!s.done} onTime={onTime} />
          ) : (
            <div className="row faint">
              <Loader2 size={14} className="spin" /> {s.progress || 'Réflexion…'}
            </div>
          )}
        </div>
      ))}
      {qa.length > 0 && (
        <button className="btn small ghost" style={{ alignSelf: 'center' }} onClick={clear}>
          <X /> Effacer
        </button>
      )}
      <div ref={bottom} />
    </div>
  );
}
