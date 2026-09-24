import { useCallback, useEffect, useState } from 'react';
import type { SecretName } from '../../shared/types';
import { minute, useInfo, useLiveState, useMeetings, useSettings } from './api';
import { MeetingView } from './components/MeetingView';
import { Onboarding } from './components/Onboarding';
import { SearchResults } from './components/SearchResults';
import { SettingsSheet } from './components/SettingsSheet';
import { Sidebar } from './components/Sidebar';
import { StartView } from './components/StartView';

export function App() {
  const info = useInfo();
  const [settings, update] = useSettings();
  const meetings = useMeetings();
  const live = useLiveState();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [secrets, setSecrets] = useState<Record<SecretName, boolean> | null>(null);
  const [focusAt, setFocusAt] = useState<{ t: number; key: number } | null>(null);
  const [renameSignal, setRenameSignal] = useState(0);

  const refreshSecrets = useCallback(() => void minute.secrets.status().then(setSecrets), []);
  useEffect(refreshSecrets, [refreshSecrets, showSettings, settings]);

  // Classe de plateforme + couleur d'accent du système
  useEffect(() => {
    if (!info) return;
    const html = document.documentElement;
    html.classList.add(info.platform === 'darwin' ? 'mac' : info.platform === 'win32' ? 'win' : 'linux');
    html.classList.toggle('material', info.material);
    html.style.setProperty('--accent', info.accent);
  }, [info]);
  useEffect(() => {
    if (!settings) return;
    if (settings.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une réunion qui démarre (raccourci, menu) s'affiche d'elle-même.
  useEffect(() => {
    if (live?.meetingId && live.status === 'starting') {
      setSelected(live.meetingId);
      setQuery('');
    }
  }, [live?.meetingId, live?.status]);
  useEffect(
    () =>
      minute.on('navigate', (t) => {
        if (t.meetingId) {
          setSelected(t.meetingId);
          setQuery('');
        }
        if (t.view === 'settings') setShowSettings(true);
        if (t.view === 'new') {
          setSelected(null);
          setQuery('');
        }
        if (t.view === 'search') document.getElementById('global-search')?.focus();
      }),
    [],
  );

  // Raccourcis internes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      }
      if (mod && e.key.toLowerCase() === 'n' && !live?.meetingId) {
        e.preventDefault();
        setSelected(null);
        setQuery('');
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live?.meetingId]);

  // si la réunion affichée disparaît (corbeille), retour à l'accueil
  useEffect(() => {
    if (selected && meetings.length && !meetings.some((m) => m.id === selected) && live?.meetingId !== selected) setSelected(null);
  }, [meetings, selected, live?.meetingId]);

  if (!info || !settings || !secrets) return null;
  const hasAi = secrets.groq || secrets.anthropic || secrets.gemini || secrets.openai;

  if (!settings.onboarded) {
    return <Onboarding settings={settings} update={update} info={info} onDone={refreshSecrets} />;
  }

  const open = (id: string, t?: number) => {
    setSelected(id);
    setQuery('');
    setFocusAt(t !== undefined ? { t, key: Date.now() } : null);
  };

  return (
    <div className="app">
      <Sidebar
        meetings={meetings}
        selected={query ? null : selected}
        live={live}
        query={query}
        onQuery={setQuery}
        onSelect={(id) => open(id)}
        onNew={() => {
          setSelected(null);
          setQuery('');
        }}
        onSettings={() => setShowSettings(true)}
        onRename={(id) => {
          open(id);
          setRenameSignal(Date.now());
        }}
      />
      {query.trim().length >= 2 ? (
        <SearchResults query={query} onOpen={open} />
      ) : selected ? (
        <MeetingView
          key={selected}
          id={selected}
          live={live}
          settings={settings}
          info={info}
          hasAi={hasAi}
          focusAt={focusAt}
          renameSignal={renameSignal}
          onDeleted={() => setSelected(null)}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <StartView
          settings={settings}
          update={update}
          info={info}
          hasGroq={secrets.groq}
          onStarted={(id) => setSelected(id)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      {showSettings && <SettingsSheet settings={settings} update={update} info={info} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
