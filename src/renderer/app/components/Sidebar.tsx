import { Archive, ArchiveRestore, ChevronLeft, Clock, Download, FileText, FolderOpen, Hourglass, Lock, Merge, RotateCcw, Pencil, Pin, PinOff, Search, Settings, SquarePen, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, durationLabel } from '../../../shared/transcript';
import type { LiveState, MeetingMeta } from '../../../shared/types';
import { locale, t } from '../../../shared/i18n';
import { minute, useElapsed } from '../api';
import { AppGlyph, IslandIcon, useMenu, useToast } from './ui';

/** Nombre de jours calendaires écoulés depuis ts (0 = aujourd'hui, 1 = hier). */
function daysAgo(ts: number): number {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(new Date()) - start(new Date(ts))) / 86_400_000);
}

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const days = daysAgo(ts);
  if (days <= 0) return t('Aujourd’hui');
  if (days === 1) return t('Hier');
  if (days < 7) return t('Cette semaine');
  if (days < 31 && d.getMonth() === today.getMonth()) return t('Ce mois-ci');
  const label = d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function Sidebar({
  meetings,
  selected,
  live,
  query,
  onQuery,
  onSelect,
  onNew,
  onSettings,
  onRename,
  privacy = false,
}: {
  meetings: MeetingMeta[];
  selected: string | null;
  live: LiveState | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onRename: (id: string) => void;
  /** mode confidentiel actif : repère permanent */
  privacy?: boolean;
}) {
  const menu = useMenu();
  const toast = useToast();
  const elapsed = useElapsed(live);
  const searchRef = useRef<HTMLInputElement>(null);
  const liveId = live?.meetingId ?? null;
  const liveMeta = meetings.find((m) => m.id === liveId);
  const [view, setView] = useState<'main' | 'archive' | 'trash'>('main');
  const active = meetings.filter((m) => !m.deletedAt && !m.archived);
  const archived = meetings.filter((m) => !m.deletedAt && m.archived);
  const trashed = meetings.filter((m) => m.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const visible = view === 'archive' ? archived : view === 'trash' ? trashed : active;
  useEffect(() => {
    if (view === 'archive' && !archived.length) setView('main');
    if (view === 'trash' && !trashed.length) setView('main');
  }, [view, archived.length, trashed.length]);

  const groups = useMemo(() => {
    if (view === 'trash') return [{ label: t('Effacées définitivement 30 jours après'), items: visible }];
    const pinned = view === 'main' ? visible.filter((m) => m.pinned && m.id !== liveId) : [];
    const rest = visible.filter((m) => (view !== 'main' || !m.pinned) && m.id !== liveId);
    const out: { label: string; items: MeetingMeta[] }[] = [];
    if (pinned.length) out.push({ label: t('Épinglées'), items: pinned });
    for (const m of rest) {
      const label = groupLabel(m.startedAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, liveId, view]);

  const toTrash = async (m: MeetingMeta) => {
    await minute.meetings.trash(m.id);
    if (selected === m.id) onNew();
    toast(t('Placée dans la corbeille — récupérable pendant 30 jours'), 'success');
  };
  const daysLeft = (m: MeetingMeta) => Math.max(0, 30 - Math.floor((Date.now() - (m.deletedAt ?? 0)) / 86_400_000));

  const merge = async (a: MeetingMeta, b: MeetingMeta) => {
    if (
      !confirm(
        t('Réunir « {a} » et « {b} » en une seule réunion ?\nLa plus récente est ajoutée à la suite de l’autre ; le compte-rendu sera à refaire.', {
          a: a.title,
          b: b.title,
        }),
      )
    )
      return;
    try {
      const id = await minute.meetings.merge(a.id, b.id);
      onSelect(id);
      toast(t('Réunions fusionnées'), 'success');
    } catch (err) {
      toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    }
  };
  const when = (m: MeetingMeta, ref: MeetingMeta) => {
    const d = new Date(m.startedAt);
    const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    return new Date(ref.startedAt).toDateString() === d.toDateString()
      ? hm
      : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${hm}`;
  };

  const contextMenu = (e: React.MouseEvent, m: MeetingMeta) => {
    // voisines dans le temps (hors réunion en cours) : les candidates naturelles à une fusion
    const chrono = active.filter((x) => x.id !== liveId).sort((x, y) => x.startedAt - y.startedAt);
    const i = chrono.findIndex((x) => x.id === m.id);
    const before = i > 0 ? chrono[i - 1] : null;
    const after = i >= 0 && i < chrono.length - 1 ? chrono[i + 1] : null;
    if (m.deletedAt)
      return menu.open(e, [
        {
          label: t('Restaurer'),
          icon: <RotateCcw />,
          onClick: () => void minute.meetings.restore(m.id).then(() => toast(t('Réunion restaurée'), 'success')),
        },
        { separator: true },
        {
          label: t('Supprimer définitivement'),
          icon: <Trash2 />,
          danger: true,
          onClick: async () => {
            if (!confirm(t('Supprimer définitivement « {title} » ?\nCette action est irréversible.', { title: m.title }))) return;
            await minute.meetings.purge(m.id);
            if (selected === m.id) onNew();
          },
        },
      ]);
    const mergeItems =
      m.id === liveId || m.archived
        ? []
        : [
            ...(before
              ? [{ label: t('Fusionner avec la précédente'), hint: when(before, m), icon: <Merge />, onClick: () => void merge(before, m) }]
              : []),
            ...(after
              ? [{ label: t('Fusionner avec la suivante'), hint: when(after, m), icon: <Merge />, onClick: () => void merge(m, after) }]
              : []),
          ];
    return menu.open(e, [
      { label: t('Renommer'), icon: <Pencil />, onClick: () => onRename(m.id) },
      {
        label: m.pinned ? t('Désépingler') : t('Épingler'),
        icon: m.pinned ? <PinOff /> : <Pin />,
        onClick: () => void minute.meetings.update(m.id, { pinned: !m.pinned }),
      },
      { separator: true },
      { label: t('Exporter en Word'), icon: <FileText />, onClick: () => void exportAs(m.id, 'docx') },
      { label: t('Exporter en Markdown'), icon: <Download />, onClick: () => void exportAs(m.id, 'md') },
      { label: t('Afficher dans le dossier'), icon: <FolderOpen />, onClick: () => void minute.meetings.reveal(m.id) },
      ...(mergeItems.length ? [{ separator: true }, ...mergeItems] : []),
      { separator: true },
      m.archived
        ? { label: t('Désarchiver'), icon: <ArchiveRestore />, onClick: () => void minute.meetings.update(m.id, { archived: false }) }
        : {
            label: t('Archiver'),
            icon: <Archive />,
            onClick: async () => {
              await minute.meetings.update(m.id, { archived: true, pinned: false });
              toast(t('Réunion archivée — retrouvez-la dans les archives'), 'success');
            },
          },
      { label: t('Placer dans la corbeille'), icon: <Trash2 />, danger: true, onClick: () => void toTrash(m) },
    ]);
  };

  const exportAs = async (id: string, f: 'md' | 'docx') => {
    const path = await minute.meetings.exportTo(id, f);
    if (path) toast(t('Export enregistré'), 'success');
  };

  return (
    <aside className="sidebar">
      <div className="titlebar drag sidebar-top">
        <span className="brand" aria-hidden>
          <AppGlyph />
          Minute
        </span>
        {privacy && (
          <span className="privacy-badge" title={t('Mode confidentiel : tout reste sur cet ordinateur')}>
            <Lock /> {t('Confidentiel')}
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn no-drag" onClick={onNew} title={`${t('Nouvelle réunion')} (Ctrl+N)`} aria-label={t('Nouvelle réunion')}>
          <SquarePen />
        </button>
      </div>
      <div className="sidebar-search">
        <div className="search no-drag">
          <Search />
          <input
            ref={searchRef}
            id="global-search"
            placeholder={t('Rechercher')}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
          />
          {query && (
            <button className="icon-btn clear" onClick={() => onQuery('')} aria-label={t('Effacer')}>
              <X />
            </button>
          )}
        </div>
      </div>

      {view !== 'main' && (
        <div className="list-head">
          <button className="link-btn" onClick={() => setView('main')}>
            <ChevronLeft size={15} /> {t('Réunions')}
          </button>
          <b>{view === 'archive' ? t('Archives') : t('Corbeille')}</b>
          {view === 'trash' ? (
            <button
              className="link-btn danger"
              onClick={async () => {
                const n = trashed.length;
                const ask =
                  n > 1
                    ? t('Vider la corbeille ({n} réunions) ?\nCette action est irréversible.', { n })
                    : t('Vider la corbeille ({n} réunion) ?\nCette action est irréversible.', { n });
                if (!confirm(ask)) return;
                await minute.meetings.emptyTrash();
                setView('main');
              }}
            >
              {t('Vider')}
            </button>
          ) : (
            <span />
          )}
        </div>
      )}

      {view === 'main' && live?.meetingId ? (
        <button className="live-card" onClick={() => onSelect(live.meetingId!)}>
          <span className="row">
            <span className={`dot ${live.status === 'paused' ? 'paused' : 'pulse'}`} />
            {live.status === 'paused' ? t('En pause') : live.status === 'stopping' ? t('Finalisation…') : t('En direct')}
            <span className="spacer" />
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{clock(elapsed)}</span>
          </span>
          <span className="title">{liveMeta?.title ?? t('Réunion en cours')}</span>
        </button>
      ) : null}

      <div className="list">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="group-label">{g.label}</div>
            {g.items.map((m) => (
              <button
                key={m.id}
                className={`item ${selected === m.id ? 'active' : ''}`}
                onClick={() => onSelect(m.id)}
                onContextMenu={(e) => contextMenu(e, m)}
                onDoubleClick={() => onRename(m.id)}
              >
                <div className="t">
                  {m.pinned && <Pin size={12} />}
                  <span>{m.title}</span>
                </div>
                <div className="m">
                  <span>
                    {new Date(m.startedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
                    {daysAgo(m.startedAt) <= 1
                      ? ''
                      : ` · ${new Date(m.startedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`}
                  </span>
                  <span>·</span>
                  <span>{durationLabel(m.durationMs)}</span>
                  {m.bookmarks.length > 0 && (
                    <span className="badge">
                      <Star size={10} /> {m.bookmarks.length}
                    </span>
                  )}
                  {m.status === 'interrupted' && (
                    <span className="badge" title={t('Enregistrement interrompu puis récupéré')}>
                      <Hourglass size={10} /> {t('récupérée')}
                    </span>
                  )}
                  {m.source === 'natively' && <span className="badge quiet">Natively</span>}
                  {view === 'trash' && (
                    <span className="badge quiet" title={t('Ensuite, effacée définitivement')}>
                      {t('encore {n} j', { n: daysLeft(m) })}
                    </span>
                  )}
                </div>
                {m.preview && <div className="p">{m.preview}</div>}
              </button>
            ))}
          </div>
        ))}
        {!visible.length && view === 'main' && (
          <div className="faint" style={{ padding: '18px 12px' }}>
            {t('Vos réunions apparaîtront ici.')}
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <button className="icon-btn" onClick={onSettings} title={t('Réglages')} aria-label={t('Réglages')}>
          <Settings />
        </button>
        <button
          className="icon-btn"
          onClick={() => void minute.windows.enterCompact()}
          title={t('Passer en Dynamic Island')}
          aria-label={t('Passer en Dynamic Island')}
        >
          <IslandIcon />
        </button>
        <span className="grow">
          {live && live.queue > 0 ? (
            <>
              <Clock size={12} style={{ verticalAlign: -2 }} />{' '}
              {live.queue > 1
                ? t('{n} phrases en cours de transcription', { n: live.queue })
                : t('{n} phrase en cours de transcription', { n: live.queue })}
            </>
          ) : active.length > 1 ? (
            t('{n} réunions', { n: active.length })
          ) : (
            t('{n} réunion', { n: active.length })
          )}
        </span>
        {archived.length > 0 && (
          <button
            className={`icon-btn counted ${view === 'archive' ? 'on' : ''}`}
            onClick={() => setView(view === 'archive' ? 'main' : 'archive')}
            title={t('Archives ({n})', { n: archived.length })}
            aria-label={t('Archives')}
          >
            <Archive />
            <i>{archived.length}</i>
          </button>
        )}
        {trashed.length > 0 && (
          <button
            className={`icon-btn counted ${view === 'trash' ? 'on' : ''}`}
            onClick={() => setView(view === 'trash' ? 'main' : 'trash')}
            title={t('Corbeille ({n})', { n: trashed.length })}
            aria-label={t('Corbeille')}
          >
            <Trash2 />
            <i>{trashed.length}</i>
          </button>
        )}
      </div>
      {menu.node}
    </aside>
  );
}
