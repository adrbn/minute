import { AlertTriangle, CalendarDays, KeyRound, Link2, Mic, MonitorSpeaker, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo, CalendarEvent, CalendarState, Settings } from '../../../shared/types';
import { minute, shortcutLabel } from '../api';
import type { SettingsSection } from './SettingsSheet';
import { Switch, useAudioInputs, useMicPreview, useToast } from './ui';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(today)) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s[0].toUpperCase() + s.slice(1);
}

export function StartView({
  settings,
  update,
  info,
  hasGroq,
  onStarted,
  onOpenSettings,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  info: AppInfo;
  hasGroq: boolean;
  onStarted: (id: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState<CalendarState | null>(null);
  const toast = useToast();
  const devices = useAudioInputs();
  const level = useMicPreview(settings.micDeviceId, !busy);

  useEffect(() => {
    void minute.calendar.state().then(setCal);
    return minute.on('calendar', setCal);
  }, []);

  const start = async (event?: CalendarEvent) => {
    setBusy(true);
    const r = await minute.recorder.start(event ? { eventId: event.id } : undefined);
    setBusy(false);
    if (!r.ok) return toast(r.error ?? 'Impossible de démarrer', 'error');
    const st = await minute.recorder.state();
    if (st.meetingId) onStarted(st.meetingId);
  };

  const now = Date.now();
  const upcoming = (cal?.events ?? []).filter((e) => e.end > now).slice(0, 5);
  const current = upcoming.find((e) => e.start - 10 * 60_000 <= now && now < e.end);
  const micName = devices.find((d) => d.deviceId === settings.micDeviceId)?.label || 'Micro par défaut';

  return (
    <div className="content">
      <div className="titlebar drag" />
      <div className="start">
        {!hasGroq && (
          <button className="callout warn" onClick={() => onOpenSettings('transcription')}>
            <KeyRound />
            <span>Ajoutez votre clé Groq pour activer la transcription</span>
          </button>
        )}

        <button className="rec-button" onClick={() => void start(current)} disabled={busy || !hasGroq} aria-label="Démarrer la transcription">
          <i />
        </button>
        <div className="start-title">
          <h1>{current ? current.title : 'Prêt à écouter'}</h1>
          <p className="faint">
            {current
              ? `${hhmm(current.start)} – ${hhmm(current.end)}${current.attendees.length ? ` · ${current.attendees.length} participants` : ''}`
              : `ou ${shortcutLabel(settings.shortcuts.toggleRecord, info.platform)} depuis n’importe quelle application`}
          </p>
        </div>

        <div className="sources">
          <label className="source-pill" title="Micro (votre voix)">
            <Mic />
            <select value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })} aria-label="Micro">
              <option value="">Micro par défaut</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Micro'}
                </option>
              ))}
            </select>
            {level < 0 ? (
              <button className="source-alert" onClick={() => void minute.windows.openPrivacySettings('microphone')} title="Micro inaccessible — ouvrir les autorisations">
                <AlertTriangle />
              </button>
            ) : (
              <span className="mini-level" aria-hidden title={micName}>
                <i style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
              </span>
            )}
          </label>
          <label className="source-pill" title="La voix des autres participants (Teams, Meet, Zoom…)">
            <MonitorSpeaker />
            <span>Son de l’ordinateur</span>
            <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
          </label>
        </div>

        <div className="agenda">
          {upcoming.length ? (
            upcoming.map((ev, i) => {
              const showDay = i === 0 || dayLabel(ev.start) !== dayLabel(upcoming[i - 1].start);
              const live = ev.start - 10 * 60_000 <= now && now < ev.end;
              return (
                <div key={ev.id}>
                  {showDay && <div className="agenda-day">{dayLabel(ev.start)}</div>}
                  <div className={`agenda-row ${live ? 'live' : ''}`}>
                    <span className="agenda-time">{hhmm(ev.start)}</span>
                    <div className="agenda-main">
                      <span className="agenda-title">{ev.title}</span>
                      <span className="agenda-meta">
                        {!!ev.attendees.length && (
                          <span title={ev.attendees.join(', ')}>
                            <Users /> {ev.attendees.slice(0, 3).join(', ')}
                            {ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ''}
                          </span>
                        )}
                        {ev.link && (
                          <a href="#" onClick={() => void minute.windows.openExternal(ev.link!)} title="Rejoindre la visio">
                            <Link2 /> Rejoindre
                          </a>
                        )}
                      </span>
                    </div>
                    <button className={`btn small ${live ? 'primary' : ''}`} onClick={() => void start(ev)} disabled={busy || !hasGroq}>
                      Transcrire
                    </button>
                  </div>
                </div>
              );
            })
          ) : settings.calendars.length ? (
            <p className="faint agenda-empty">Aucune réunion prévue dans les prochains jours.</p>
          ) : (
            <button className="link-btn" onClick={() => onOpenSettings('calendar')}>
              <CalendarDays /> Connecter votre agenda pour retrouver vos réunions ici
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
