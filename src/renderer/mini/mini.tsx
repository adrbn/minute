// Mode compact — pilule discrète ou panneau de sous-titres, dans une fenêtre
// flottante qui remplace la fenêtre principale pendant la réunion.
import {
  AppWindow,
  ArrowUp,
  Settings as SettingsIcon,
  Captions,
  Check,
  Copy,
  History,
  LoaderCircle,
  MessageCircleQuestionMark,
  NotebookPen,
  Pause,
  Play,
  Square,
  Star,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { clock, durationLabel, speakerName, toTurns, turnText, voiceBadge, voiceClass, voiceLabel, voicePending } from '../../shared/transcript';
import type { AiEvent, CalendarState, CompactLayout, Levels } from '../../shared/types';
import { minute, useElapsed, useInfo, useLevels, useLiveState, useMeeting, useSettings } from '../app/api';
import { Markdown } from '../app/components/Markdown';
import '../app/styles.css';
import './compact.css';

// ------------------------------------------------------------------ ressort (Apple : amortissement 1, réponse ≈ 0,4 s)
function springEasing(response = 0.42, samples = 36) {
  const w = (2 * Math.PI) / response;
  const settle = 9.5 / w;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (settle * i) / samples;
    pts.push((1 - (1 + w * t) * Math.exp(-w * t)).toFixed(4));
  }
  pts[pts.length - 1] = '1';
  return { easing: `linear(${pts.join(', ')})`, ms: Math.round(settle * 1000) };
}
const SPRING = springEasing();
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.style.setProperty('--spring', SPRING.easing);
document.documentElement.style.setProperty('--spring-ms', `${SPRING.ms}ms`);

