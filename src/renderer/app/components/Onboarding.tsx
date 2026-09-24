import { Copy, Headphones, History, Import, Keyboard, Loader2, Mic, MonitorSpeaker, PictureInPicture2, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo, NativelyInfo, Settings } from '../../../shared/types';
import { minute, shortcutLabel } from '../api';
import { KeyField } from './SettingsSheet';
import { Switch, useAudioInputs, useMicPreview, useToast } from './ui';

function Glyph() {
  return (
    <div className="app-glyph">
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="9" y="17" width="4" height="14" rx="2" fill="white" opacity="0.9" />
        <rect x="16" y="11" width="4" height="26" rx="2" fill="white" />
        <rect x="23" y="15" width="4" height="18" rx="2" fill="white" opacity="0.95" />
        <rect x="30" y="20" width="4" height="8" rx="2" fill="white" opacity="0.8" />
        <rect x="37" y="22" width="4" height="4" rx="2" fill="white" opacity="0.65" />
      </svg>
    </div>
  );
}

export function Onboarding({
  settings,
  update,
  info,
  onDone,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  info: AppInfo;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [groqOk, setGroqOk] = useState(false);
  const [natively, setNatively] = useState<NativelyInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const devices = useAudioInputs();
  const level = useMicPreview(settings.micDeviceId, step === 2);
  const sc = settings.shortcuts;
  const p = info.platform;

  useEffect(() => {
    void minute.secrets.status().then((s) => setGroqOk(s.groq));
    void minute.natively.detect().then(setNatively);
  }, []);

  const hasNatively = !!natively?.found && natively.meetings > natively.alreadyImported;
  const steps = hasNatively ? 5 : 4;
  const next = () => setStep((s) => s + 1);
  const finish = async () => {
    await update({ onboarded: true });
    onDone();
  };

  return (
    <div className="onboarding drag">
      <div className="onb-card no-drag">
        <div className="steps">
          {Array.from({ length: steps }, (_, i) => (
            <i key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <>
            <Glyph />
            <h1>Bienvenue dans Minute</h1>
            <p>Vos réunions, transcrites en direct. Ce que vous dites, ce que disent les autres — lisible, copiable et consultable pendant la réunion.</p>
            <div className="features">
              <div className="feature">
                <Copy />
                <div>
                  <b>Copiez à tout moment</b>
                  <span>Sans attendre la fin, même depuis une autre app.</span>
                </div>
              </div>
              <div className="feature">
                <History />
                <div>
                  <b>Vous avez décroché ?</b>
                  <span>Un rattrapage des dernières minutes en un clic.</span>
                </div>
              </div>
              <div className="feature">
                <Sparkles />
                <div>
                  <b>Compte-rendu automatique</b>
                  <span>Décisions, actions, e-mail de suivi.</span>
                </div>
              </div>
              <div className="feature">
                <ShieldCheck />
                <div>
                  <b>Rien ne se perd</b>
                  <span>Chaque phrase est enregistrée dès qu’elle est dite.</span>
                </div>
              </div>
            </div>
            <button className="btn primary large" onClick={next}>
              Commencer
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Le moteur de transcription</h1>
            <p>
              Minute utilise Whisper via Groq — le même moteur que vous utilisiez dans Natively. La clé est gratuite et reste chiffrée sur cet
              ordinateur.
            </p>
            <div className="card">
              <KeyField name="groq" onSaved={(ok) => setGroqOk(ok)} />
              <div className="faint" style={{ marginTop: 8 }}>
                Pas encore de clé ?{' '}
                <a href="#" onClick={() => void minute.windows.openExternal('https://console.groq.com/keys')}>
                  console.groq.com/keys
                </a>{' '}
                → « Create API Key ».
              </div>
            </div>
            <div className="row">
              <button className="btn ghost" onClick={next}>
                Plus tard
              </button>
              <button className="btn primary large" onClick={next} disabled={!groqOk}>
                Continuer
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Deux voix, deux sources</h1>
            <p>Votre micro devient « {settings.meName || 'Moi'} », le son de l’ordinateur (Teams, Meet, Zoom…) devient « {settings.themName && settings.themName !== 'Eux' ? settings.themName : 'Participants'} » — et chaque voix reconnue, « Participant A, B, C… ».</p>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="row">
                <Mic size={16} />
                <b style={{ flex: 1 }}>Micro</b>
                <select className="field" style={{ maxWidth: 300 }} value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
                  <option value="">Micro par défaut</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Micro'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="source">
                {level < 0 ? (
                  <span className="faint" style={{ color: 'var(--red)' }}>
                    Micro inaccessible —{' '}
                    <a href="#" onClick={() => void minute.windows.openPrivacySettings('microphone')}>
                      ouvrir les autorisations
                    </a>
                  </span>
                ) : (
                  <>
                    <div className="level">
                      <i style={{ width: `${Math.round(level * 100)}%` }} />
                    </div>
                    <span className="faint">Dites quelques mots : la barre doit bouger.</span>
                  </>
                )}
              </div>
              <div className="row">
                <MonitorSpeaker size={16} />
                <b style={{ flex: 1 }}>Son de l’ordinateur</b>
                <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
              </div>
              {p === 'darwin' && (
                <div className="faint">
                  Au premier enregistrement, macOS demandera l’accès au micro et à « l’enregistrement audio du système » : acceptez les deux.
                </div>
              )}
              <div className="row faint">
                <Headphones size={14} /> Avec un casque, la séparation des voix est parfaite ; sans casque, Minute retire les doublons automatiquement.
              </div>
            </div>
            <button className="btn primary large" onClick={next}>
              Continuer
            </button>
          </>
        )}

        {step === 3 && hasNatively && (
          <>
            <h1>Reprendre votre historique</h1>
            <p>
              {natively!.meetings} réunion{natively!.meetings > 1 ? 's' : ''} Natively trouvée{natively!.meetings > 1 ? 's' : ''} sur cet ordinateur.
              Minute peut reprendre transcriptions et comptes-rendus, sans rien modifier dans Natively.
            </p>
            <div className="row">
              <button className="btn ghost" onClick={next}>
                Pas maintenant
              </button>
              <button
                className="btn primary large"
                disabled={importing}
                onClick={async () => {
                  setImporting(true);
                  try {
                    const r = await minute.natively.importAll();
                    toast(`${r.imported} réunions importées`, 'success');
                    next();
                  } catch (e) {
                    toast(`Import impossible : ${(e as Error).message}`, 'error');
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? <Loader2 className="spin" /> : <Import />} Importer
              </button>
            </div>
          </>
        )}

        {step === steps - 1 && step >= 3 && (
          <>
            <Glyph />
            <h1>Tout est prêt</h1>
            <p>Quelques raccourcis qui marchent partout, même quand Minute est en arrière-plan :</p>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(
                [
                  [<Mic key="a" size={15} />, 'Démarrer / arrêter une réunion', sc.toggleRecord],
                  [<Copy key="b" size={15} />, 'Copier toute la transcription', sc.copy],
                  [<Star key="c" size={15} />, 'Marquer un moment important', sc.bookmark],
                  [<PictureInPicture2 key="d" size={15} />, 'Mode compact (sous-titres flottants)', sc.mini],
                ] as const
              ).map(([icon, label, accel]) => (
                <div className="row" key={label}>
                  {icon}
                  <span style={{ flex: 1 }}>{label}</span>
                  <kbd>{shortcutLabel(accel, p)}</kbd>
                </div>
              ))}
              <div className="row faint">
                <Keyboard size={14} /> Modifiables dans les Réglages.
              </div>
            </div>
            <button className="btn primary large" onClick={() => void finish()}>
              C’est parti
            </button>
          </>
        )}
      </div>
    </div>
  );
}
