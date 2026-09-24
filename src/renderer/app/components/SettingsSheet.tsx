import { ExternalLink, FolderOpen, Import, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo, LlmProvider, NativelyInfo, SecretName, Settings, Shortcuts } from '../../../shared/types';
import { minute, shortcutLabel } from '../api';
import { Switch, useAudioInputs, useToast } from './ui';

const PROVIDERS: { id: LlmProvider; label: string; hint: string; url: string }[] = [
  { id: 'groq', label: 'Groq', hint: 'Même clé que la transcription — gratuit, rapide.', url: 'https://console.groq.com/keys' },
  { id: 'anthropic', label: 'Claude', hint: 'Excellente qualité rédactionnelle en français.', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Gemini', hint: 'Très long contexte, offre gratuite généreuse.', url: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI', hint: 'Modèles GPT.', url: 'https://platform.openai.com/api-keys' },
];

export function KeyField({ name, onSaved }: { name: SecretName; onSaved?: (ok: boolean) => void }) {
  const [value, setValue] = useState('');
  const [has, setHas] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; msg?: string }>({});
  useEffect(() => {
    void minute.secrets.status().then((s) => setHas(s[name]));
    setValue('');
    setState({});
  }, [name]);
  const save = async () => {
    if (!value.trim()) return;
    setState({ busy: true });
    await minute.secrets.set(name, value.trim());
    const r = await minute.secrets.test(name);
    setState({ ok: r.ok, msg: r.message });
    setHas(true);
    if (r.ok) setValue('');
    onSaved?.(r.ok);
  };
  const test = async () => {
    setState({ busy: true });
    const r = await minute.secrets.test(name);
    setState({ ok: r.ok, msg: r.message });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div className="row">
        <input
          className="field"
          type="password"
          placeholder={has ? '•••••••••••• (clé enregistrée — collez-en une autre pour la remplacer)' : 'Collez votre clé ici'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        {value.trim() ? (
          <button className="btn primary" onClick={() => void save()} disabled={state.busy}>
            Enregistrer
          </button>
        ) : (
          has && (
            <button className="btn" onClick={() => void test()} disabled={state.busy}>
              Tester
            </button>
          )
        )}
      </div>
      {state.busy && (
        <span className="test-msg faint">
          <Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> Vérification…
        </span>
      )}
      {!state.busy && state.msg && <span className={`test-msg ${state.ok ? 'ok' : 'ko'}`}>{state.ok ? '✓ ' : '✕ '}{state.msg}</span>}
    </div>
  );
}