function useWindowSize() {
  const [s, set] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => set({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

// ------------------------------------------------------------------ déplacement direct (1:1, puis élan)
function useDrag(onTap: () => void) {
  const st = useRef<{ x0: number; y0: number; dragging: boolean; hist: { x: number; y: number; t: number }[] } | null>(null);
  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, textarea, .no-drag')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current = { x0: e.screenX, y0: e.screenY, dragging: false, hist: [{ x: e.screenX, y: e.screenY, t: performance.now() }] };
  };
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const s = st.current;
    if (!s) return;
    const now = performance.now();
    s.hist.push({ x: e.screenX, y: e.screenY, t: now });
    while (s.hist.length > 2 && now - s.hist[0].t > 100) s.hist.shift();
    if (!s.dragging && Math.hypot(e.screenX - s.x0, e.screenY - s.y0) > 4) {
      s.dragging = true;
      minute.windows.compactDrag('start', s.x0, s.y0);
    }
    if (s.dragging) minute.windows.compactDrag('move', e.screenX, e.screenY);
  };
  const onPointerUp = (e: RPointerEvent<HTMLElement>) => {
    const s = st.current;
    st.current = null;
    if (!s) return;
    if (!s.dragging) return onTap();
    const now = performance.now();
    const recent = s.hist.filter((p) => now - p.t < 100);
    let vx = 0;
    let vy = 0;
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = Math.max(0.008, (b.t - a.t) / 1000);
      vx = (b.x - a.x) / dt;
      vy = (b.y - a.y) / dt;
      const v = Math.hypot(vx, vy);
      if (v > 4000) {
        vx *= 4000 / v;
        vy *= 4000 / v;
      }
    }
    minute.windows.compactDrag('end', e.screenX, e.screenY, vx, vy);
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

// ------------------------------------------------------------------ petits éléments
/** Pastille (Dynamic Island) : « revenir à la pastille ». */
function IslandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="7.5" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

function Waves({ levels }: { levels: Levels }) {
  const bar = (v: number, k: number) => Math.max(0.18, Math.min(1, v * (k === 1 ? 1.15 : 0.8)));
  return (
    <span className="waves" aria-hidden>
      {(['me', 'them'] as const).map((ch) => (
        <span key={ch} className={`wave-group ${ch} ${levels[ch === 'me' ? 'meSpeaking' : 'themSpeaking'] ? 'on' : ''}`}>
          {[0, 1, 2].map((k) => (
            <i key={k} style={{ transform: `scaleY(${bar(levels[ch], k)})` }} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Dernière phrase en direct, sur une ligne : on voit la fin, le début s'efface. */
function Ticker({ ch, text, tone, voice = '' }: { ch?: 'me' | 'them'; text: string; tone?: 'warn' | 'error' | 'muted'; voice?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1);
    measure();
    // la place disponible change (survol, pastille ↔ panneau) : on remesure
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={box} className={`ticker ${over ? 'over' : ''} ${tone ?? ''}`} title={text}>
      <span className="ticker-in">
        {ch && <i className={`who-dot ${ch} ${voice}`} />}
        {text}
      </span>
    </span>
  );
}

/** Saisie dans la fenêtre compacte : sous Windows, elle ne prend le clavier que le temps de taper. */
const typing = {
  onPointerDown: (e: RPointerEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLInputElement;
    minute.windows.compactFocus(true);
    window.setTimeout(() => el.focus(), 40);
  },
  onFocus: () => minute.windows.compactFocus(true),
  onBlur: () => minute.windows.compactFocus(false),
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  },
};

type Tab = 'live' | 'notes' | 'ask';
interface Ask {
  id: string;
  q: string;
  text: string;
  done: boolean;
  error?: string;
  progress?: string;
}

/** Retour immédiat : l'icône devient ✓ pendant un instant. */
function useFlash(ms = 1400): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<number | null>(null);
  const fire = useCallback(() => {
    setOn(true);
    if (t.current) clearTimeout(t.current);
    t.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, fire];
}

// ------------------------------------------------------------------ passage pilule ↔ panneau (le temps de cette ouverture)
const chooseShape = (shape: 'pill' | 'panel') => void minute.windows.setCompactShape(shape);

// ------------------------------------------------------------------ fenêtre compacte
function Compact() {
  const info = useInfo();
  const [cfg] = useSettings();
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const live = useLiveState();
  const [lay, setLay] = useState<CompactLayout | null>(null);
  const layRef = useRef<CompactLayout | null>(null);
  layRef.current = lay;
  const [endedId, setEndedId] = useState<string | null>(null);
  const liveId = live?.meetingId ?? null;
  const meetingId = liveId ?? endedId;
  const { data, interims } = useMeeting(meetingId);
  const levels = useLevels(!!liveId);
  const elapsed = useElapsed(live);
  const win = useWindowSize();
  const [hover, setHover] = useState(false);
  const [copied, flashCopied] = useFlash();
  const [marked, flashMarked] = useFlash(1600);
  const [confirmStop, setConfirmStop] = useState(false);
  const [catchup, setCatchup] = useState<{ id: string; text: string; done: boolean; error?: string; after: string | null } | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [asks, setAsks] = useState<Ask[]>([]);
  const [question, setQuestion] = useState('');
  const [notes, setNotes] = useState('');
  const notesFocused = useRef(false);
  const notesTimer = useRef<number | null>(null);
  const [cal, setCal] = useState<CalendarState | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastText = useRef(Date.now());
  const lastVoice = useRef(0);
  const ack = useRef<'frame' | 'transition' | null>(null);
  const prevLive = useRef<string | null>(null);
  // préchargée en arrière-plan, la fenêtre n'est « active » qu'une fois affichée
  const [active, setActive] = useState(false);
  // apparition : petit ressort (sauf si l'utilisateur réduit les animations)
  const [entering, setEntering] = useState(false);
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current && !reduceMotion()) {
      setEntering(true);
      const t = window.setTimeout(() => setEntering(false), 700);
      wasActive.current = active;
      return () => clearTimeout(t);
    }
    wasActive.current = active;
  }, [active]);
  useEffect(
    () =>
      minute.on('compact', (on) => {
        setActive(on);
        if (!on) setEndedId(null);
      }),
    [],
  );

  // thème de couleur choisi dans les réglages
  useEffect(() => {
    const html = document.documentElement;
    if (!cfg?.palette || cfg.palette === 'system') delete html.dataset.palette;
    else html.dataset.palette = cfg.palette;
  }, [cfg?.palette]);

  // plateforme + accent
  useEffect(() => {
    if (!info) return;
    const html = document.documentElement;
    html.classList.add(info.platform === 'darwin' ? 'mac' : 'win');
    html.style.setProperty('--os-accent', info.accent);
  }, [info]);

  // disposition envoyée par le process principal (forme + ancrage) — avec accusé de réception
  useEffect(() => {
    void minute.windows.compactLayout().then((l) => {
      setLay(l);
      setActive(l.active);
    });
    return minute.on('compactLayout', (l) => {
      setActive(l.active);
      setLay((prev) => {
        ack.current = prev?.shape === 'panel' && l.shape === 'pill' && !reduceMotion() ? 'transition' : 'frame';
        return l;
      });
    });
  }, []);
  useLayoutEffect(() => {
    if (!ack.current) return;
    const mode = ack.current;
    ack.current = null;
    if (mode === 'frame') requestAnimationFrame(() => requestAnimationFrame(() => minute.windows.compactAck()));
    else window.setTimeout(() => minute.windows.compactAck(), Math.min(SPRING.ms, 560));
  }, [lay]);

  // fin de réunion : état « enregistrée », qui se retire seul (sauf si on la survole)
  useEffect(() => {
    if (prevLive.current && !liveId) setEndedId(prevLive.current);
    if (liveId) setEndedId(null);
    prevLive.current = liveId;
    setConfirmStop(false);
  }, [liveId]);
  useEffect(() => {
    if (!endedId || hover || !active) return;
    const t = window.setTimeout(() => {
      void minute.windows.exitCompact({ showMain: false });
      setEndedId(null);
    }, 12_000);
    return () => clearTimeout(t);
  }, [endedId, hover, active]);

  // rattrapage et questions IA
  useEffect(
    () =>
      minute.on('ai', (e: AiEvent) => {
        setCatchup((c) => (c && c.id === e.requestId ? { ...c, text: e.text || c.text, done: e.done, error: e.error } : c));
        setAsks((list) =>
          list.map((a) =>
            a.id === e.requestId ? { ...a, text: e.text || a.text, done: e.done, error: e.error, progress: e.progress ?? a.progress } : a,
          ),
        );
      }),
    [],
  );

  // agenda : la prochaine réunion s'affiche dans la pilule au repos
  useEffect(() => {
    void minute.calendar.state().then(setCal);
    return minute.on('calendar', setCal);
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // santé du direct : du son est capté mais aucun texte n'arrive
  useEffect(() => {
    lastText.current = Date.now();
  }, [data?.segments.length, interims.me?.text, interims.them?.text, liveId]);
  useEffect(() => {
    if (levels.meSpeaking || levels.themSpeaking) lastVoice.current = Date.now();
  }, [levels.meSpeaking, levels.themSpeaking]);

  // notes de la réunion, modifiables sans rouvrir l'app
  useEffect(() => {
    if (!notesFocused.current) setNotes(data?.meta.notes ?? '');
  }, [data?.meta.notes, meetingId]);
  const editNotes = (v: string) => {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    const id = meetingId;
    notesTimer.current = window.setTimeout(() => id && void minute.meetings.update(id, { notes: v }), 500);
  };

  // nouvelle réunion : on repart sur le direct
  useEffect(() => {
    setTab('live');
    setAsks([]);
  }, [liveId]);

  // forme à l'affichage : en réunion, celle que l'utilisateur préfère (sous-titres par défaut) ;
  // au repos, la pilule (le panneau n'aurait rien à montrer)
  const hasLay = !!lay;
  const liveMeeting = live?.meetingId ?? null;
  useEffect(() => {
    if (!active || !hasLay || !live) return;
    const current = layRef.current?.shape;
    if (liveMeeting) {
      // forme choisie dans les réglages (la pastille par défaut), à chaque ouverture
      const want = cfgRef.current?.compactShape === 'panel' ? 'panel' : 'pill';
      if (current !== want) void minute.windows.setCompactShape(want);
    } else if (!endedId && current === 'panel') {
      void minute.windows.setCompactShape('pill');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasLay, liveMeeting, endedId]);

  // défilement des sous-titres collé au direct
  const caps = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const turns = useMemo(() => (data ? toTurns(data.segments.filter((s) => s.text)).slice(-14) : []), [data]);
  const autoScroll = useRef(false);
  useLayoutEffect(() => {
    const el = caps.current;
    if (el && stick && el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
      autoScroll.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [turns, interims, stick, levels.meSpeaking, levels.themSpeaking, catchup]);

  const isPanel = lay?.shape === 'panel';
  const drag = useDrag(() => {
    if (!isPanel && liveId) chooseShape('panel');
  });

  if (!lay) return null;
  const M = lay.margin;
  const size = isPanel ? { w: win.w - 2 * M, h: win.h - 2 * M } : lay.pill;
  const a = lay.anchor;
  const pos: React.CSSProperties = {
    width: size.w,
    height: size.h,
    ...(a[0] === 't' ? { top: M } : { bottom: M }),
    ...(a[1] === 'l' ? { left: M } : a[1] === 'r' ? { right: M } : { left: '50%', transform: 'translateX(-50%)' }),
  };
  const panelBox: React.CSSProperties = {
    width: win.w - 2 * M,
    height: win.h - 2 * M,
    ...(a[0] === 't' ? { top: 0 } : { bottom: 0 }),
    ...(a[1] === 'l' ? { left: 0 } : a[1] === 'r' ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' }),
  };

  const meta = data?.meta;
  const status = live?.status ?? 'idle';
  const recording = !!liveId;
  const paused = status === 'paused';
  const problem =
    live?.notice?.kind === 'error' || live?.channels.me.ok === false || (live?.channels.them.enabled && live?.channels.them.ok === false)
      ? 'error'
      : live?.notice?.kind === 'warn'
        ? 'warn'
        : null;
  const problemText = live?.channels.me.ok === false ? live.channels.me.error : live?.channels.them.ok === false ? live.channels.them.error : live?.notice?.text;

  const copy = async () => {
    if (!meetingId) return;
    await minute.meetings.copy(meetingId, { range: 'all' });
    flashCopied();
  };
  const bookmark = async () => {
    await minute.recorder.bookmark();
    flashMarked();
  };
  const stop = () => {
    if (!confirmStop) {
      setConfirmStop(true);
      window.setTimeout(() => setConfirmStop(false), 3000);
      return;
    }
    setConfirmStop(false);
    void minute.recorder.stop();
  };
  const runCatchup = async () => {
    if (!liveId || (catchup && !catchup.done)) return;
    const after = turns.length ? turns[turns.length - 1].key : null;
    const id = await minute.ai.run({ kind: 'catchup', meetingId: liveId, minutes: 5 });
    setCatchup({ id, text: '', done: false, after });
    setStick(true);
  };
  const catchupCard = catchup && (
    <div className="cap-card no-drag" key="catchup">
      <div className="cap-card-head">
        <History />
        <b>Les 5 dernières minutes</b>
        <button className="hud-btn small" onClick={() => setCatchup(null)} title="Masquer" aria-label="Masquer le rattrapage">
          <X />
        </button>
      </div>
      {catchup.error ? (
        <p className="err">{catchup.error}</p>
      ) : catchup.text ? (
        <Markdown text={catchup.text} streaming={!catchup.done} />
      ) : (
        <p className="muted">Je relis ce qui vient d’être dit…</p>
      )}
    </div>
  );
  const openMain = () => void minute.windows.exitCompact({ meetingId: meetingId ?? undefined });
  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || !meetingId) return;
    setQuestion('');
    const id = await minute.ai.run({ kind: 'ask', meetingId, question: text });
    setAsks((list) => [...list.slice(-4), { id, q: text, text: '', done: false }]);
  };

  // pilule : dernière phrase (ou le problème en cours, en clair)
  const stale = recording && !paused && now - lastText.current > 60_000 && now - lastVoice.current < 15_000;
  const latest = (() => {
    const last = data?.segments.filter((x) => x.text).at(-1);
    const its = (['me', 'them'] as const)
      .map((ch) => (interims[ch] ? { ch, t0: interims[ch]!.t0, text: interims[ch]!.text } : null))
      .filter(Boolean) as { ch: 'me' | 'them'; t0: number; text: string }[];
    const it = its.sort((x, y) => y.t0 - x.t0)[0];
    if (it && (!last || it.t0 >= last.t0)) return { ch: it.ch, text: it.text, spk: undefined as string | undefined };
    return last ? { ch: last.ch, text: last.text, spk: last.spk } : null;
  })();
  const ticker = problem ? (
    <Ticker text={problemText || 'Problème de capture'} tone={problem} />
  ) : stale ? (
    <Ticker text="Pas de texte depuis 1 min — ouvrez les sous-titres pour vérifier" tone="warn" />
  ) : paused ? (
    <Ticker text="En pause — rien n’est transcrit" tone="muted" />
  ) : latest ? (
    <Ticker ch={latest.ch} text={latest.text} voice={meta ? voiceClass(meta, latest.spk) : ''} />
  ) : (
    <Ticker text="À l’écoute…" tone="muted" />
  );
  const next = cal?.events
    .filter((e) => e.end > now && e.start < now + 3 * 3600_000)
    .sort((x, y) => x.start - y.start)[0];
  const nextSoon = next && next.start - now < 10 * 60_000;
  const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ------------------------------------------------------------------ contenu « pilule »
  const pill = (
    <div className="pill-content">
      {recording ? (
        <>
          <span className={`rec ${paused ? 'paused' : ''}`} />
          <span className="t">{clock(elapsed)}</span>
          {!paused && <Waves levels={levels} />}
          {ticker}
          <span className="reveal">
            {paused ? (
              <button className="hud-btn" title="Reprendre" aria-label="Reprendre" onClick={() => void minute.recorder.resume()}>
                <Play />
              </button>
            ) : (
              <button
                className={`hud-btn ${marked ? 'marked' : ''}`}
                title="Marquer un moment"
                aria-label="Marquer un moment"
                onClick={() => void bookmark()}
              >
                <Star fill={marked ? 'currentColor' : 'none'} />
              </button>
            )}
            <button
              className={`hud-btn ${copied ? 'done' : ''}`}
              title="Copier la transcription"
              aria-label="Copier la transcription"
              onClick={() => void copy()}
            >
              {copied ? <Check /> : <Copy />}
            </button>
          </span>
          <button
            className="hud-btn"
            title="Afficher les sous-titres"
            aria-label="Afficher les sous-titres"
            onClick={() => chooseShape('panel')}
          >
            <Captions />
          </button>
        </>
      ) : endedId && meta ? (
        <>
          <span className="done-check">
            <Check />
          </span>
          <span className="pill-label strong">Enregistrée · {durationLabel(meta.durationMs)}</span>
          <span className="grow" />
          <button className="hud-pill-btn" onClick={openMain}>
            Voir
          </button>
        </>
      ) : (
        <>
          <span className="glyph" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="pill-label strong">Minute</span>
          {next ? (
            <Ticker text={`${next.start <= now ? 'En cours' : hm(next.start)} · ${next.title}`} tone="muted" />
          ) : (
            <span className="grow" />
          )}
          <button
            className="hud-pill-btn rec-start"
            title={nextSoon ? `Transcrire « ${next!.title} »` : 'Démarrer une transcription'}
            onClick={() => void minute.recorder.start(nextSoon ? { title: next!.title, eventId: next!.id } : undefined)}
          >
            <span className="rec" /> Démarrer
          </button>
          <button className="hud-btn" title="Réglages" aria-label="Réglages" onClick={() => void minute.windows.openSettings('compact')}>
            <SettingsIcon />
          </button>
          <button className="hud-btn" title="Ouvrir la fenêtre Minute" aria-label="Ouvrir la fenêtre Minute" onClick={openMain}>
            <AppWindow />
          </button>
        </>
      )}
    </div>
  );

  // ------------------------------------------------------------------ contenu « panneau »
  const panel = meta && (
    <div className="panel-content" style={panelBox}>
      <header className="p-head">
        {recording ? (
          <>
            <span className={`rec ${paused ? 'paused' : ''}`} />
            <span className="t">{clock(elapsed)}</span>
          </>
        ) : (
          <span className="done-check small">
            <Check />
          </span>
        )}
        {recording ? (
          <span className="p-tabs no-drag" role="tablist" title={meta.title}>
            {(
              [
                ['live', 'Direct', <Captions key="i" />],
                ['notes', 'Notes', <NotebookPen key="i" />],
                ['ask', 'Question', <MessageCircleQuestionMark key="i" />],
              ] as const
            ).map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} title={label}>
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </span>
        ) : (
          <span className="p-title">{meta.title}</span>
        )}
        {marked && <span className="p-flash">★</span>}
        {recording && <span className="grow" />}
        <span className="reveal">
          <button
            className="hud-btn"
            title="Réduire en Dynamic Island"
            aria-label="Réduire en Dynamic Island"
            onClick={() => chooseShape('pill')}
          >
            <IslandIcon />
          </button>
          <button className="hud-btn" title="Réglages" aria-label="Réglages" onClick={() => void minute.windows.openSettings('compact')}>
            <SettingsIcon />
          </button>
          <button className="hud-btn" title="Ouvrir la fenêtre Minute" aria-label="Ouvrir la fenêtre Minute" onClick={openMain}>
            <AppWindow />
          </button>
        </span>
      </header>
      {problem && recording && <div className={`p-banner ${problem}`}>{problemText}</div>}

      {recording && tab === 'notes' ? (
        <div className="p-notes-wrap">
          <textarea
            className="p-notes"
            value={notes}
            placeholder="Vos notes — elles guident le compte-rendu (ce qui compte pour vous, à qui envoyer quoi…)"
            onChange={(e) => editNotes(e.target.value)}
            {...typing}
            onFocus={() => {
              notesFocused.current = true;
              typing.onFocus();
            }}
            onBlur={() => {
              notesFocused.current = false;
              typing.onBlur();
            }}
          />
        </div>
      ) : recording && tab === 'ask' ? (
        <div className="p-ask">
          <div className="p-answers">
            {!asks.length && (
              <div className="p-suggest">
                <p>Demandez n’importe quoi sur ce qui a été dit.</p>
                {['Qu’attend-on de moi ?', 'Quelles décisions jusqu’ici ?', 'Qui doit faire quoi ?'].map((q) => (
                  <button key={q} className="hud-chip-inline" onClick={() => void ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {asks.map((a) => (
              <div key={a.id} className="p-qa">
                <p className="q">{a.q}</p>
                {a.error ? (
                  <p className="err">{a.error}</p>
                ) : a.text ? (
                  <Markdown text={a.text} streaming={!a.done} />
                ) : (
                  <p className="muted">
                    <LoaderCircle className="spin" /> {a.progress || 'Je relis la réunion…'}
                  </p>
                )}
              </div>
            ))}
          </div>
          <form
            className="p-ask-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <input
              value={question}
              placeholder="Demander à la réunion…"
              onChange={(e) => setQuestion(e.target.value)}
              {...typing}
            />
            <button className="hud-btn send" type="submit" disabled={!question.trim()} aria-label="Envoyer">
              <ArrowUp />
            </button>
          </form>
        </div>
      ) : !recording && endedId ? (
        <div className="p-ended">
          <span className="done-check big">
            <Check />
          </span>
          <b>Réunion enregistrée</b>
          <span>
            {durationLabel(meta.durationMs)} · {meta.wordCount.toLocaleString('fr-FR')} mots
          </span>
          <div className="row">
            <button className="hud-pill-btn primary" onClick={openMain}>
              Voir le compte-rendu
            </button>
            <button className="hud-pill-btn" onClick={() => void copy()}>
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`captions ${scrolledUp ? 'scrolled' : ''}`}
          ref={caps}
          onScroll={() => {
            const el = caps.current;
            if (!el) return;
            setScrolledUp(el.scrollTop > 4);
            if (autoScroll.current) {
              autoScroll.current = false;
              return;
            }
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 16);
            setScrolledUp(el.scrollTop > 4);
          }}
          onWheel={(e) => e.deltaY < 0 && setStick(false)}
        >
          {!turns.length && !interims.me && !interims.them && <p className="cap-empty">À l’écoute…</p>}
          {catchup && !catchup.after && catchupCard}
          {turns.map((t, i) => (
            <div key={t.key} className="cap-row">
              <p className={`cap ${t.ch} ${i < turns.length - 2 ? 'past' : ''}`}>
                <span className={`who ${voiceClass(meta, t.spk)}`} title={voiceLabel(meta, t.ch, t.spk)}>
                  {voicePending(meta, t.ch, t.spk) ? (
                    <span className="vbadge pending" />
                  ) : t.ch === 'me' && (!t.spk || meta.voices?.[t.spk]?.owner || !meta.voices?.[t.spk]) ? (
                    <span className="vbadge named me">{speakerName(meta, 'me')}</span>
                  ) : voiceBadge(meta, t.spk) ? (
                    <span className="vbadge">{voiceBadge(meta, t.spk)}</span>
                  ) : t.spk && meta.voices?.[t.spk]?.name ? (
                    <span className="vbadge named">{meta.voices[t.spk].name}</span>
                  ) : (
                    voiceLabel(meta, t.ch, t.spk)
                  )}
                </span>
                {turnText(t)}
              </p>
              {catchup?.after === t.key && catchupCard}
            </div>
          ))}
          {catchup?.after && !turns.some((t) => t.key === catchup.after) && catchupCard}
          {(['them', 'me'] as const).map((ch) => {
            const it = interims[ch];
            const speaking = ch === 'me' ? levels.meSpeaking : levels.themSpeaking;
            if (!it && !speaking) return null;
            return (
              <p key={ch} className={`cap ${ch} ghost`}>
                <span className="who">
                  {voicePending(meta, ch) ? (
                    <span className="vbadge pending" />
                  ) : ch === 'me' ? (
                    <span className="vbadge named me">{speakerName(meta, ch)}</span>
                  ) : (
                    speakerName(meta, ch)
                  )}
                </span>
                {it?.text}
                {speaking && (
                  <span className="wave">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </p>
            );
          })}
        </div>
      )}
      {!stick && recording && tab === 'live' && (
        <button
          className="hud-chip live-chip"
          onClick={() => {
            setStick(true);
            if (caps.current) caps.current.scrollTop = caps.current.scrollHeight;
          }}
        >
          Direct ↓
        </button>
      )}

      {recording && tab === 'live' && (
        <footer className="p-foot">
          {/* en pause, « Marquer » n'a pas de sens : sa place revient à « Reprendre » */}
          {!paused && (
            <button className={`hud-tool secondary ${marked ? 'ok' : ''}`} onClick={() => void bookmark()} title="Marquer un moment">
              <Star /> <span>Marquer</span>
            </button>
          )}
          <button className={`hud-tool secondary ${copied ? 'ok' : ''}`} onClick={() => void copy()} title="Copier la transcription">
            {copied ? <Check /> : <Copy />} <span>{copied ? 'Copié' : 'Copier'}</span>
          </button>
          <button
            className="hud-tool secondary"
            onClick={() => void runCatchup()}
            disabled={!!catchup && !catchup.done}
            title="Résumé des 5 dernières minutes"
          >
            {catchup && !catchup.done ? <LoaderCircle className="spin" /> : <History />} <span>Rattrapage</span>
          </button>
          <span className="grow" />
          {paused ? (
            <button className="hud-tool resume" onClick={() => void minute.recorder.resume()}>
              <Play /> <span>Reprendre</span>
            </button>
          ) : (
            <button className="hud-tool" onClick={() => void minute.recorder.pause()} title="Pause">
              <Pause />
            </button>
          )}
          <button className={`hud-tool stop ${confirmStop ? 'confirm' : ''}`} onClick={stop} disabled={status === 'stopping' || status === 'starting'}>
            <Square fill="currentColor" /> <span>{confirmStop ? 'Confirmer' : 'Terminer'}</span>
          </button>
        </footer>
      )}

      {recording && <ResizeCorners />}

    </div>
  );

  return (
    <div
      className={`shape ${isPanel ? 'is-panel' : 'is-pill'} ${hover ? 'hover' : ''} ${endedId && !recording ? 'ended' : ''} ${entering ? 'enter' : ''} ${active ? '' : 'dormant'}`}
      style={pos}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      {...drag}
    >
      <div className="layer pill-layer">{pill}</div>
      <div className="layer panel-layer">{panel}</div>
    </div>
  );
}

/**
 * Les deux coins du bas se tirent pour agrandir le panneau (zones invisibles, le curseur l'indique) ;
 * tout le haut reste une poignée pour déplacer l'île, sans risque de la redimensionner par erreur.
 */
function ResizeCorners() {
  return (
    <>
      {(['bl', 'br'] as const).map((c) => (
        <ResizeCorner key={c} corner={c} />
      ))}
    </>
  );
}

function ResizeCorner({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <span
      className={`corner ${corner} no-drag`}
      aria-hidden
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.screenX, y: e.screenY };
        minute.windows.compactResize('start', 0, 0, corner);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        minute.windows.compactResize('move', e.screenX - start.current.x, e.screenY - start.current.y);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        minute.windows.compactResize('end', e.screenX - start.current.x, e.screenY - start.current.y);
        start.current = null;
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Compact />);
