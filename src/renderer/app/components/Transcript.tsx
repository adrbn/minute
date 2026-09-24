import { ArrowDown, Copy, LoaderCircle, Play, Sparkles, Square, Star, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  clock,
  normalize,
  speakerName,
  toTurns,
  turnText,
  voiceBadge,
  voiceClass,
  voiceLabel,
  voiceLetter,
  voicePending,
  type Turn,
} from '../../../shared/transcript';
import { firstNameRe } from '../api';
import type { Bookmark, Channel, MeetingMeta, Segment } from '../../../shared/types';
import { minute, useSpeaking, type Interims } from '../api';
import { useToast } from './ui';

/**
 * « Qui est qui ? » : l'IA propose un prénom pour les voix non nommées, d'après la conversation
 * (on appelle Elsa, c'est B qui répond…). Rien n'est appliqué sans un clic.
 */
function VoiceNamer({ meta }: { meta: MeetingMeta }) {
  const [state, setState] = useState<{ id: string; done: boolean; text: string; error?: string } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(
    () =>
      minute.on('ai', (e) =>
        setState((s) => (s && e.requestId === s.id ? { ...s, text: e.text || s.text, done: e.done, error: e.error } : s)),
      ),
    [],
  );
  const voices = meta.voices ?? {};
  const unnamed = Object.entries(voices).filter(([, v]) => !v.name && !v.owner);
  if (!unnamed.length && !state) return null;
  const byLetter = new Map(unnamed.map(([k, v]) => [voiceLetter(v.n), k]));
  let guesses: { letter: string; key: string; name: string; why: string }[] = [];
  if (state?.done && !state.error) {
    try {
      const json = JSON.parse(state.text.slice(state.text.indexOf('{'), state.text.lastIndexOf('}') + 1)) as Record<
        string,
        { name?: string; why?: string }
      >;
      guesses = Object.entries(json)
        .map(([letter, g]) => ({ letter: letter.replace(/^Participant\s+/i, '').trim(), name: g?.name?.trim() ?? '', why: g?.why ?? '' }))
        .map((g) => ({ ...g, key: byLetter.get(g.letter) ?? '' }))
        .filter((g) => g.key && g.name && !dismissed.includes(g.key));
    } catch {
      guesses = [];
    }
  }
  const apply = (list: typeof guesses) => {
    const next = { ...voices };
    for (const g of list) next[g.key] = { ...next[g.key], name: g.name };
    void minute.meetings.update(meta.id, { voices: next });
    setDismissed((d) => [...d, ...list.map((g) => g.key)]);
    // plus rien à proposer : on revient à l'invitation (pour les voix encore sans nom)
    if (list.length >= guesses.length) setState(null);
  };
  const run = async () => setState({ id: await minute.ai.run({ kind: 'names', meetingId: meta.id }), done: false, text: '' });
  return (
    <div className="voice-namer">
      {!state ? (
        <>
          <span className="vn-lead">
            {unnamed.length} voix sans nom : {unnamed.map(([k, v]) => (
              <span key={k} className={`who ${voiceClass(meta, k)}`}>
                <span className="vbadge">{voiceLetter(v.n)}</span>
              </span>
            ))}
          </span>
          <button className="link-btn" onClick={() => void run()}>
            <Sparkles size={14} /> Deviner qui parle
          </button>
        </>
      ) : !state.done ? (
        <span className="vn-lead">
          <LoaderCircle size={14} className="spin" /> Je cherche qui est qui dans la conversation…
        </span>
      ) : state.error ? (
        <span className="vn-lead err">{state.error}</span>
      ) : guesses.length ? (
        <>
          {guesses.map((g) => (
            <button key={g.key} className={`vn-guess who ${voiceClass(meta, g.key)}`} onClick={() => apply([g])} title={g.why}>
              <span className="vbadge">{g.letter}</span> = <b>{g.name}</b> ?
            </button>
          ))}
          {guesses.length > 1 && (
            <button className="link-btn" onClick={() => apply(guesses)}>
              Tout appliquer
            </button>
          )}
          <button className="icon-btn small" onClick={() => setState(null)} aria-label="Fermer" title="Fermer">
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="vn-lead">Rien de sûr dans la conversation — cliquez sur une pastille pour la nommer.</span>
          <button className="icon-btn small" onClick={() => setState(null)} aria-label="Fermer" title="Fermer">
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/** Nom de l'intervenant ; un clic pour le renommer (vaut pour toute la réunion). */
function VoiceName({ meta, turn }: { meta: MeetingMeta; turn: Turn }) {
  const [editing, setEditing] = useState(false);
  const label = voiceLabel(meta, turn.ch, turn.spk);
  const v = turn.spk ? meta.voices?.[turn.spk] : undefined;
  if (voicePending(meta, turn.ch, turn.spk))
    return (
      <span className="who" title="Voix non reconnue (phrase trop courte)">
        <span className="vbadge pending" />
      </span>
    );
  if (!turn.spk || !v) return <span className="who">{label}</span>;
  const save = (name: string) => {
    setEditing(false);
    const clean = name.trim();
    if (clean === (v.name ?? '')) return;
    const next = { ...meta.voices, [turn.spk!]: { ...v, name: clean || undefined } };
    void minute.meetings.update(meta.id, { voices: next });
  };
  return editing ? (
    <input
      className={`who-edit ${voiceClass(meta, turn.spk)}`}
      defaultValue={v.name ?? ''}
      placeholder={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  ) : (
    <button
      className={`who voice ${voiceClass(meta, turn.spk)}`}
      onClick={() => setEditing(true)}
      title={`${label} — reconnu à sa voix. Cliquer pour ${v.name ? 'renommer' : 'lui donner un nom'} (vaut pour toute la réunion)`}
      aria-label={label}
    >
      {v.owner ? label : <span className={`vbadge ${v.name ? 'named' : ''}`}>{voiceBadge(meta, turn.spk) ?? v.name}</span>}
    </button>
  );
}

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
  find,
  focus,
}: {
  meta: MeetingMeta;
  segments: Segment[];
  interims: Interims;
  live: boolean;
  find: string;
  focus: { t: number; key: number } | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const toast = useToast();
  const speaking = useSpeaking(live);
  const handledFocus = useRef<number | null>(null);
  const turns = useMemo(() => toTurns(segments), [segments]);
  const q = normalize(find.trim());
  const nameRe = useMemo(() => firstNameRe(meta.speakers.me), [meta.speakers.me]);

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

  // Défilement « collant » : suit le direct tant que l'utilisateur ne remonte pas.
  // Dès qu'il remonte (molette, barre, clavier), on le laisse lire ; on ne se recolle
  // qu'une fois revenu tout en bas, ou via « Revenir au direct ».
  const autoScroll = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick && el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
      autoScroll.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [rows, interims, stick, speaking]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (autoScroll.current) {
      autoScroll.current = false;
      return;
    }
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) setStick(false);
  };

  // Aller à un instant précis (recherche, horodatage d'un compte-rendu)
  useEffect(() => {
    // chaque demande de saut n'est traitée qu'une fois : ensuite, le direct reprend la main
    if (!focus || handledFocus.current === focus.key || !turns.length) return;
    handledFocus.current = focus.key;
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
    await navigator.clipboard.writeText(`${voiceLabel(meta, turn.ch, turn.spk)} : ${turnText(turn)}`);
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
    const isSpeaking = speaking[ch];
    const it = interims[ch];
    if (!live || (!isSpeaking && !it)) return null;
    return (
      <div className={`live-row ${ch}`} key={`ghost-${ch}`}>
        <span className="who">
          {voicePending(meta, ch) ? <span className="vbadge pending" title="Voix en cours de reconnaissance" /> : speakerName(meta, ch)}
        </span>
        <span className="body">
          {it?.text}
          {isSpeaking && (
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
      <div className="transcript" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
        <div className="transcript-inner">
          {!live && <VoiceNamer meta={meta} />}
          {!rows.length && !live && (
            <div className="empty">
              <p>Aucune parole transcrite dans cette réunion.</p>
            </div>
          )}
          {!rows.length && live && !speaking.me && !speaking.them && (
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
                    <VoiceName meta={meta} turn={r.turn} />
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
                          className={`seg ${s.pending ? 'pending' : ''} ${q && normalize(s.text).includes(q) ? 'hit' : ''} ${
                            s.ch === 'them' && nameRe && nameRe.test(normalize(s.text)) ? 'mention' : ''
                          }`}
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
