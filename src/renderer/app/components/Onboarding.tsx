import { Import, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo, NativelyInfo, Settings } from '../../../shared/types';
import { t } from '../../../shared/i18n';
import { minute } from '../api';
import { ListenCard } from './ListenCard';
import { KeyField } from './SettingsSheet';
import { AppIcon, useToast } from './ui';

type Step = 'key' | 'audio' | 'import';

/** Premier lancement : la clé Groq, puis ce que Minute écoute (et l'import Natively s'il y a un historique). */
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
  const [step, setStep] = useState<Step>('key');
  const [groqOk, setGroqOk] = useState(false);
  const [natively, setNatively] = useState<NativelyInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void minute.secrets.status().then((s) => setGroqOk(s.groq));
    void minute.natively.detect().then(setNatively);
  }, []);

  const hasNatively = !!natively?.found && natively.meetings > natively.alreadyImported;
  const steps: Step[] = hasNatively ? ['key', 'audio', 'import'] : ['key', 'audio'];
  const finish = async () => {
    await update({ onboarded: true });
    onDone();
  };
  const importAll = async () => {
    setImporting(true);
    try {
      const r = await minute.natively.importAll();
      toast(r.imported > 1 ? t('{n} réunions importées', { n: r.imported }) : t('{n} réunion importée', { n: r.imported }), 'success');
      await finish();
    } catch (e) {
      toast(t('Import impossible : {error}', { error: (e as Error).message }), 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="onboarding drag">
      <div className="onb-card no-drag" key={step}>
        <div className="steps" aria-hidden>
          {steps.map((s) => (
            <i key={s} className={s === step ? 'on' : ''} />
          ))}
        </div>

        {step === 'key' && (
          <>
            <AppIcon size={96} />
            <h1>{t('Bienvenue dans Minute')}</h1>
            <p>{t('Vos réunions transcrites en direct : ce que vous dites et ce que disent les autres.')}</p>
            <div className="card onb-key">
              <b>{t('Votre clé Groq')}</b>
              <KeyField name="groq" onSaved={(ok) => setGroqOk(ok)} />
              <span className="faint">
                {t('Gratuite, elle reste chiffrée sur cet ordinateur.')}{' '}
                <a href="#" onClick={() => void minute.windows.openExternal('https://console.groq.com/keys')}>
                  {t('Créer une clé')}
                </a>
              </span>
            </div>
            <div className="onb-actions">
              <button className="btn ghost large" onClick={() => setStep('audio')}>
                {t('Plus tard')}
              </button>
              <button className="btn primary large" onClick={() => setStep('audio')} disabled={!groqOk}>
                {t('Continuer')}
              </button>
            </div>
          </>
        )}

        {step === 'audio' && (
          <>
            <h1>{t('Ce que Minute écoute')}</h1>
            <p>{t('Parlez : la barre du micro doit bouger.')}</p>
            <ListenCard settings={settings} update={update} listening />
            {info.platform === 'darwin' && (
              <p className="onb-note">{t('Au premier enregistrement, macOS demande l’accès au micro et à l’audio système : autorisez les deux.')}</p>
            )}
            <div className="onb-actions">
              {hasNatively ? (
                <button className="btn primary large" onClick={() => setStep('import')}>
                  {t('Continuer')}
                </button>
              ) : (
                <button className="btn primary large" onClick={() => void finish()}>
                  {t('Commencer')}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'import' && hasNatively && (
          <>
            <h1>{t('Reprendre votre historique')}</h1>
            <p>
              {natively!.meetings > 1
                ? t('{n} réunions Natively trouvées sur cet ordinateur.', { n: natively!.meetings })
                : t('{n} réunion Natively trouvée sur cet ordinateur.', { n: natively!.meetings })}{' '}
              {t('Minute peut reprendre transcriptions et comptes-rendus, sans rien modifier dans Natively.')}
            </p>
            <div className="onb-actions">
              <button className="btn ghost large" onClick={() => void finish()}>
                {t('Pas maintenant')}
              </button>
              <button className="btn primary large" disabled={importing} onClick={() => void importAll()}>
                {importing ? <Loader2 className="spin" /> : <Import />} {t('Importer')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
