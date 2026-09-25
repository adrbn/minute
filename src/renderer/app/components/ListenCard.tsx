import { AlertTriangle, Mic, MonitorSpeaker } from 'lucide-react';
import type { Settings } from '../../../shared/types';
import { t } from '../../../shared/i18n';
import { minute } from '../api';
import { Switch, useAudioInputs, useMicPreview } from './ui';

/** Ce que Minute écoute : micro (avec son niveau) et audio système — accueil et premier lancement. */
export function ListenCard({
  settings,
  update,
  listening,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  /** le niveau du micro n'est mesuré que pendant que la carte est utile */
  listening: boolean;
}) {
  const devices = useAudioInputs();
  const level = useMicPreview(settings.micDeviceId, listening);
  const micName = devices.find((d) => d.deviceId === settings.micDeviceId)?.label || t('Périphérique par défaut');

  return (
    <div className="listen-card">
      <label className="listen-row">
        <span className="listen-icon me">
          <Mic />
        </span>
        <span className="listen-text">
          <b>{t('Microphone')}</b>
          <select value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })} aria-label={t('Microphone')}>
            <option value="">{t('Périphérique par défaut')}</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('Microphone')}
              </option>
            ))}
          </select>
        </span>
        {level < 0 ? (
          <button
            className="source-alert"
            onClick={() => void minute.windows.openPrivacySettings('microphone')}
            title={t('Microphone inaccessible — ouvrir les autorisations')}
          >
            <AlertTriangle />
          </button>
        ) : (
          <span className="mini-level" aria-hidden title={micName}>
            <i style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
          </span>
        )}
      </label>
      <label className="listen-row">
        <span className="listen-icon them">
          <MonitorSpeaker />
        </span>
        <span className="listen-text">
          <b>{t('Audio système')}</b>
        </span>
        <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
      </label>
    </div>
  );
}