function ShortcutInput({ value, platform, onChange }: { value: string; platform: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  return (
    <button
      className={`field shortcut-input ${rec ? 'focus' : ''}`}
      style={rec ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' } : undefined}
      onClick={() => setRec(true)}
      onBlur={() => setRec(false)}
      onKeyDown={(e) => {
        if (!rec) return;
        e.preventDefault();
        if (e.key === 'Escape') return setRec(false);
        if (e.key === 'Backspace') {
          onChange('');
          return setRec(false);
        }
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean);
        if (mods.length < 2) return; // raccourci global : au moins deux touches de modification
        const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
        onChange([...mods, key].join('+'));
        setRec(false);
      }}
    >
      {rec ? 'Appuyez sur la combinaison…' : shortcutLabel(value, platform) || 'Aucun'}
    </button>
  );
}

export function SettingsSheet({
  settings,
  update,
  info,
  onClose,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  info: AppInfo;
  onClose: () => void;
}) {
  const toast = useToast();
  const devices = useAudioInputs();
  const [models, setModels] = useState<string[]>([]);
  const [natively, setNatively] = useState<NativelyInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [freshInfo, setFreshInfo] = useState(info);
  const provider = PROVIDERS.find((p) => p.id === settings.llmProvider) ?? PROVIDERS[0];

  useEffect(() => {
    void minute.natively.detect().then(setNatively);
  }, []);
  useEffect(() => {
    setModels([]);
    void minute.secrets.listModels(settings.llmProvider).then(setModels);
  }, [settings.llmProvider]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const setShortcut = async (k: keyof Shortcuts, v: string) => {
    await update({ shortcuts: { ...settings.shortcuts, [k]: v } });
    setFreshInfo(await minute.info());
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const r = await minute.natively.importAll();
      toast(`${r.imported} réunion${r.imported > 1 ? 's' : ''} importée${r.imported > 1 ? 's' : ''} depuis Natively`, 'success');
      setNatively(await minute.natively.detect());
    } catch (e) {
      toast(`Import impossible : ${(e as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const model = settings.llmModels[settings.llmProvider];

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Réglages">
        <div className="sheet-head">
          <h2>Réglages</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </div>
        <div className="sheet-body">
          <section className="group">
            <h3>Transcription</h3>
            <div className="card">
              <div className="setting col">
                <div className="label">
                  Clé Groq
                  <div className="d">
                    Le moteur Whisper large-v3 turbo, via Groq : rapide, excellent en français, gratuit jusqu’à ~2 h d’audio par heure.{' '}
                    <a href="#" onClick={() => void minute.windows.openExternal('https://console.groq.com/keys')}>
                      Obtenir une clé <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
                <KeyField name="groq" />
              </div>
              <div className="setting">
                <div className="label">Langue des réunions</div>
                <div className="ctl">
                  <select className="field" value={settings.language} onChange={(e) => void update({ language: e.target.value })}>
                    <option value="fr">Français</option>
                    <option value="auto">Détection automatique</option>
                    <option value="it">Italiano</option>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Modèle
                  <div className="d">Turbo suffit presque toujours ; Large v3 est un peu plus précis et plus lent.</div>
                </div>
                <div className="ctl">
                  <select className="field" value={settings.sttModel} onChange={(e) => void update({ sttModel: e.target.value })}>
                    <option value="whisper-large-v3-turbo">Whisper large-v3 turbo</option>
                    <option value="whisper-large-v3">Whisper large-v3</option>
                  </select>
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Aperçu instantané
                  <div className="d">Affiche le texte pendant que la personne parle encore (utilise un peu plus de quota Groq).</div>
                </div>
                <Switch on={settings.livePreview} onChange={(v) => void update({ livePreview: v })} />
              </div>
              <div className="setting col">
                <div className="label">
                  Vocabulaire
                  <div className="d">Noms propres, sigles, jargon : Minute les écrira correctement. Un par ligne ou séparés par des virgules.</div>
                </div>
                <textarea
                  className="field"
                  rows={3}
                  placeholder={'Institut français, DELF, DALF, Campus France…'}
                  defaultValue={settings.vocabulary}
                  onBlur={(e) => void update({ vocabulary: e.target.value })}
                />
              </div>
            </div>
          </section>

          <section className="group">
            <h3>Voix et audio</h3>
            <div className="card">
              <div className="setting">
                <div className="label">Votre nom dans les transcriptions</div>
                <div className="ctl">
                  <input className="field" defaultValue={settings.meName} onBlur={(e) => void update({ meName: e.target.value.trim() || 'Moi' })} />
                </div>
              </div>
              <div className="setting">
                <div className="label">Les autres participants</div>
                <div className="ctl">
                  <input className="field" defaultValue={settings.themName} onBlur={(e) => void update({ themName: e.target.value.trim() || 'Eux' })} />
                </div>
              </div>
              <div className="setting">
                <div className="label">Micro</div>
                <div className="ctl">
                  <select className="field" value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
                    <option value="">Micro par défaut du système</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Micro'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Capter le son de l’ordinateur
                  <div className="d">Indispensable pour les visios (Teams, Meet, Zoom…).</div>
                </div>
                <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
              </div>
              <div className="setting">
                <div className="label">
                  Conserver l’audio
                  <div className="d">Permet de réécouter chaque phrase en cliquant sur son horodatage.</div>
                </div>
                <div className="ctl">
                  <select className="field" value={settings.keepAudioDays} onChange={(e) => void update({ keepAudioDays: Number(e.target.value) })}>
                    <option value={0}>Jamais</option>
                    <option value={7}>7 jours</option>
                    <option value={30}>30 jours</option>
                    <option value={90}>90 jours</option>
                    <option value={-1}>Toujours</option>
                  </select>
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Proposer d’arrêter après un silence
                  <div className="d">Pour ne jamais oublier un enregistrement qui tourne.</div>
                </div>
                <div className="ctl">
                  <select className="field" value={settings.autoStopMinutes} onChange={(e) => void update({ autoStopMinutes: Number(e.target.value) })}>
                    <option value={0}>Jamais</option>
                    <option value={2}>2 min</option>
                    <option value={4}>4 min</option>
                    <option value={8}>8 min</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="group">
            <h3>Intelligence</h3>
            <div className="card">
              <div className="setting col">
                <div className="label">
                  Fournisseur
                  <div className="d">{provider.hint}</div>
                </div>
                <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                  {PROVIDERS.map((p) => (
                    <button key={p.id} className={settings.llmProvider === p.id ? 'active' : ''} onClick={() => void update({ llmProvider: p.id })}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {settings.llmProvider !== 'groq' && (
                <div className="setting col">
                  <div className="label">
                    Clé {provider.label}{' '}
                    <a href="#" className="d" onClick={() => void minute.windows.openExternal(provider.url)}>
                      Obtenir une clé <ExternalLink size={11} />
                    </a>
                  </div>
                  <KeyField name={settings.llmProvider} onSaved={() => void minute.secrets.listModels(settings.llmProvider).then(setModels)} />
                </div>
              )}
              <div className="setting">
                <div className="label">Modèle</div>
                <div className="ctl" style={{ minWidth: 260 }}>
                  {models.length ? (
                    <select
                      className="field"
                      value={models.includes(model) ? model : ''}
                      onChange={(e) => void update({ llmModels: { ...settings.llmModels, [settings.llmProvider]: e.target.value } })}
                    >
                      {!models.includes(model) && <option value="">{model} (par défaut)</option>}
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field"
                      defaultValue={model}
                      key={settings.llmProvider}
                      onBlur={(e) => void update({ llmModels: { ...settings.llmModels, [settings.llmProvider]: e.target.value.trim() } })}
                    />
                  )}
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Compte-rendu automatique
                  <div className="d">Rédigé dès la fin de la réunion, avec titre, décisions et actions.</div>
                </div>
                <Switch on={settings.autoSummary} onChange={(v) => void update({ autoSummary: v })} />
              </div>
            </div>
          </section>

          <section className="group">
            <h3>Mini-fenêtre et raccourcis</h3>
            <div className="card">
              <div className="setting">
                <div className="label">
                  Invisible dans les partages d’écran
                  <div className="d">La mini-fenêtre n’apparaît pas quand vous partagez votre écran en visio.</div>
                </div>
                <Switch on={settings.miniHiddenFromCapture} onChange={(v) => void update({ miniHiddenFromCapture: v })} />
              </div>
              <div className="setting">
                <div className="label">Ouvrir la mini-fenêtre au démarrage d’une réunion</div>
                <Switch on={settings.miniOnStart} onChange={(v) => void update({ miniOnStart: v })} />
              </div>
              <div className="setting">
                <div className="label">Copier avec l’horodatage</div>
                <Switch on={settings.copyWithTimestamps} onChange={(v) => void update({ copyWithTimestamps: v })} />
              </div>
              {(
                [
                  ['toggleRecord', 'Démarrer / arrêter'],
                  ['copy', 'Copier la transcription'],
                  ['bookmark', 'Marquer un moment'],
                  ['mini', 'Afficher la mini-fenêtre'],
                ] as [keyof Shortcuts, string][]
              ).map(([k, label]) => (
                <div className="setting" key={k}>
                  <div className="label">
                    {label}
                    {freshInfo.shortcutErrors.includes(settings.shortcuts[k]) && (
                      <div className="d" style={{ color: 'var(--red)' }}>
                        Déjà utilisé par une autre application — choisissez-en un autre.
                      </div>
                    )}
                  </div>
                  <ShortcutInput value={settings.shortcuts[k]} platform={info.platform} onChange={(v) => void setShortcut(k, v)} />
                </div>
              ))}
            </div>
          </section>

          <section className="group">
            <h3>Données</h3>
            <div className="card">
              <div className="setting">
                <div className="label">
                  Dossier des réunions
                  <div className="d" style={{ wordBreak: 'break-all' }}>
                    {settings.storageDir}
                  </div>
                </div>
                <div className="ctl">
                  <button
                    className="btn small"
                    onClick={async () => {
                      const dir = await minute.settings.chooseStorageDir();
                      if (dir) await update({ storageDir: dir });
                    }}
                  >
                    <FolderOpen /> Changer…
                  </button>
                </div>
              </div>
              <div className="setting">
                <div className="label">
                  Historique Natively
                  <div className="d">
                    {natively === null
                      ? 'Recherche…'
                      : !natively.found
                        ? 'Aucune base Natively trouvée sur cet ordinateur.'
                        : `${natively.meetings} réunion${natively.meetings > 1 ? 's' : ''} trouvée${natively.meetings > 1 ? 's' : ''}${
                            natively.alreadyImported ? `, dont ${natively.alreadyImported} déjà importée${natively.alreadyImported > 1 ? 's' : ''}` : ''
                          }. Transcriptions et comptes-rendus sont repris ; Natively n’est pas modifié.`}
                  </div>
                </div>
                <div className="ctl">
                  <button
                    className="btn small"
                    disabled={!natively?.found || importing || natively.meetings === natively.alreadyImported}
                    onClick={() => void runImport()}
                  >
                    {importing ? <Loader2 className="spin" /> : <Import />} Importer
                  </button>
                </div>
              </div>
              <div className="setting">
                <div className="label">Apparence</div>
                <div className="segmented">
                  {(
                    [
                      ['system', 'Auto'],
                      ['light', 'Clair'],
                      ['dark', 'Sombre'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={settings.theme === v ? 'active' : ''} onClick={() => void update({ theme: v })}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <p className="faint" style={{ textAlign: 'center', margin: 0 }}>
            Minute {info.version} · Transcription Groq Whisper · Détection de parole Silero VAD · Vos réunions restent sur cet ordinateur ;
            seul l’audio des phrases est envoyé à Groq pour être transcrit.
          </p>
        </div>
      </div>
    </div>
  );
}
