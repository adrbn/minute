import { ArrowDown, Copy, Play, Square, Star, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clock, normalize, speakerName, toTurns, turnText, type Turn } from '../../../shared/transcript';
import type { Bookmark, Channel, Levels, MeetingMeta, Segment } from '../../../shared/types';
import { minute, type Interims } from '../api';
import { useToast } from './ui';

// Lecture audio : un seul lecteur pour toute l'app.
const player = new Audio();
let playlist: string[] = [];
function playFrom(urls: string[], onEnd: () => void) {
  playlist = [...urls];
  const next = () => {
    const u = playlist.shift();
    if (!u) return onEnd();
    player.src = u;
    void player.play().catch(onEnd);
  };
  player.onended = next;
  next();
}

export function Transcript({
  meta,
  segments,
  interims,
  live,
  levels,
  find,
  focus,
}: {
  meta: MeetingMeta;
  segments: Segment[];
  interims: Interims;
  live: boolean;
  levels: Levels;
  find: string;
  focus: { t: number; key: number } | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const toast = useToast();
  const turns = useMemo(() => toTurns(segments), [segments]);
  const q = normalize(find.trim());

  // Moments marqués intercalés au bon endroit
  const rows = useMemo(() => {
    const out: ({ kind: 'turn'; turn: Turn } | { kind: 'bm'; bm: Bookmark })[] = [];
    const bms = [...meta.bookmarks].sort((a, b) => a.t - b.t);
    let bi = 0;
    for (const turn of turns) {
      while (bi < bms.length && bms[bi].t <= turn.t0) out.push({ kind: 'bm', bm: bms[bi++] });
      out.push({ kind: 'turn', turn });
    }
    while (bi < bms.length) out.push({ kind: 'bm', bm: bms[bi++] });
    return out;
  }, [turns, meta.bookmarks]);

  // Défilement « collant » : suit le direct tant que l'utilisateur est en bas.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick && !focus) el.scrollTop = el.scrollHeight;
  }, [rows, interims, stick, levels.meSpeaking, levels.themSpeaking, focus]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  // Aller à un instant précis (recherche, horodatage d'un compte-rendu)
  useEffect(() => {
    if (!focus) return;
    const target = [...turns].reverse().find((t) => t.t0 <= focus.t + 1500) ?? turns[0];
    if (!target) return;
    const el = document.querySelector(`[data-turn="${target.key}"]`) as HTMLElement | null;
    if (el) {
      setStick(false);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(target.key);
      setTimeout(() => setFlash(null), 2300);
    }
  }, [focus, turns]);

  const copyTurn = async (turn: Turn) => {
    await navigator.clipboard.writeText(`${speakerName(meta, turn.ch)} : ${turnText(turn)}`);
    toast('Passage copié', 'success');
  };

  const play = (turn: Turn) => {
    if (playing === turn.key) {
      player.pause();
      setPlaying(null);
      return;
    }
    const urls = turn.segments.filter((s) => s.audio).map((s) => minute.audioUrl(meta.id, s.audio!));
    if (!urls.length) return;
    setPlaying(turn.key);
    playFrom(urls, () => setPlaying(null));
  };

  const ghost = (ch: Channel) => {
    const speaking = ch === 'me' ? levels.meSpeaking : levels.themSpeaking;
    const it = interims[ch];
    if (!live || (!speaking && !it)) return null;
    return (
      <div className={`live-row ${ch}`} key={`ghost-${ch}`}>
        <span className="who">{speakerName(meta, ch)}</span>
        <span className="body">
          {it?.text}
          {speaking && (
            <span className="wave" style={{ color: ch === 'me' ? 'var(--me)' : 'var(--them)' }}>
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
      </div>
    );
  };

  const hasAudio = segments.some((s) => s.audio);

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={scroller} onScroll={onScroll}>
        <div className="transcript-inner">
          {!rows.length && !live && (
            <div className="empty">
              <p>Aucune parole transcrite dans cette réunion.</p>
            </div>
          )}
          {!rows.length && live && !levels.meSpeaking && !levels.themSpeaking && (
            <div className="empty" style={{ height: 'auto', paddingTop: 80 }}>
              <h2>À l’écoute…</h2>
              <p>Le texte apparaît ici au fil de la conversation. Vous pouvez copier à tout moment.</p>
            </div>
          )}
          {rows.map((r) =>
            r.kind === 'bm' ? (
              <div className="bookmark-row" key={r.bm.id}>
                <Star size={13} fill="currentColor" /> {r.bm.label} · {clock(r.bm.t)}
              </div>
            ) : (
              <Fragment key={r.turn.key}>
                <div className={`turn ${r.turn.ch} ${flash === r.turn.key ? 'flash' : ''}`} data-turn={r.turn.key}>
                  <div className="side">
                    <span className="who">{speakerName(meta, r.turn.ch)}</span>
                    <button
                      className={`ts ${hasAudio && r.turn.segments.some((s) => s.audio) ? 'play' : ''}`}
                      onClick={() => play(r.turn)}
                      title={hasAudio ? 'Réécouter' : undefined}
                    >
                      {clock(r.turn.t0)}
                    </button>
                  </div>
                  <div className="body">
                    {r.turn.segments.map((s) =>
                      editing === s.id ? (
                        <SegmentEditor
                          key={s.id}
                          seg={s}
                          onDone={async (text) => {
                            setEditing(null);
                            if (text !== null && text !== s.text) {
                              if (text.trim()) await minute.meetings.editSegment(meta.id, s.id, text);
                              else await minute.meetings.deleteSegment(meta.id, s.id);
                            }
                          }}
                        />
                      ) : (
                        <span
                          key={s.id}
                          className={`seg ${s.pending ? 'pending' : ''} ${q && normalize(s.text).includes(q) ? 'hit' : ''}`}
                          onDoubleClick={() => !s.pending && setEditing(s.id)}
                          title={s.pending ? 'Transcription en cours…' : 'Double-clic pour corriger'}
                        >
                          {s.text || (s.pending ? 'Transcription…' : '')}
                          {' '}
                        </span>
                      ),
                    )}
                  </div>
                  <div className="actions">
                    {r.turn.segments.some((s) => s.audio) && (
                      <button className="icon-btn" onClick={() => play(r.turn)} title="Réécouter">
                        {playing === r.turn.key ? <Square /> : <Play />}
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => void copyTurn(r.turn)} title="Copier ce passage">
                      <Copy />
                    </button>
                    <button
                      className="icon-btn"
                      title="Supprimer ce passage"
                      onClick={async () => {
                        for (const s of r.turn.segments) await minute.meetings.deleteSegment(meta.id, s.id);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              </Fragment>
            ),
          )}
          {ghost('them')}
          {ghost('me')}
        </div>
      </div>
      {!stick && live && (
        <button
          className="btn primary jump-live"
          onClick={() => {
            setStick(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown /> Revenir au direct
        </button>
      )}
    </div>
  );
}

function SegmentEditor({ seg, onDone }: { seg: Segment; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(seg.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const closed = useRef(false);
  const finish = (value: string | null) => {
    if (closed.current) return;
    closed.current = true;
    onDone(value);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  return (
    <textarea
      ref={ref}
      className="seg-edit"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight + 2}px`;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(text);
        }
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
    />
  );
}
