import { Copy, Maximize2, Pause, Play, Square, Star, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clock, speakerName, toTurns, turnText } from '../../shared/transcript';
import { minute, useElapsed, useInfo, useLevels, useLiveState, useMeeting } from '../app/api';
import '../app/styles.css';

function Mini() {
  const info = useInfo();
  const live = useLiveState();
  const id = live?.meetingId ?? null;
  const { data, interims } = useMeeting(id);
  const levels = useLevels(!!id);
  const elapsed = useElapsed(live);
  const box = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (!info) return;
    const html = document.documentElement;
    html.classList.add(info.platform === 'darwin' ? 'mac' : 'win');
    html.classList.toggle('material', info.material);
    html.style.setProperty('--accent', info.accent);
  }, [info]);

  const turns = data ? toTurns(data.segments.filter((s) => s.text)).slice(-8) : [];
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [turns.length, data?.segments, interims]);

  const say = (t: string) => {
    setFlash(t);
    setTimeout(() => setFlash(''), 1400);
  };

  if (!id || !data) {
    return (
      <div className="mini-root">
        <div className="mini-bar">
          <span className="title">Minute</span>
          <button className="icon-btn" onClick={() => void minute.windows.toggleMini()} title="Fermer">
            <X />
          </button>
        </div>
        <div className="mini-idle">
          <span>Aucune réunion en cours</span>
          <button className="btn small primary no-drag" onClick={() => void minute.recorder.start()}>
            Démarrer
          </button>
        </div>
      </div>
    );
  }

  const meta = data.meta;
  return (
    <div className="mini-root">
      <div className="mini-bar">
        <span className="timer">
          <span className={`dot ${live?.status === 'paused' ? 'paused' : 'pulse'}`} />
          {clock(elapsed)}
        </span>
        <span className="title">{flash || meta.title}</span>
        <button className="icon-btn" title="Marquer un moment" onClick={() => void minute.recorder.bookmark().then(() => say('★ Moment marqué'))}>
          <Star />
        </button>
        <button
          className="icon-btn"
          title="Copier la transcription"
          onClick={() => void minute.meetings.copy(meta.id, { range: 'all' }).then((r) => say(`${r.words} mots copiés`))}
        >
          <Copy />
        </button>
        {live?.status === 'paused' ? (
          <button className="icon-btn" title="Reprendre" onClick={() => void minute.recorder.resume()}>
            <Play />
          </button>
        ) : (
          <button className="icon-btn" title="Pause" onClick={() => void minute.recorder.pause()}>
            <Pause />
          </button>
        )}
        <button className="icon-btn" title="Terminer" style={{ color: 'var(--red)' }} onClick={() => void minute.recorder.stop()}>
          <Square fill="currentColor" />
        </button>
        <button className="icon-btn" title="Ouvrir Minute" onClick={() => void minute.windows.showMain(meta.id)}>
          <Maximize2 />
        </button>
        <button className="icon-btn" title="Masquer" onClick={() => void minute.windows.toggleMini()}>
          <X />
        </button>
      </div>
      <div className="mini-lines" ref={box}>
        {!turns.length && !interims.me && !interims.them && <p className="ghost">À l’écoute…</p>}
        {turns.map((t) => (
          <p key={t.key} className={t.ch}>
            <b>{speakerName(meta, t.ch)}</b>
            {turnText(t)}
          </p>
        ))}
        {(['them', 'me'] as const).map((ch) =>
          interims[ch] ? (
            <p key={ch} className={`${ch} ghost`}>
              <b>{speakerName(meta, ch)}</b>
              {interims[ch]!.text}
            </p>
          ) : (ch === 'me' ? levels.meSpeaking : levels.themSpeaking) ? (
            <p key={ch} className={`${ch} ghost`}>
              <b>{speakerName(meta, ch)}</b>
              <span className="wave" style={{ color: ch === 'me' ? 'var(--me)' : 'var(--them)' }}>
                <i />
                <i />
                <i />
              </span>
            </p>
          ) : null,
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Mini />);
