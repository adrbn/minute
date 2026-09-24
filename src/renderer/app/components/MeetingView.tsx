import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Info,
  Mic,
  MicOff,
  MonitorSpeaker,
  PanelRight,
  Pause,
  Play,
  RotateCw,
  Search,
  Square,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clock, dateLabel, durationLabel } from '../../../shared/transcript';
import type { AppInfo, LiveState, Settings } from '../../../shared/types';
import { minute, shortcutLabel, useElapsed, useLevels, useMeeting } from '../api';
import { SidePanel, type PanelTab } from './SidePanel';
import { Transcript } from './Transcript';
import { IslandIcon, useMenu, useToast, useWidth } from './ui';

export function MeetingView({
  id,
  live,
  settings,
  info,
  hasAi,
  focusAt,
  renameSignal,
  onDeleted,
  onOpenSettings,
}: {
  id: string;
  live: LiveState | null;
  settings: Settings;
  info: AppInfo;
  hasAi: boolean;
  focusAt: { t: number; key: number } | null;
  renameSignal: number;
  onDeleted: () => void;
  onOpenSettings: () => void;
}) {
  const { data, interims } = useMeeting(id);
  const isLive = live?.meetingId === id;
  const elapsed = useElapsed(isLive ? live : null);
  const width = useWidth();
  // panneau latéral ouvert d'office seulement si la fenêtre est assez large
  const [panel, setPanel] = useState(() => window.innerWidth >= 1040);
  const wide = useRef(width >= 1040);
  useEffect(() => {
    const nowWide = width >= 1040;
    if (nowWide !== wide.current) setPanel(nowWide);
    wide.current = nowWide;
  }, [width]);
  const [tab, setTab] = useState<PanelTab>(isLive ? 'notes' : 'summary');
  const [find, setFind] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ t: number; key: number } | null>(focusAt);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const toast = useToast();
  const menu = useMenu();

  useEffect(() => setTab(isLive ? 'notes' : 'summary'), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // fin de réunion : on bascule sur le compte-rendu qui se rédige
  const wasLive = useRef(isLive);
  useEffect(() => {
    if (wasLive.current && !isLive) setTab('summary');
    wasLive.current = isLive;
  }, [isLive]);
  useEffect(() => setFocus(focusAt), [focusAt]);
  useEffect(() => {
    if (data?.meta.title !== undefined) setTitle(data.meta.title);
  }, [data?.meta.title]);
  useEffect(() => {
    if (renameSignal) setTimeout(() => titleRef.current?.select(), 50);
  }, [renameSignal]);

  // ⌘F / Ctrl+F : chercher dans cette réunion
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        e.preventDefault();
        setFind((f) => f ?? '');
        setTimeout(() => (document.getElementById('find-input') as HTMLInputElement | null)?.select(), 20);
      }
      if (e.key === 'Escape') setFind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!data) return <div className="content"><div className="titlebar drag" /></div>;
  const { meta, segments } = data;
  const pendingCount = segments.filter((s) => s.pending).length;
  const hits = find ? segments.filter((s) => s.text.toLowerCase().includes(find.toLowerCase())).length : 0;

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== meta.title) void minute.meetings.update(id, { title: t, titleIsAuto: false });
    else setTitle(meta.title);
  };

  const copy = async (range: 'all' | 'last5' | 'last10' | 'sinceBookmark', timestamps?: boolean) => {
    const { words } = await minute.meetings.copy(id, { range, timestamps });
    toast(`${words.toLocaleString('fr-FR')} mots copiés`, 'success');
  };

  const copyMenu = (e: React.MouseEvent) =>
    menu.open(e, [
      { label: 'Toute la transcription', icon: <Copy />, hint: shortcutLabel(settings.shortcuts.copy, info.platform), onClick: () => void copy('all') },
      { label: 'Les 5 dernières minutes', onClick: () => void copy('last5') },
      { label: 'Les 10 dernières minutes', onClick: () => void copy('last10') },
      ...(meta.bookmarks.length ? [{ label: 'Depuis le dernier moment marqué', onClick: () => void copy('sinceBookmark') }] : []),
      { separator: true },
      { label: 'Avec horodatage', onClick: () => void copy('all', true) },
      ...(meta.summary ? [{ label: 'Le compte-rendu', icon: <FileText />, onClick: () => void minute.meetings.copy(id, { range: 'summary' }).then(() => toast('Compte-rendu copié', 'success')) }] : []),
      ...(meta.notes.trim() ? [{ label: 'Mes notes', onClick: () => void minute.meetings.copy(id, { range: 'notes' }).then(() => toast('Notes copiées', 'success')) }] : []),
    ]);

  const moreMenu = (e: React.MouseEvent) =>
    menu.open(e, [
      { section: 'Exporter' },
      { label: 'Document Word (.docx)', icon: <FileText />, onClick: () => void exportAs('docx') },
      { label: 'Markdown (.md)', icon: <Download />, onClick: () => void exportAs('md') },
      { label: 'Texte brut (.txt)', icon: <Download />, onClick: () => void exportAs('txt') },
      { separator: true },
      { label: 'Renommer les voix…', icon: <Users />, onClick: renameSpeakers },
      { label: 'Afficher dans le dossier', icon: <FolderOpen />, onClick: () => void minute.meetings.reveal(id) },
      ...(meta.hasAudio && !isLive && !segments.some((x) => x.pending)
        ? [{ label: 'Supprimer l’audio conservé', icon: <MicOff />, onClick: () => void minute.meetings.update(id, { hasAudio: false }).then(() => toast('L’audio sera supprimé', 'success')) }]
        : []),
      { separator: true },
      {
        label: 'Placer dans la corbeille',
        icon: <Trash2 />,
        danger: true,
        onClick: async () => {
          if (!confirm(`Placer « ${meta.title} » dans la corbeille ?`)) return;
          await minute.meetings.remove(id);
          onDeleted();
        },
      },
    ]);

  const exportAs = async (f: 'md' | 'txt' | 'docx') => {
    const p = await minute.meetings.exportTo(id, f);
    if (p) toast('Export enregistré', 'success');
  };

  const renameSpeakers = () => {
    const me = prompt('Comment appeler votre voix ?', meta.speakers.me);
    if (me === null) return;
    const them = prompt('Et les autres participants ? (ex. « Marco », « Équipe Milan »)', meta.speakers.them);
    if (them === null) return;
    void minute.meetings.update(id, { speakers: { me: me.trim() || 'Moi', them: them.trim() || 'Participants' } });
  };

  const ch = live?.channels;
  const notice = isLive ? live?.notice : undefined;

  return (
    <div className="content">
      <div className="titlebar drag">
        <div className="meeting-head">
          <input
            ref={titleRef}
            className="meeting-title no-drag"
            value={title}
            size={Math.max(8, title.length + 1)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setTitle(meta.title);
                setTimeout(() => (e.target as HTMLInputElement).blur());
              }
            }}
          />
          <div className="meeting-sub">
            {isLive ? (
              <span>Commencée à {new Date(meta.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            ) : (
              <>
                <span>{dateLabel(meta.startedAt)}</span>
                <span>·</span>
                <span>{durationLabel(meta.durationMs)}</span>
                <span>·</span>
                <span>{meta.wordCount.toLocaleString('fr-FR')} mots</span>
              </>
            )}
            {!!meta.attendees?.length && (
              <span className="attendees" title={meta.attendees.join(', ')}>
                · avec {meta.attendees.slice(0, 3).join(', ')}
                {meta.attendees.length > 3 ? ` +${meta.attendees.length - 3}` : ''}
              </span>
            )}
          </div>
        </div>

        {isLive && live ? (
          <div className="livebar no-drag">
            <div className="timer">
              <span className={`dot ${live.status === 'paused' ? 'paused' : 'pulse'}`} />
              {clock(elapsed)}
            </div>
            <Meters live={live} />
            <button
              className="icon-btn"
              title={`Marquer un moment (${shortcutLabel(settings.shortcuts.bookmark, info.platform)})`}
              onClick={() => void minute.recorder.bookmark()}
            >
              <Star />
            </button>
            <button className="icon-btn" title="Copier" onClick={copyMenu}>
              <Copy />
            </button>
            <button
              className="btn small"
              title={`Réduire en Dynamic Island — la réunion continue (${shortcutLabel(settings.shortcuts.mini, info.platform)})`}
              onClick={() => void minute.windows.enterCompact()}
            >
              <IslandIcon /> <span className="lbl">Réduire</span>
            </button>
            {live.status === 'paused' ? (
              <button className="btn small" onClick={() => void minute.recorder.resume()}>
                <Play /> Reprendre
              </button>
            ) : (
              <button className="icon-btn" title="Pause" onClick={() => void minute.recorder.pause()} disabled={live.status !== 'recording'}>
                <Pause />
              </button>
            )}
            <button
              className="btn small stop-btn"
              onClick={() => void minute.recorder.stop()}
              disabled={live.status === 'stopping' || live.status === 'starting'}
            >
              <Square fill="currentColor" size={12} /> {live.status === 'stopping' ? 'Finalisation…' : 'Terminer'}
            </button>
          </div>
        ) : (
          <div className="row no-drag">
            <button className="btn small" onClick={copyMenu}>
              <Copy /> Copier <ChevronDown size={13} />
            </button>
            <button className="icon-btn" title="Plus" onClick={moreMenu}>
              <Download />
            </button>
          </div>
        )}
        <button className={`icon-btn no-drag ${panel ? 'on' : ''}`} title="Panneau latéral" onClick={() => setPanel((p) => !p)}>
          <PanelRight />
        </button>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.kind === 'info' ? <Info /> : <AlertTriangle />}
          <span className="grow">{notice.text}</span>
          {notice.kind === 'error' && (
            <button className="btn small" onClick={onOpenSettings}>
              Réglages
            </button>
          )}
          {notice.text.startsWith('Plus personne') && (
            <button className="btn small danger" onClick={() => void minute.recorder.stop()}>
              Terminer
            </button>
          )}
        </div>
      )}
      {isLive && (ch?.me.ok === false || (ch?.them.enabled && ch?.them.ok === false)) && (
        <div className="notice error">
          <AlertTriangle />
          <span className="grow">{ch?.me.ok === false ? ch.me.error : ch?.them.error}</span>
          <button
            className="btn small"
            onClick={() => void minute.windows.openPrivacySettings(ch?.me.ok === false ? 'microphone' : 'audio')}
          >
            Autorisations
          </button>
        </div>
      )}
      {!isLive && pendingCount > 0 && (
        <div className="notice warn">
          <AlertTriangle />
          <span className="grow">
            {pendingCount} passage{pendingCount > 1 ? 's' : ''} en attente de transcription (réseau ou limite Groq).
          </span>
          <button className="btn small" onClick={() => void minute.meetings.retryPending(id).then((n) => toast(n ? `${n} passage(s) relancé(s)` : 'Déjà en cours', 'info'))}>
            <RotateCw /> Relancer
          </button>
        </div>
      )}

      <div className="meeting-body">
        <div className="transcript-wrap">
          {find !== null && (
            <div className="find-bar">
              <Search size={14} />
              <input
                id="find-input"
                className="field"
                style={{ height: 26 }}
                placeholder="Chercher dans la réunion"
                value={find}
                autoFocus
                onChange={(e) => setFind(e.target.value)}
              />
              <span>{find ? `${hits} passage${hits > 1 ? 's' : ''}` : ''}</span>
              <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setFind(null)}>
                <X size={14} />
              </button>
            </div>
          )}
          <Transcript
            meta={meta}
            segments={segments}
            interims={interims}
            live={isLive}
            find={find ?? ''}
            focus={focus}
          />
        </div>
        {panel && (
          <SidePanel
            meta={meta}
            segments={segments}
            live={isLive}
            tab={tab}
            onTab={setTab}
            hasAi={hasAi}
            onOpenSettings={onOpenSettings}
            onTime={(t) => setFocus({ t, key: Date.now() })}
          />
        )}
      </div>
      {menu.node}
    </div>
  );
}

/** Vumètres (micro / son de l'ordinateur) : seul ce petit composant se redessine 11 fois par seconde. */
function Meters({ live }: { live: LiveState }) {
  const levels = useLevels(true);
  const ch = live.channels;
  return (
    <div className="meters" title="Niveaux audio">
      <div className={`meter me ${ch.me.ok === false ? 'err' : ''}`} title={ch.me.error}>
        <Mic size={11} />
        <span className="bar">
          <i style={{ width: `${Math.round(levels.me * 100)}%` }} />
        </span>
      </div>
      {ch.them.enabled && (
        <div className={`meter them ${ch.them.ok === false ? 'err' : ''}`} title={ch.them.error}>
          <MonitorSpeaker size={11} />
          <span className="bar">
            <i style={{ width: `${Math.round(levels.them * 100)}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}
