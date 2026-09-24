import { AlertTriangle, KeyRound, Mic, MonitorSpeaker } from 'lucide-react';
import { useState } from 'react';
import type { AppInfo, Settings } from '../../../shared/types';
import { minute, shortcutLabel } from '../api';
import { Switch, useAudioInputs, useMicPreview, useToast } from './ui';

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
  onOpenSettings: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const devices = useAudioInputs();
  const level = useMicPreview(settings.micDeviceId, !busy);
  const sc = settings.shortcuts;
  const p = info.platform;

  const start = async () => {
    setBusy(true);
    const r = await minute.recorder.start({ title });
    setBusy(false);
    if (!r.ok) {
      toast(r.error ?? 'Impossible de démarrer', 'error');
      return;
    }
    const st = await minute.recorder.state();
    if (st.meetingId) onStarted(st.meetingId);
  };

  return (
    <div className="content">
      <div className="titlebar drag" />
      <div className="start">
        <h1>Prêt à écouter</h1>
        <p className="lead">
          Minute transcrit en direct ce que vous dites et ce que disent les autres. Copiez, cherchez, résumez à tout moment —
          sans attendre la fin.
        </p>

        {!hasGroq && (
          <div className="callout warn">
            <KeyRound />
            <span style={{ flex: 1 }}>Ajoutez votre clé Groq (gratuite) pour activer la transcription.</span>
            <button className="btn small primary" onClick={onOpenSettings}>
              Ajouter
            </button>
          </div>
        )}

        <button className="rec-button" onClick={start} disabled={busy || !hasGroq} aria-label="Démarrer l’enregistrement">
          <i />
        </button>

        <input
          className="field"
          style={{ width: 'min(560px, 100%)', textAlign: 'center', height: 36 }}
          placeholder="Titre de la réunion (facultatif — Minute le trouvera tout seul)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hasGroq && void start()}
        />

        <div className="sources">
          <div className="card source">
            <div className="head">
              <Mic /> Votre micro <span className="faint" style={{ marginLeft: 'auto' }}>« {settings.meName || 'Moi'} »</span>
            </div>
            <select className="field" value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
              <option value="">Micro par défaut du système</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Micro'}
                </option>
              ))}
            </select>
            {level < 0 ? (
              <div className="row faint" style={{ color: 'var(--red)' }}>
                <AlertTriangle size={13} /> Micro inaccessible —
                <a href="#" onClick={() => void minute.windows.openPrivacySettings('microphone')}>
                  vérifier les autorisations
                </a>
              </div>
            ) : (
              <div className="level" title="Parlez pour tester">
                <i style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="card source">
            <div className="head">
              <MonitorSpeaker /> Son de l’ordinateur
              <span style={{ marginLeft: 'auto' }}>
                <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
              </span>
            </div>
            <div className="faint">
              {settings.captureSystem
                ? `Les voix de Teams, Meet, Zoom… apparaissent comme « ${settings.themName || 'Eux'} ».`
                : 'Désactivé : seul votre micro est transcrit (réunion en présentiel).'}
            </div>
            {p === 'darwin' && settings.captureSystem && (
              <div className="faint">macOS demandera l’autorisation « Enregistrement audio du système » la première fois.</div>
            )}
          </div>
        </div>

        <div className="shortcut-hints">
          <span>
            <kbd>{shortcutLabel(sc.toggleRecord, p)}</kbd> démarrer / arrêter
          </span>
          <span>
            <kbd>{shortcutLabel(sc.copy, p)}</kbd> copier la transcription
          </span>
          <span>
            <kbd>{shortcutLabel(sc.bookmark, p)}</kbd> marquer un moment
          </span>
          <span>
            <kbd>{shortcutLabel(sc.mini, p)}</kbd> mini-fenêtre
          </span>
        </div>
      </div>
    </div>
  );
}
