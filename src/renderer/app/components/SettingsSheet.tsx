import {
  AudioLines,
  CalendarDays,
  Database,
  ExternalLink,
  FolderOpen,
  Import,
  Info,
  ShieldCheck,
  Check,
  Copy,
  Keyboard,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  SlidersHorizontal,

  Type,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, CalendarState, LlmProvider, LocalStatus, NativelyInfo, SecretName, Settings, Shortcuts, UpdateState } from '../../../shared/types';
import { minute, relativeTime, shortcutLabel } from '../api';
import { AppGlyph, Switch, useAudioInputs, useToast } from './ui';
import { t } from '../../../shared/i18n';

const PROVIDERS: { id: LlmProvider; label: string; hint: string; url: string }[] = [
  { id: 'groq', label: 'Groq', hint: 'La même clé que la transcription. Gratuit et rapide.', url: 'https://console.groq.com/keys' },
  { id: 'anthropic', label: 'Claude', hint: 'La meilleure qualité rédactionnelle en français.', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Gemini', hint: 'Très long contexte, offre gratuite généreuse.', url: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI', hint: 'Modèles GPT.', url: 'https://platform.openai.com/api-keys' },
];

export type SettingsSection = 'general' | 'transcription' | 'audio' | 'calendar' | 'ai' | 'compact' | 'privacy' | 'data' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Général', icon: <SlidersHorizontal /> },
  { id: 'transcription', label: 'Transcription', icon: <Type /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines /> },
  { id: 'calendar', label: 'Agenda', icon: <CalendarDays /> },
  { id: 'ai', label: 'Intelligence', icon: <Sparkles /> },
  { id: 'compact', label: 'Mode compact', icon: <Keyboard /> },
  { id: 'privacy', label: 'Confidentialité', icon: <ShieldCheck /> },
  { id: 'data', label: 'Données', icon: <Database /> },
  { id: 'about', label: 'À propos', icon: <Info /> },
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
    <div className="stack-6">
      <div className="row">
        <input
          className="field"
          type="password"
          placeholder={has ? t('Clé enregistrée — collez-en une autre pour la remplacer') : t('Collez votre clé')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        {value.trim() ? (
          <button className="btn primary" onClick={() => void save()} disabled={state.busy}>
            {t('Enregistrer')}
          </button>
        ) : (
          has && (
            <button className="btn" onClick={() => void test()} disabled={state.busy}>
              {t('Tester')}
            </button>
          )
        )}
      </div>
      {state.busy && (
        <span className="test-msg faint">
          <Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> {t('Vérification…')}
        </span>
      )}
      {!state.busy && state.msg && <span className={`test-msg ${state.ok ? 'ok' : 'ko'}`}>{state.msg}</span>}
    </div>
  );
}

function ShortcutInput({ value, platform, onChange }: { value: string; platform: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  return (
    <button
      className={`field shortcut-input ${rec ? 'recording' : ''}`}
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
      {rec ? t('Tapez la combinaison…') : shortcutLabel(value, platform) || t('Aucun')}
    </button>
  );
}

/** Thèmes de couleur : [clé, nom, accent, fond] (aperçu des pastilles, en clair). */
const PALETTES: [string, string, string, string][] = [
  ['system', 'Système', 'var(--os-accent, #0a84ff)', '#f5f5f7'],
  ['ifi', 'Institut', '#3558a2', '#f3f5f9'],
  ['ocean', 'Océan', '#0a8aa3', '#f0f6f8'],
  ['foret', 'Forêt', '#2f8a55', '#f2f6f1'],
  ['corail', 'Corail', '#dd5a36', '#faf4f1'],
  ['lavande', 'Lavande', '#7a5cd6', '#f6f4fb'],
  ['graphite', 'Graphite', '#56565e', '#f3f3f4'],
  ['papier', 'Papier', '#94652b', '#f5efe4'],
  ['minuit', 'Minuit', '#2f6fe0', '#eef2f8'],
];

/** Une ligne de réglage : libellé (+ explication) à gauche, contrôle à droite. */
function Row({ label, hint, children, col }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; col?: boolean }) {
  return (
    <div className={`setting ${col ? 'col' : ''}`}>
      <div className="label">
        {label}
        {hint && <div className="d">{hint}</div>}
      </div>
      {children && <div className="ctl">{children}</div>}
    </div>
  );
}

