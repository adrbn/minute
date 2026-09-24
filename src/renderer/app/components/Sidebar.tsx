import { Clock, Download, FileText, FolderOpen, Hourglass, Pencil, Pin, PinOff, Plus, Search, Settings, Star, Trash2, X } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { clock, durationLabel } from '../../../shared/transcript';
import type { LiveState, MeetingMeta } from '../../../shared/types';
import { minute, useElapsed } from '../api';
import { useMenu, useToast } from './ui';

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return 'Cette semaine';
  if (days < 31 && d.getMonth() === today.getMonth()) return 'Ce mois-ci';
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
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
}) {
  const menu = useMenu();
  const toast = useToast();
  const elapsed = useElapsed(live);
  const searchRef = useRef<HTMLInputElement>(null);
  const liveId = live?.meetingId ?? null;
  const liveMeta = meetings.find((m) => m.id === liveId);

  const groups = useMemo(() => {
    const pinned = meetings.filter((m) => m.pinned && m.id !== liveId);
    const rest = meetings.filter((m) => !m.pinned && m.id !== liveId);
    const out: { label: string; items: MeetingMeta[] }[] = [];
    if (pinned.length) out.push({ label: 'Épinglées', items: pinned });
    for (const m of rest) {
      const label = groupLabel(m.startedAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [meetings, liveId]);

  const contextMenu = (e: React.MouseEvent, m: MeetingMeta) =>
    menu.open(e, [
      { label: 'Renommer', icon: <Pencil />, onClick: () => onRename(m.id) },
      {
        label: m.pinned ? 'Désépingler' : 'Épingler',
        icon: m.pinned ? <PinOff /> : <Pin />,
        onClick: () => void minute.meetings.update(m.id, { pinned: !m.pinned }),
      },
      { separator: true },
      { label: 'Exporter en Word', icon: <FileText />, onClick: () => void exportAs(m.id, 'docx') },
      { label: 'Exporter en Markdown', icon: <Download />, onClick: () => void exportAs(m.id, 'md') },
      { label: 'Afficher dans le dossier', icon: <FolderOpen />, onClick: () => void minute.meetings.reveal(m.id) },
      { separator: true },
      {
        label: 'Placer dans la corbeille',
        icon: <Trash2 />,
        danger: true,
        onClick: async () => {
          if (!confirm(`Placer « ${m.title} » dans la corbeille ?\nVous pourrez la récupérer depuis la corbeille du système.`)) return;
          await minute.meetings.remove(m.id);
          toast('Réunion placée dans la corbeille', 'success');
        },
      },
    ]);

  const exportAs = async (id: string, f: 'md' | 'docx') => {
    const path = await minute.meetings.exportTo(id, f);
    if (path) toast('Export enregistré', 'success');
  };

  return (
    <aside className="sidebar">
      <div className="titlebar drag">
        <div className="search no-drag">
          <Search />
          <input
            ref={searchRef}
            id="global-search"
            placeholder="Rechercher"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
          />
          {query && (
            <button className="icon-btn clear" onClick={() => onQuery('')} aria-label="Effacer">
              <X />
            </button>
          )}
        </div>
      </div>

      {live?.meetingId ? (
        <button className="live-card" onClick={() => onSelect(live.meetingId!)}>
          <span className="row">
            <span className={`dot ${live.status === 'paused' ? 'paused' : 'pulse'}`} />
            {live.status === 'paused' ? 'En pause' : live.status === 'stopping' ? 'Finalisation…' : 'En direct'}
            <span className="spacer" />
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{clock(elapsed)}</span>
          </span>
          <span className="title">{liveMeta?.title ?? 'Réunion en cours'}</span>
        </button>
      ) : (
        <button className="btn primary new-btn" onClick={onNew}>
          <Plus /> Nouvelle réunion
        </button>
      )}

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
                    {new Date(m.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    {groupLabel(m.startedAt).startsWith('Aujourd') || groupLabel(m.startedAt) === 'Hier'
                      ? ''
                      : ` · ${new Date(m.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
                  </span>
                  <span>·</span>
                  <span>{durationLabel(m.durationMs)}</span>
                  {m.bookmarks.length > 0 && (
                    <span className="badge">
                      <Star size={10} /> {m.bookmarks.length}
                    </span>
                  )}
                  {m.status === 'interrupted' && (
                    <span className="badge" title="Enregistrement interrompu puis récupéré">
                      <Hourglass size={10} /> récupérée
                    </span>
                  )}
                  {m.source === 'natively' && <span className="badge">Natively</span>}
                </div>
                {m.preview && <div className="p">{m.preview}</div>}
              </button>
            ))}
          </div>
        ))}
        {!meetings.length && (
          <div className="faint" style={{ padding: '18px 12px' }}>
            Vos réunions apparaîtront ici.
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <button className="icon-btn" onClick={onSettings} title="Réglages">
          <Settings />
        </button>
        <span className="grow">
          {live && live.queue > 0 ? (
            <>
              <Clock size={12} style={{ verticalAlign: -2 }} /> {live.queue} phrase{live.queue > 1 ? 's' : ''} en cours de transcription
            </>
          ) : (
            `${meetings.length} réunion${meetings.length > 1 ? 's' : ''}`
          )}
        </span>
      </div>
      {menu.node}
    </aside>
  );
}
