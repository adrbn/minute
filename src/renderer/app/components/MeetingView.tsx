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
  Archive,
  ArchiveRestore,
  Users,
  X,
  LoaderCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t, locale } from '../../../shared/i18n';
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
    const clean = title.trim();
    if (clean && clean !== meta.title) void minute.meetings.update(id, { title: clean, titleIsAuto: false });
    else setTitle(meta.title);
  };

  const copy = async (range: 'all' | 'last5' | 'last10' | 'sinceBookmark', timestamps?: boolean) => {
    const { words } = await minute.meetings.copy(id, { range, timestamps });
    const n = words.toLocaleString(locale());
    toast(words === 1 ? t('{n} mot copié', { n }) : t('{n} mots copiés', { n }), 'success');
  };

  const copyMenu = (e: React.MouseEvent) =>
    menu.open(e, [
      { label: t('Toute la transcription'), icon: <Copy />, hint: shortcutLabel(settings.shortcuts.copy, info.platform), onClick: () => void copy('all') },
      { label: t('Les 5 dernières minutes'), onClick: () => void copy('last5') },
      { label: t('Les 10 dernières minutes'), onClick: () => void copy('last10') },
      ...(meta.bookmarks.length ? [{ label: t('Depuis le dernier moment marqué'), onClick: () => void copy('sinceBookmark') }] : []),
      { separator: true },
      { label: t('Avec horodatage'), onClick: () => void copy('all', true) },
      ...(meta.summary ? [{ label: t('Le compte-rendu'), icon: <FileText />, onClick: () => void minute.meetings.copy(id, { range: 'summary' }).then(() => toast(t('Compte-rendu copié'), 'success')) }] : []),
      ...(meta.notes.trim() ? [{ label: t('Mes notes'), onClick: () => void minute.meetings.copy(id, { range: 'notes' }).then(() => toast(t('Notes copiées'), 'success')) }] : []),
    ]);

  const moreMenu = (e: React.MouseEvent) =>
    menu.open(e, [
      { section: t('Exporter') },
      { label: t('Document Word (.docx)'), icon: <FileText />, onClick: () => void exportAs('docx') },
      { label: 'Markdown (.md)', icon: <Download />, onClick: () => void exportAs('md') },
      { label: t('Texte brut (.txt)'), icon: <Download />, onClick: () => void exportAs('txt') },
      { separator: true },
      { label: t('Renommer les voix…'), icon: <Users />, onClick: renameSpeakers },
      { label: t('Afficher dans le dossier'), icon: <FolderOpen />, onClick: () => void minute.meetings.reveal(id) },
      ...(meta.hasAudio && !isLive && !segments.some((x) => x.pending)
        ? [{ label: t('Supprimer l’audio conservé'), icon: <MicOff />, onClick: () => void minute.meetings.update(id, { hasAudio: false }).then(() => toast(t('L’audio sera supprimé'), 'success')) }]
        : []),
      { separator: true },
      meta.archived
        ? { label: t('Désarchiver'), icon: <ArchiveRestore />, onClick: () => void minute.meetings.update(id, { archived: false }) }
        : {
            label: t('Archiver'),
            icon: <Archive />,
            onClick: async () => {
              await minute.meetings.update(id, { archived: true, pinned: false });
              toast(t('Réunion archivée'), 'success');
            },
          },
      {
        label: t('Placer dans la corbeille'),
        icon: <Trash2 />,
        danger: true,
        onClick: async () => {
          await minute.meetings.trash(id);
          toast(t('Placée dans la corbeille — récupérable pendant 30 jours'), 'success');
          onDeleted();
        },
      },
    ]);

  const exportAs = async (f: 'md' | 'txt' | 'docx') => {
    const p = await minute.meetings.exportTo(id, f);
    if (p) toast(t('Export enregistré'), 'success');
  };

  const renameSpeakers = () => {
    const me = prompt(t('Comment appeler votre voix ?'), meta.speakers.me);
    if (me === null) return;
    const them = prompt(t('Et les autres participants ? (ex. « Marco », « Équipe Milan »)'), meta.speakers.them);
    if (them === null) return;
    // 'Moi' / 'Participants' : valeurs par défaut enregistrées (repères reconnus ailleurs), pas du texte affiché
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
              <span>
                {t('Commencée à {time}', {
                  time: new Date(meta.startedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
                })}
              </span>
            ) : (
              <>
                <span>{dateLabel(meta.startedAt)}</span>
                <span>·</span>
                <span>{durationLabel(meta.durationMs)}</span>
                <span>·</span>
                <span>
                  {meta.wordCount === 1
                    ? t('{n} mot', { n: meta.wordCount.toLocaleString(locale()) })
                    : t('{n} mots', { n: meta.wordCount.toLocaleString(locale()) })}
                </span>
              </>
            )}
            {!!meta.attendees?.length && (
              <span className="attendees" title={meta.attendees.join(', ')}>
                · {t('avec {names}', { names: meta.attendees.slice(0, 3).join(', ') })}
                {meta.attendees.length > 3 ? ` +${meta.attendees.length - 3}` : ''}
              </span>
            )}
          </div>
        </div>

        {isLive && live ? (
          <div className="livebar no-drag">
            <div className="live-status" title={live.status === 'paused' ? t('En pause') : t('Enregistrement en cours')}>
              <div className="timer">
                <span className={`dot ${live.status === 'paused' ? 'paused' : 'pulse'}`} />
                {clock(elapsed)}
              </div>
              <Meters live={live} />
            </div>
            <button
              className="icon-btn"
              title={t('Marquer un moment ({shortcut})', { shortcut: shortcutLabel(settings.shortcuts.bookmark, info.platform) })}
              onClick={() => void minute.recorder.bookmark()}
            >
              <Star />
            </button>
            <button className="icon-btn" title={t('Copier')} onClick={copyMenu}>
              <Copy />
            </button>
            {live.status === 'paused' ? (
              <button className="btn small" onClick={() => void minute.recorder.resume()}>
                <Play /> {t('Reprendre')}
              </button>
            ) : (
              <button className="icon-btn" title={t('Pause')} onClick={() => void minute.recorder.pause()} disabled={live.status !== 'recording'}>
                <Pause />
              </button>
            )}
            <button className={`icon-btn ${panel ? 'on' : ''}`} title={t('Panneau latéral')} onClick={() => setPanel((p) => !p)}>
              <PanelRight />
            </button>
            <span className="livebar-gap" />
            <button
              className="btn small primary reduce-btn"
              title={t('Réduire en Dynamic Island — la réunion continue ({shortcut})', { shortcut: shortcutLabel(settings.shortcuts.mini, info.platform) })}
              onClick={() => void minute.windows.enterCompact()}
            >
              <IslandIcon /> <span className="lbl">{t('Réduire')}</span>
            </button>
            <button
              className="stop-round"
              title={live.status === 'stopping' ? t('Finalisation…') : t('Terminer la réunion')}
              aria-label={t('Terminer la réunion')}
              onClick={() => void minute.recorder.stop()}
              disabled={live.status === 'stopping' || live.status === 'starting'}
            >
              {live.status === 'stopping' ? <LoaderCircle size={15} className="spin" /> : <Square fill="currentColor" size={11} />}
            </button>
          </div>
        ) : (
          <div className="row no-drag">
            <button className="btn small" onClick={copyMenu}>
              <Copy /> {t('Copier')} <ChevronDown size={13} />
            </button>
            <button className="icon-btn" title={t('Plus')} onClick={moreMenu}>
              <Download />
            </button>
          </div>
        )}
        {!(isLive && live) && (
          <button className={`icon-btn no-drag ${panel ? 'on' : ''}`} title={t('Panneau latéral')} onClick={() => setPanel((p) => !p)}>
            <PanelRight />
          </button>
        )}
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.kind === 'info' ? <Info /> : <AlertTriangle />}
          <span className="grow">{notice.text}</span>
          {notice.kind === 'error' && (
            <button className="btn small" onClick={onOpenSettings}>
              {t('Réglages')}
            </button>
          )}
          {isIdleNotice(notice.text) && (
            <button className="btn small danger" onClick={() => void minute.recorder.stop()}>
              {t('Terminer')}
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
            {t('Autorisations')}
          </button>
        </div>
      )}
      {!isLive && pendingCount > 0 && (
        <div className="notice warn">
          <AlertTriangle />
          <span className="grow">
            {pendingCount > 1
              ? t('{n} passages en attente de transcription (réseau ou limite Groq).', { n: pendingCount })
              : t('{n} passage en attente de transcription (réseau ou limite Groq).', { n: pendingCount })}
          </span>
          <button
            className="btn small"
            onClick={() =>
              void minute.meetings
                .retryPending(id)
                .then((n) => toast(!n ? t('Déjà en cours') : n > 1 ? t('{n} passages relancés', { n }) : t('{n} passage relancé', { n }), 'info'))
            }
          >
            <RotateCw /> {t('Relancer')}
          </button>
        </div>
      )}

      {(meta.deletedAt || meta.archived) && (
        <div className={`state-banner ${meta.deletedAt ? 'trash' : ''}`}>
          {meta.deletedAt ? <Trash2 size={15} /> : <Archive size={15} />}
          <span>
            {meta.deletedAt
              ? t('Dans la corbeille : effacée définitivement le {date}.', {
                  date: new Date(meta.deletedAt + 30 * 86_400_000).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }),
                })
              : t('Réunion archivée : elle n’apparaît plus dans la liste, mais reste dans la recherche.')}
          </span>
          <button
            className="btn small"
            onClick={() => void (meta.deletedAt ? minute.meetings.restore(id) : minute.meetings.update(id, { archived: false }))}
          >
            {meta.deletedAt ? t('Restaurer') : t('Désarchiver')}
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
                placeholder={t('Chercher dans la réunion')}
                value={find}
                autoFocus
                onChange={(e) => setFind(e.target.value)}
              />
              <span>{find ? (hits > 1 ? t('{n} passages', { n: hits }) : t('{n} passage', { n: hits })) : ''}</span>
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

/**
 * Avis « plus personne ne parle » envoyé par le processus principal : son texte est traduit là-bas
 * avec la même clé, on le reconnaît donc d'après le modèle traduit (variables quelconques).
 */
function isIdleNotice(text: string): boolean {
  if (text.startsWith('Plus personne')) return true;
  const tpl = t('Plus personne ne parle depuis {mins} min — la réunion est peut-être terminée.');
  const pattern = tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+?');
  return new RegExp(`^${pattern}$`).test(text);
}

/** Vumètres (micro / son de l'ordinateur) : seul ce petit composant se redessine 11 fois par seconde. */
function Meters({ live }: { live: LiveState }) {
  const levels = useLevels(true);
  const ch = live.channels;
  return (
    <div className="meters" title={t('Niveaux audio')}>
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