function Group({ title, children, foot }: { title?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="group">
      {title && <h3>{title}</h3>}
      <div className="card">{children}</div>
      {foot && <p className="group-foot">{foot}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ mode confidentiel
const LOCAL_MODELS = [
  { id: 'turbo' as const, name: 'Précis', detail: 'large v3 turbo · 547 Mo' },
  { id: 'small' as const, name: 'Rapide', detail: 'small · 181 Mo, pour un ordinateur modeste' },
];
const mo = (b: number) => t('{n} Mo', { n: Math.round(b / 1048576) });

function Privacy({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; info: AppInfo }) {
  const toast = useToast();
  const [st, setSt] = useState<LocalStatus | null>(null);
  const [llm, setLlm] = useState<{ base: string; model: string } | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void minute.local.status().then(setSt);
    void minute.local.llm().then(setLlm);
    return minute.on('localStatus', setSt);
  }, []);
  if (!st) return null;
  const on = settings.privacyMode;
  const model = settings.localModel;
  const ready = st.engine && st.models[model];
  const err = (e: unknown) => toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  const install = async () => {
    setBusy(true);
    try {
      setSt(await minute.local.install(model));
      toast(t('Moteur local installé'), 'success');
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (v: boolean) => {
    try {
      await update({ privacyMode: v });
      toast(v ? t('Mode confidentiel activé : rien ne sort de cet ordinateur') : t('Mode confidentiel désactivé'), v ? 'success' : 'info');
    } catch (e) {
      err(e);
    }
  };
  const notice = async () => {
    await navigator.clipboard.writeText(await minute.local.notice());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  if (!st.supported)
    return (
      <Group title={t('Mode confidentiel')}>
        <Row label={t('Proposé sous Windows')} hint={t('La transcription locale et le verrou réseau sont disponibles dans la version Windows de Minute.')} />
      </Group>
    );
  const checks: [boolean, string, string][] = [
    [
      on,
      t('Transcription sur cet ordinateur'),
      on
        ? t('whisper.cpp, modèle {model} — l’audio ne quitte pas la machine', { model: t(LOCAL_MODELS.find((m) => m.id === model)?.name ?? '').toLowerCase() })
        : t('Aujourd’hui : Groq (l’audio des phrases part chez Groq)'),
    ],
    [on, t('Connexions vers l’extérieur bloquées'), on ? t('Aucune requête ne quitte l’ordinateur (vérifié à chaque envoi)') : t('Aujourd’hui : transcription, IA et agenda passent par Internet')],
    [on || settings.keepAudioDays === 0, t('Aucun enregistrement audio conservé'), t('L’audio de chaque phrase est effacé dès qu’elle est transcrite')],
    [
      on && settings.retentionDays > 0,
      t('Suppression automatique'),
      on && settings.retentionDays ? t('Réunions effacées définitivement après {n} jours (sauf épinglées)', { n: settings.retentionDays }) : t('Aucune durée de conservation'),
    ],
  ];
  return (
    <>
      <div className={`privacy-hero ${on ? 'on' : ''}`}>
        <ShieldCheck size={30} />
        <div>
          <b>{t('Mode confidentiel')}</b>
          <p>{t('Pour les réunions sensibles (RH, diplomatie, données personnelles) : tout reste sur cet ordinateur, conformément au principe de minimisation du RGPD.')}</p>
        </div>
        <Switch on={on} onChange={(v) => void toggle(v)} disabled={!ready && !on} />
      </div>

      {!ready && (
        <Group title={t('1 · Installer la transcription locale')} foot={t('Une seule fois, avant d’activer le mode : ensuite, plus aucune connexion n’est nécessaire.')}>
          <Row label={t('Modèle')} col>
            <div className="segmented wide">
              {LOCAL_MODELS.map((m) => (
                <button key={m.id} className={model === m.id ? 'active' : ''} onClick={() => void update({ localModel: m.id })} disabled={busy}>
                  {t(m.name)} {st.models[m.id] && '✓'}
                </button>
              ))}
            </div>
            <div className="d" style={{ marginTop: 6 }}>
              {t(LOCAL_MODELS.find((m) => m.id === model)?.detail ?? '')}
            </div>
          </Row>
          <Row label={st.download ? t('Téléchargement : {what}', { what: st.download.what }) : t('Moteur whisper.cpp + modèle')} col>
            {st.download ? (
              <div className="progress">
                <div className="progress-line">
                  <span>{st.download.total ? t('{n} %', { n: Math.round((100 * st.download.received) / st.download.total) }) : t('Téléchargement…')}</span>
                  <span className="faint">
                    {st.download.total ? t('{received} sur {total}', { received: mo(st.download.received), total: mo(st.download.total) }) : mo(st.download.received)}
                  </span>
                </div>
                <div className="progress-bar">
                  <i style={{ width: `${st.download.total ? (100 * st.download.received) / st.download.total : 5}%` }} />
                </div>
              </div>
            ) : (
              <button className="btn primary" onClick={() => void install()} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : null} {t('Télécharger (≈ {n} Mo)', { n: model === 'turbo' ? 567 : 201 })}
              </button>
            )}
            {st.error && <span className="test-msg ko">{st.error}</span>}
          </Row>
        </Group>
      )}

      <Group title={on ? t('Ce qui est garanti') : t('Ce que le mode change')}>
        {checks.map(([ok, label, hint]) => (
          <Row
            key={label}
            label={
              <span className="check-row">
                <span className={`check ${ok ? 'ok' : ''}`}>{ok ? <Check size={12} strokeWidth={3} /> : null}</span>
                {label}
              </span>
            }
            hint={hint}
          />
        ))}
        <Row
          label={
            <span className="check-row">
              <span className={`check ${on && llm ? 'ok' : ''}`}>{on && llm ? <Check size={12} strokeWidth={3} /> : null}</span>
              {t('Comptes-rendus par une IA locale')}
            </span>
          }
          hint={
            llm
              ? t('Détectée sur cet ordinateur : {model}', { model: llm.model })
              : t('Aucune IA locale détectée (Ollama ou LM Studio) : en mode confidentiel, pas de compte-rendu automatique — la transcription fonctionne.')
          }
        />
      </Group>

      <Group title={t('Réglages')}>
        <Row label={t('Conserver les réunions')} hint={t('En mode confidentiel, suppression définitive au-delà (les réunions épinglées sont gardées).')}>
          <select className="field" value={settings.retentionDays} onChange={(e) => void update({ retentionDays: Number(e.target.value) })}>
            <option value={7}>{t('{n} jours', { n: 7 })}</option>
            <option value={30}>{t('{n} jours', { n: 30 })}</option>
            <option value={90}>{t('{n} jours', { n: 90 })}</option>
            <option value={365}>{t('1 an')}</option>
            <option value={0}>{t('Sans limite')}</option>
          </select>
        </Row>
        <Row label={t('Informer les participants')} hint={t('Un message prêt à coller dans la conversation de la visio : transparence, et chacun peut s’y opposer.')}>
          <button className="btn" onClick={() => void notice()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copié') : t('Copier le message')}
          </button>
        </Row>
      </Group>
    </>
  );
}

/** Logo GitHub (marque officielle, utilisée pour renvoyer vers GitHub). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Tasse (Ko-fi) : dessin simple, pas le logo de la marque. */
function CupMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z" fill="currentColor" fillOpacity="0.18" />
      <path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M9.2 12.4c.6-1.2 2.6-1.2 2.6.3 0 1.1-1.5 1.8-2.6 2.6-1.1-.8-2.6-1.5-2.6-2.6 0-1.5 2-1.5 2.6-.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const OPEN_SOURCE: [string, string][] = [
  ['Electron', 'MIT'],
  ['React', 'MIT'],
  ['Silero VAD', 'MIT'],
  ['CAM++ (3D-Speaker)', 'Apache-2.0'],
  ['ONNX Runtime Web', 'MIT'],
  ['AudioTee (macOS)', 'MIT'],
  ['Lucide', 'ISC'],
  ['docx', 'MIT'],
];

function UpdatesGroup({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [st, setSt] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void minute.updates.state().then(setSt);
    return minute.on('update', setSt);
  }, []);
  if (!st) return null;
  const line =
    st.status === 'checking'
      ? t('Recherche d’une nouvelle version…')
      : st.status === 'downloading'
        ? t('Téléchargement de la version {v}… {p} %', { v: st.version ?? '', p: st.percent ?? 0 })
        : st.status === 'ready'
          ? t('Version {v} prête : redémarrez pour l’installer.', { v: st.version ?? '' })
          : st.status === 'available'
            ? t('Version {v} disponible.', { v: st.version ?? '' })
            : st.status === 'none'
              ? st.checkedAt
                ? t('Minute est à jour (vérifié {when}).', { when: relativeTime(st.checkedAt) })
                : t('Minute est à jour.')
              : st.status === 'error'
                ? t('Vérification impossible : {error}', { error: st.error ?? '' })
                : st.status === 'disabled'
                  ? (st.reason ?? t('Mises à jour indisponibles'))
                  : t('Pas encore vérifié.');
  return (
    <Group title={t('Mises à jour')}>
      <Row label={t('Version {v}', { v: st.current })} hint={line}>
        {st.status === 'ready' ? (
          <button className="btn primary" onClick={() => void minute.updates.install()}>
            {t('Redémarrer')}
          </button>
        ) : st.status === 'available' && !st.canInstall ? (
          <button className="btn primary" onClick={() => void minute.windows.openExternal(st.url)}>
            {t('Télécharger')}
          </button>
        ) : (
          <button
            className="btn"
            disabled={busy || st.status === 'checking' || st.status === 'downloading' || st.status === 'disabled'}
            onClick={async () => {
              setBusy(true);
              setSt(await minute.updates.check());
              setBusy(false);
            }}
          >
            {busy || st.status === 'checking' ? <Loader2 size={14} className="spin" /> : null} {t('Vérifier maintenant')}
          </button>
        )}
      </Row>
      <Row
        label={t('Mettre à jour automatiquement')}
        hint={st.canInstall ? t('Téléchargée en arrière-plan, installée quand vous le décidez (jamais pendant une réunion).') : t('Vous êtes prévenu quand une nouvelle version sort.')}
      >
        <Switch on={settings.autoUpdate} onChange={(v) => void update({ autoUpdate: v })} />
      </Row>
    </Group>
  );
}

function About({ info, settings, update }: { info: AppInfo; settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const system = info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : 'Linux';
  return (
    <div className="about">
      <div className="about-hero">
        <AppGlyph size={72} />
        <h2>Minute</h2>
        <p className="about-version">
          {t('Version {v}', { v: info.version })} · {system}
        </p>
        <p className="about-tagline">{t('Vos réunions, transcrites en direct — et rien ne vous échappe.')}</p>
      </div>
      <div className="about-links">
        <button className="link-card github" onClick={() => void minute.windows.openExternal('https://github.com/adrbn')}>
          <GitHubMark />
          <span>
            <b>GitHub</b>
            <small>github.com/adrbn</small>
          </span>
          <ExternalLink size={14} className="go" />
        </button>
        <button className="link-card kofi" onClick={() => void minute.windows.openExternal('https://ko-fi.com/adrbn')}>
          <CupMark />
          <span>
            <b>{t('Offrir un café')}</b>
            <small>ko-fi.com/adrbn</small>
          </span>
          <ExternalLink size={14} className="go" />
        </button>
      </div>
      <p className="about-by">{t('Conçu et développé par adrbn · logiciel libre et gratuit (licence MIT).')}</p>
      <UpdatesGroup settings={settings} update={update} />
      <Group title={t('Aide')}>
        <Row label={t('Signaler un problème')} hint={t('Un ticket GitHub pré-rempli, avec le journal technique (sans contenu de réunion).')}>
          <button className="btn" onClick={() => window.dispatchEvent(new Event('minute:report'))}>
            {t('Signaler…')}
          </button>
        </Row>
      </Group>
      <Group title={t('Composants open source')} foot={t('Merci à leurs auteurs. Détails et licences complètes : THIRD_PARTY_NOTICES.md.')}>
        {OPEN_SOURCE.map(([name, lic]) => (
          <Row key={name} label={name}>
            <span className="faint">{lic}</span>
          </Row>
        ))}
      </Group>
    </div>
  );
}

const link = (url: string, label: string) => (
  <a href="#" onClick={() => void minute.windows.openExternal(url)}>
    {label} <ExternalLink size={11} />
  </a>
);

export function SettingsSheet({
  settings,
  update,
  info,
  onClose,
  initial = 'general',
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  info: AppInfo;
  onClose: () => void;
  initial?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initial);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const props = { settings, update, info };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings" role="dialog" aria-label={t('Réglages')}>
        <nav className="settings-nav">
          <div className="settings-nav-title">{t('Réglages')}</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
              {s.icon}
              {t(s.label)}
            </button>
          ))}
          <div className="grow" />
          <div className="faint settings-version">Minute {info.version}</div>
        </nav>
        <div className="settings-pane">
          <div className="sheet-head">
            <h2>{t(SECTIONS.find((s) => s.id === section)?.label ?? '')}</h2>
            <button className="icon-btn" onClick={onClose} aria-label={t('Fermer')}>
              <X />
            </button>
          </div>
          <div className="sheet-body">
            {section === 'general' && <General {...props} />}
            {section === 'transcription' && <Transcription {...props} />}
            {section === 'audio' && <Audio {...props} />}
            {section === 'calendar' && <Calendars {...props} />}
            {section === 'ai' && <Intelligence {...props} />}
            {section === 'compact' && <Compact {...props} />}
            {section === 'privacy' && <Privacy {...props} />}
            {section === 'data' && <Data {...props} />}
            {section === 'about' && <About info={info} settings={settings} update={update} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type P = { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; info: AppInfo };

// ------------------------------------------------------------------ Général
function General({ settings, update }: P) {
  return (
    <>
      <Group>
        <Row label={t('Votre prénom')} hint={t('Affiché pour votre voix, et utilisé pour vous prévenir quand on s’adresse à vous.')}>
          <input className="field" defaultValue={settings.meName === 'Moi' ? '' : settings.meName} placeholder={t('Moi')} onBlur={(e) => void update({ meName: e.target.value.trim() || 'Moi' })} />
        </Row>
        <Row label={t('Les autres participants')} hint={t('Nom par défaut de la voix de l’ordinateur.')}>
          {/* Nom par défaut enregistré en français ('Participants') : affiché traduit en indication, champ vide. */}
          <input
            className="field"
            defaultValue={settings.themName === 'Eux' || settings.themName === 'Participants' ? '' : settings.themName}
            placeholder={t('Participants')}
            onBlur={(e) => void update({ themName: e.target.value.trim() || 'Participants' })}
          />
        </Row>
        <Row label={t('Me prévenir quand on dit mon prénom')} hint={t('Notification « On parle de vous » si Minute n’est pas au premier plan.')}>
          <Switch on={settings.nameAlerts} onChange={(v) => void update({ nameAlerts: v })} />
        </Row>
      </Group>
      <Group>
        <Row label={t('Langue de l’interface')} hint={t('La fenêtre se recharge dans la nouvelle langue.')}>
          <select className="field" value={settings.uiLanguage ?? 'auto'} onChange={(e) => void update({ uiLanguage: e.target.value as Settings['uiLanguage'] })}>
            <option value="auto">{t('Automatique')}</option>
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="it">Italiano</option>
          </select>
        </Row>
        <Row label={t('Apparence')}>
          <div className="segmented">
            {(
              [
                ['system', 'Auto'],
                ['light', 'Clair'],
                ['dark', 'Sombre'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={settings.theme === v ? 'active' : ''} onClick={() => void update({ theme: v })}>
                {t(l)}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t('Thème')} col>
          <div className="swatches" role="radiogroup" aria-label={t('Thème de couleur')}>
            {PALETTES.map(([key, name, accent, bg]) => (
              <button
                key={key}
                role="radio"
                aria-checked={(settings.palette || 'system') === key}
                aria-label={t(name)}
                title={t(name)}
                className={`swatch ${(settings.palette || 'system') === key ? 'active' : ''}`}
                style={{ ['--sw-accent' as string]: accent, ['--sw-bg' as string]: bg }}
                onClick={() => void update({ palette: key })}
              />
            ))}
          </div>
          <div className="swatch-name">{t(PALETTES.find(([k]) => k === (settings.palette || 'system'))?.[1] ?? '')}</div>
        </Row>
        <Row label={t('Copier avec l’horodatage')} hint={t('Ajoute [mm:ss] devant chaque intervention copiée.')}>
          <Switch on={settings.copyWithTimestamps} onChange={(v) => void update({ copyWithTimestamps: v })} />
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Transcription
function Transcription({ settings, update }: P) {
  const [sugg, setSugg] = useState<{ term: string; count: number; meetings: number }[] | null>(null);
  const [vocab, setVocab] = useState(settings.vocabulary);
  useEffect(() => setVocab(settings.vocabulary), [settings.vocabulary]);
  useEffect(() => {
    void minute.vocabulary.suggestions().then(setSugg);
  }, [settings.vocabulary]);
  const addTerms = (terms: string[]) => {
    const list = vocab.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
    for (const term of terms) if (!list.some((v) => v.toLowerCase() === term.toLowerCase())) list.push(term);
    void update({ vocabulary: list.join(', ') });
  };
  return (
    <>
      <Group
        foot={
          <>
            {t('Whisper large-v3 turbo, via Groq : rapide, excellent en français, gratuit jusqu’à environ 2 h d’audio par heure.')}{' '}
            {link('https://console.groq.com/keys', t('Obtenir une clé'))}
          </>
        }
      >
        <Row label={t('Clé {provider}', { provider: 'Groq' })} col>
          <KeyField name="groq" />
        </Row>
      </Group>
      <Group>
        <Row
          label={t('Langue des réunions')}
          hint={
            settings.language === 'auto'
              ? t('Chaque phrase est écrite dans la langue où elle est dite (français, italien, anglais…).')
              : t('Une phrase dite dans une autre langue est traduite dans celle-ci. Réunions multilingues : choisissez « Plusieurs langues ».')
          }
        >
          <select className="field" value={settings.language} onChange={(e) => void update({ language: e.target.value })}>
            <option value="auto">{t('Plusieurs langues (détection)')}</option>
            <option value="fr">{t('Français uniquement')}</option>
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
          </select>
        </Row>
        {settings.language === 'auto' && (
          <Row
            label={t('Langues parlées dans vos réunions')}
            hint={t('Une autre langue détectée est traitée comme un bruit mal compris (Whisper « entend » parfois du coréen dans un souffle). La première est la langue principale.')}
            col
          >
            <div className="lang-chips">
              {(
                [
                  ['fr', 'Français'],
                  ['en', 'English'],
                  ['it', 'Italiano'],
                  ['es', 'Español'],
                  ['de', 'Deutsch'],
                  ['pt', 'Português'],
                  ['nl', 'Nederlands'],
                  ['ar', 'العربية'],
                ] as const
              ).map(([code, name]) => {
                const list = settings.languages?.length ? settings.languages : ['fr', 'en', 'it'];
                const on = list.includes(code);
                return (
                  <button
                    key={code}
                    className={`chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? list.filter((l) => l !== code) : [...list, code];
                      if (next.length) void update({ languages: next });
                    }}
                  >
                    {name}
                    {on && list[0] === code ? ` · ${t('principale')}` : ''}
                  </button>
                );
              })}
            </div>
          </Row>
        )}
        <Row label={t('Modèle')} hint={t('Turbo suffit presque toujours ; Large v3 est un peu plus précis, un peu plus lent.')}>
          <select className="field" value={settings.sttModel} onChange={(e) => void update({ sttModel: e.target.value })}>
            <option value="whisper-large-v3-turbo">Large v3 turbo</option>
            <option value="whisper-large-v3">Large v3</option>
          </select>
        </Row>
        <Row label={t('Texte pendant que l’on parle')} hint={t('Affiche un aperçu avant la fin de la phrase (un peu plus de quota Groq).')}>
          <Switch on={settings.livePreview} onChange={(v) => void update({ livePreview: v })} />
        </Row>
        <Row
          label={
            <>
              {t('Distinguer les intervenants')} <span className="badge-beta">{t('bêta')}</span>
            </>
          }
          hint={t('Reconnaît chaque voix : « Participant A, B, C… », chacun sa couleur, à renommer d’un clic. Calcul fait sur cet ordinateur, rien n’est envoyé.')}
        >
          <Switch on={settings.voices} onChange={(v) => void update({ voices: v })} />
        </Row>
      </Group>
      <Group title={t('Vocabulaire')} foot={t('Les participants de l’agenda s’ajoutent d’eux-mêmes à chaque réunion.')}>
        <Row label={t('Noms propres, sigles, jargon')} hint={t('Minute les écrira correctement. Séparés par des virgules.')} col>
          <textarea className="field" rows={3} value={vocab} onChange={(e) => setVocab(e.target.value)} onBlur={() => void update({ vocabulary: vocab })} />
        </Row>
        {!!sugg?.length && (
          <Row
            label={t('Suggestions')}
            hint={t('Noms et sigles qui reviennent dans vos réunions.')}
            col
          >
            <div className="chips">
              {sugg.map((s) => (
                <button key={s.term} className="chip" onClick={() => addTerms([s.term])} title={t('{count} fois, dans {meetings} réunions', { count: s.count, meetings: s.meetings })}>
                  <Plus /> {s.term}
                </button>
              ))}
              {sugg.length > 1 && (
                <button className="chip strong" onClick={() => addTerms(sugg.map((s) => s.term))}>
                  {t('Tout ajouter')}
                </button>
              )}
            </div>
          </Row>
        )}
        <Row
          label={t('Corrections apprises')}
          hint={settings.learned.length ? t('Réappliquées automatiquement aux nouvelles transcriptions.') : t('Corrigez une phrase d’un double-clic : Minute retiendra la correction.')}
          col={!!settings.learned.length}
        >
          {!!settings.learned.length && (
            <div className="learned">
              {settings.learned
                .slice()
                .reverse()
                .map((l) => (
                  <div key={l.from} className="learned-row">
                    <span className="from">{l.from}</span>
                    <span className="arrow">→</span>
                    <span className="to">{l.to}</span>
                    <button
                      className="icon-btn small"
                      aria-label={t('Oublier')}
                      title={t('Oublier cette correction')}
                      onClick={() => void update({ learned: settings.learned.filter((x) => x.from !== l.from) })}
                    >
                      <X />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Audio
function Audio({ settings, update }: P) {
  const devices = useAudioInputs();
  return (
    <Group>
      <Row label={t('Micro')}>
        <select className="field" value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
          <option value="">{t('Micro par défaut du système')}</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('Micro')}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Son de l’ordinateur')} hint={t('La voix des autres en visio (Teams, Meet, Zoom…).')}>
        <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
      </Row>
      <Row label={t('Garder l’audio')} hint={t('Pour réécouter une phrase en cliquant sur son heure.')}>
        <select className="field" value={settings.keepAudioDays} onChange={(e) => void update({ keepAudioDays: Number(e.target.value) })}>
          <option value={0}>{t('Jamais')}</option>
          <option value={7}>{t('{n} jours', { n: 7 })}</option>
          <option value={30}>{t('{n} jours', { n: 30 })}</option>
          <option value={90}>{t('{n} jours', { n: 90 })}</option>
          <option value={-1}>{t('Toujours')}</option>
        </select>
      </Row>
      <Row label={t('Proposer d’arrêter après un silence')} hint={t('Pour ne jamais laisser tourner un enregistrement oublié.')}>
        <select className="field" value={settings.autoStopMinutes} onChange={(e) => void update({ autoStopMinutes: Number(e.target.value) })}>
          <option value={0}>{t('Jamais')}</option>
          <option value={2}>{t('{n} min', { n: 2 })}</option>
          <option value={4}>{t('{n} min', { n: 4 })}</option>
          <option value={8}>{t('{n} min', { n: 8 })}</option>
        </select>
      </Row>
    </Group>
  );
}

// ------------------------------------------------------------------ Agenda
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .6-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8l3.6-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

function Calendars({ settings, update, info }: P) {
  const toast = useToast();
  const [state, setState] = useState<CalendarState | null>(null);
  const [client, setClient] = useState<{ configured: boolean; builtIn: boolean; id: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [adding, setAdding] = useState<{ name: string; url: string; busy?: boolean; msg?: string; ok?: boolean } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [cid, setCid] = useState('');
  const [csecret, setCsecret] = useState('');
  useEffect(() => {
    void minute.calendar.state().then(setState);
    void minute.calendar.googleClient().then((c) => {
      setClient(c);
      setCid(c.builtIn ? '' : c.id);
    });
    return minute.on('calendar', setState);
  }, []);

  const connectGoogle = async () => {
    setConnecting(true);
    const r = await minute.calendar.connectGoogle();
    setConnecting(false);
    toast(r.message, r.ok ? 'success' : 'error');
  };
  const addIcs = async () => {
    if (!adding?.url.trim()) return;
    setAdding({ ...adding, busy: true, msg: undefined });
    const r = await minute.calendar.test(adding.url.trim());
    if (!r.ok) return setAdding({ ...adding, busy: false, ok: false, msg: r.message });
    await update({ calendars: [...settings.calendars, { kind: 'ics', name: adding.name.trim() || t('Agenda'), url: adding.url.trim() }] });
    toast(r.message, 'success');
    setAdding(null);
  };
  const saveClient = async () => {
    await minute.calendar.setGoogleClient(cid, csecret);
    const c = await minute.calendar.googleClient();
    setClient(c);
    setCsecret('');
    toast(c.configured ? t('Identifiants Google enregistrés') : t('Identifiants retirés'), 'success');
  };

  return (
    <>
      <Group>
        {settings.calendars.map((c) => (
          <Row
            key={c.url}
            label={
              <span className="cal-name">
                {c.kind === 'google' ? <GoogleMark /> : <CalendarDays size={16} />} {c.name}
              </span>
            }
            hint={state?.errors[c.url] ? <span className="ko">{state.errors[c.url]}</span> : state?.lastSync ? t('À jour {when}', { when: relativeTime(state.lastSync) }) : t('Synchronisation…')}
          >
            <button className="btn small ghost" onClick={() => void minute.calendar.disconnect(c.url)}>
              {c.kind === 'google' ? t('Déconnecter') : t('Retirer')}
            </button>
          </Row>
        ))}
        <Row
          label={settings.calendars.some((c) => c.kind === 'google') ? t('Ajouter un autre compte Google') : t('Google Agenda')}
          hint={
            client && !client.configured
              ? t('Il manque les identifiants OAuth de votre organisation (Avancé, plus bas).')
              : t('Votre navigateur s’ouvre sur la page de connexion Google ; l’accès est en lecture seule.')
          }
        >
          <button className="btn google-btn" onClick={() => void connectGoogle()} disabled={connecting || !client?.configured}>
            {connecting ? <Loader2 className="spin" /> : <GoogleMark />} {connecting ? t('En attente du navigateur…') : t('Se connecter avec Google')}
          </button>
        </Row>
        {adding ? (
          <Row label={t('Lien iCal privé')} col>
            <div className="stack-6">
              <input className="field" placeholder={t('Nom (ex. Outlook)')} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
              <div className="row">
                <input
                  className="field"
                  placeholder="https://… .ics"
                  value={adding.url}
                  autoFocus
                  onChange={(e) => setAdding({ ...adding, url: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void addIcs()}
                />
                <button className="btn primary" onClick={() => void addIcs()} disabled={adding.busy || !adding.url.trim()}>
                  {adding.busy ? <Loader2 className="spin" /> : t('Ajouter')}
                </button>
                <button className="btn ghost" onClick={() => setAdding(null)}>
                  {t('Annuler')}
                </button>
              </div>
              {adding.msg && <span className={`test-msg ${adding.ok ? 'ok' : 'ko'}`}>{adding.msg}</span>}
            </div>
          </Row>
        ) : (
          <Row label={t('Autre agenda (Outlook, iCloud…)')} hint={t('Par son lien iCal privé.')}>
            <button className="btn" onClick={() => setAdding({ name: '', url: '' })}>
              <Plus /> {t('Lien iCal')}
            </button>
          </Row>
        )}
        {!!settings.calendars.length && (
          <Row label={t('Actualiser maintenant')}>
            <button className="icon-btn" aria-label={t('Actualiser')} onClick={() => void minute.calendar.refresh().then(setState)}>
              <RefreshCw />
            </button>
          </Row>
        )}
      </Group>
      <Group>
        <Row label={t('Rappels avant les réunions')} hint={t('Une notification 10 et 5 minutes avant, puis au début pour lancer la transcription.')}>
          <Switch on={settings.calendarReminders} onChange={(v) => void update({ calendarReminders: v })} />
        </Row>
        <Row label={t('Lancer Minute à l’ouverture de session')} hint={t('Minute attend discrètement dans la zone de notification, pour ne manquer aucun rappel.')}>
          <Switch on={settings.openAtLogin} onChange={(v) => void update({ openAtLogin: v })} />
        </Row>
        {info.platform === 'win32' && (
          <Row label={t('Détecter les visios')} hint={t('Quand Teams, Zoom ou Meet utilise le micro, Minute propose de transcrire — et d’arrêter à la fin.')}>
            <Switch on={settings.meetingDetection} onChange={(v) => void update({ meetingDetection: v })} />
          </Row>
        )}
      </Group>
      <button className="disclosure" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {advanced ? '▾' : '▸'} {t('Avancé — identifiants OAuth Google')}
      </button>
      {advanced && (
        <Group
          foot={
            client?.builtIn
              ? t('Cette version de Minute contient déjà les identifiants de votre organisation. Vous pouvez les remplacer.')
              : t('Créés une fois pour toute l’organisation dans Google Cloud (application de bureau, audience « Interne »).')
          }
        >
          <Row label={t('ID client')} col>
            <input className="field" value={cid} placeholder={client?.builtIn ? t('Identifiants intégrés') : '…apps.googleusercontent.com'} onChange={(e) => setCid(e.target.value)} />
          </Row>
          <Row label={t('Code secret du client')} col>
            <div className="row">
              <input className="field" type="password" value={csecret} placeholder="GOCSPX-…" onChange={(e) => setCsecret(e.target.value)} />
              <button className="btn" onClick={() => void saveClient()}>
                {t('Enregistrer')}
              </button>
            </div>
          </Row>
        </Group>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Intelligence
function Intelligence({ settings, update }: P) {
  const [models, setModels] = useState<string[]>([]);
  const provider = PROVIDERS.find((p) => p.id === settings.llmProvider) ?? PROVIDERS[0];
  const model = settings.llmModels[settings.llmProvider];
  useEffect(() => {
    setModels([]);
    void minute.secrets.listModels(settings.llmProvider).then(setModels);
  }, [settings.llmProvider]);
  return (
    <>
      <Group foot={t(provider.hint)}>
        <Row label={t('Rédaction des comptes-rendus')}>
          <div className="segmented">
            {PROVIDERS.map((p) => (
              <button key={p.id} className={settings.llmProvider === p.id ? 'active' : ''} onClick={() => void update({ llmProvider: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        {settings.llmProvider !== 'groq' && (
          <Row label={t('Clé {provider}', { provider: provider.label })} hint={link(provider.url, t('Obtenir une clé'))} col>
            <KeyField name={settings.llmProvider} onSaved={() => void minute.secrets.listModels(settings.llmProvider).then(setModels)} />
          </Row>
        )}
        <Row label={t('Modèle')}>
          {models.length ? (
            <select
              className="field"
              value={models.includes(model) ? model : ''}
              onChange={(e) => void update({ llmModels: { ...settings.llmModels, [settings.llmProvider]: e.target.value } })}
            >
              {!models.includes(model) && <option value="">{model}</option>}
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
        </Row>
      </Group>
      <Group>
        <Row label={t('Compte-rendu automatique')} hint={t('Rédigé dès la fin de la réunion : titre, décisions, actions, questions ouvertes.')}>
          <Switch on={settings.autoSummary} onChange={(v) => void update({ autoSummary: v })} />
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Mode compact & raccourcis
function Compact({ settings, update, info }: P) {
  const [fresh, setFresh] = useState(info);
  const setShortcut = async (k: keyof Shortcuts, v: string) => {
    await update({ shortcuts: { ...settings.shortcuts, [k]: v } });
    setFresh(await minute.info());
  };
  return (
    <>
      <Group foot={t('Le mode compact remplace la fenêtre pendant la visio : une Dynamic Island discrète, qui se déplie en sous-titres.')}>
        <Row label={t('Passer en mode compact au démarrage')}>
          <select className="field" value={settings.compactOnStart} onChange={(e) => void update({ compactOnStart: e.target.value as Settings['compactOnStart'] })}>
            <option value="background">{t('Si Minute est en arrière-plan')}</option>
            <option value="always">{t('Toujours')}</option>
            <option value="never">{t('Jamais')}</option>
          </select>
        </Row>
        <Row label={t('Pendant une réunion, l’île s’ouvre avec')}>
          <div className="segmented">
            {(
              [
                ['pill', 'La pastille'],
                ['panel', 'Les sous-titres'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={(settings.compactShape ?? 'pill') === v ? 'active' : ''} onClick={() => void update({ compactShape: v })}>
                {t(l)}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label={t('Quand Minute passe au second plan')}
          hint={t('Pendant une réunion, cliquer dans une autre application (Teams, navigateur…) remplace la fenêtre par la Dynamic Island.')}
        >
          <Switch on={settings.autoCompact} onChange={(v) => void update({ autoCompact: v })} />
        </Row>
        <Row
          label={t('Masquer des partages d’écran et captures')}
          hint={
            settings.miniHiddenFromCapture
              ? t('Les participants ne la voient pas quand vous partagez votre écran — mais vos captures d’écran non plus.')
              : t('Visible dans les captures d’écran… et dans vos partages d’écran Teams / Zoom.')
          }
        >
          <Switch on={settings.miniHiddenFromCapture} onChange={(v) => void update({ miniHiddenFromCapture: v })} />
        </Row>
      </Group>
      <Group title={t('Raccourcis — depuis n’importe quelle application')}>
        {(
          [
            ['toggleRecord', 'Démarrer / arrêter'],
            ['copy', 'Copier la transcription'],
            ['bookmark', 'Marquer un moment'],
            ['mini', 'Mode compact'],
          ] as [keyof Shortcuts, string][]
        ).map(([k, label]) => (
          <Row key={k} label={t(label)} hint={fresh.shortcutErrors.includes(settings.shortcuts[k]) ? <span className="ko">{t('Déjà pris par une autre application.')}</span> : undefined}>
            <ShortcutInput value={settings.shortcuts[k]} platform={info.platform} onChange={(v) => void setShortcut(k, v)} />
          </Row>
        ))}
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Données
function Data({ settings, update }: P) {
  const toast = useToast();
  const [natively, setNatively] = useState<NativelyInfo | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    void minute.natively.detect().then(setNatively);
  }, []);
  const runImport = async () => {
    setImporting(true);
    try {
      const r = await minute.natively.importAll();
      toast(r.imported > 1 ? t('{n} réunions importées depuis Natively', { n: r.imported }) : t('{n} réunion importée depuis Natively', { n: r.imported }), 'success');
      setNatively(await minute.natively.detect());
    } catch (e) {
      toast(t('Import impossible : {error}', { error: (e as Error).message }), 'error');
    } finally {
      setImporting(false);
    }
  };
  const nativelyLine = (n: number, a: number) =>
    !a
      ? n > 1
        ? t('{n} réunions. Natively n’est pas modifié.', { n })
        : t('{n} réunion. Natively n’est pas modifié.', { n })
      : n > 1
        ? a > 1
          ? t('{n} réunions, dont {a} déjà importées. Natively n’est pas modifié.', { n, a })
          : t('{n} réunions, dont {a} déjà importée. Natively n’est pas modifié.', { n, a })
        : t('{n} réunion, dont {a} déjà importée. Natively n’est pas modifié.', { n, a });
  return (
    <>
      <Group foot={t('Vos réunions restent sur cet ordinateur. Seul l’audio des phrases part chez Groq pour être transcrit, et seul le texte part chez le service d’IA choisi.')}>
        <Row label={t('Dossier des réunions')} hint={<span className="path">{settings.storageDir}</span>}>
          <button
            className="btn"
            onClick={async () => {
              const dir = await minute.settings.chooseStorageDir();
              if (!dir) return;
              try {
                await update({ storageDir: dir });
              } catch (e) {
                toast((e as Error).message.replace(/^Error invoking remote method [^:]+: (Error: )?/, ''), 'error');
              }
            }}
          >
            <FolderOpen /> {t('Changer…')}
          </button>
        </Row>
      </Group>
      <Group>
        <Row
          label={t('Historique Natively')}
          hint={
            natively === null
              ? t('Recherche…')
              : !natively.found
                ? t('Aucun historique Natively sur cet ordinateur.')
                : nativelyLine(natively.meetings, natively.alreadyImported)
          }
        >
          <button className="btn" disabled={!natively?.found || importing || natively.meetings === natively.alreadyImported} onClick={() => void runImport()}>
            {importing ? <Loader2 className="spin" /> : <Import />} {t('Importer')}
          </button>
        </Row>
      </Group>
    </>
  );
}
