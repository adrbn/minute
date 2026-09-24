import {
  AudioLines,
  CalendarDays,
  Database,
  ExternalLink,
  FolderOpen,
  Import,
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
import type { AppInfo, CalendarState, LlmProvider, NativelyInfo, SecretName, Settings, Shortcuts } from '../../../shared/types';
import { minute, relativeTime, shortcutLabel } from '../api';
import { Switch, useAudioInputs, useToast } from './ui';

const PROVIDERS: { id: LlmProvider; label: string; hint: string; url: string }[] = [
  { id: 'groq', label: 'Groq', hint: 'La même clé que la transcription. Gratuit et rapide.', url: 'https://console.groq.com/keys' },
  { id: 'anthropic', label: 'Claude', hint: 'La meilleure qualité rédactionnelle en français.', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Gemini', hint: 'Très long contexte, offre gratuite généreuse.', url: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI', hint: 'Modèles GPT.', url: 'https://platform.openai.com/api-keys' },
];

export type SettingsSection = 'general' | 'transcription' | 'audio' | 'calendar' | 'ai' | 'compact' | 'data';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Général', icon: <SlidersHorizontal /> },
  { id: 'transcription', label: 'Transcription', icon: <Type /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines /> },
  { id: 'calendar', label: 'Agenda', icon: <CalendarDays /> },
  { id: 'ai', label: 'Intelligence', icon: <Sparkles /> },
  { id: 'compact', label: 'Mode compact', icon: <Keyboard /> },
  { id: 'data', label: 'Données', icon: <Database /> },
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
          placeholder={has ? 'Clé enregistrée — collez-en une autre pour la remplacer' : 'Collez votre clé'}
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
      {rec ? 'Tapez la combinaison…' : shortcutLabel(value, platform) || 'Aucun'}
    </button>
  );
}

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
      <div className="sheet settings" role="dialog" aria-label="Réglages">
        <nav className="settings-nav">
          <div className="settings-nav-title">Réglages</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
              {s.icon}
              {s.label}
            </button>
          ))}
          <div className="grow" />
          <div className="faint settings-version">Minute {info.version}</div>
        </nav>
        <div className="settings-pane">
          <div className="sheet-head">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fermer">
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
            {section === 'data' && <Data {...props} />}
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
        <Row label="Votre prénom" hint="Affiché pour votre voix, et utilisé pour vous prévenir quand on s’adresse à vous.">
          <input className="field" defaultValue={settings.meName === 'Moi' ? '' : settings.meName} placeholder="Moi" onBlur={(e) => void update({ meName: e.target.value.trim() || 'Moi' })} />
        </Row>
        <Row label="Les autres participants" hint="Nom par défaut de la voix de l’ordinateur.">
          <input
            className="field"
            defaultValue={settings.themName === 'Eux' ? 'Participants' : settings.themName}
            onBlur={(e) => void update({ themName: e.target.value.trim() || 'Participants' })}
          />
        </Row>
        <Row label="Me prévenir quand on dit mon prénom" hint="Notification « On parle de vous » si Minute n’est pas au premier plan.">
          <Switch on={settings.nameAlerts} onChange={(v) => void update({ nameAlerts: v })} />
        </Row>
      </Group>
      <Group>
        <Row label="Apparence">
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
        </Row>
        <Row label="Copier avec l’horodatage" hint="Ajoute [mm:ss] devant chaque intervention copiée.">
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
    for (const t of terms) if (!list.some((v) => v.toLowerCase() === t.toLowerCase())) list.push(t);
    void update({ vocabulary: list.join(', ') });
  };
  return (
    <>
      <Group foot={<>Whisper large-v3 turbo, via Groq : rapide, excellent en français, gratuit jusqu’à environ 2 h d’audio par heure. {link('https://console.groq.com/keys', 'Obtenir une clé')}</>}>
        <Row label="Clé Groq" col>
          <KeyField name="groq" />
        </Row>
      </Group>
      <Group>
        <Row
          label="Langue des réunions"
          hint={
            settings.language === 'auto'
              ? 'Chaque phrase est écrite dans la langue où elle est dite (français, italien, anglais…).'
              : 'Une phrase dite dans une autre langue est traduite dans celle-ci. Réunions multilingues : choisissez « Plusieurs langues ».'
          }
        >
          <select className="field" value={settings.language} onChange={(e) => void update({ language: e.target.value })}>
            <option value="fr">Français</option>
            <option value="auto">Plusieurs langues (détection)</option>
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
          </select>
        </Row>
        <Row label="Modèle" hint="Turbo suffit presque toujours ; Large v3 est un peu plus précis, un peu plus lent.">
          <select className="field" value={settings.sttModel} onChange={(e) => void update({ sttModel: e.target.value })}>
            <option value="whisper-large-v3-turbo">Large v3 turbo</option>
            <option value="whisper-large-v3">Large v3</option>
          </select>
        </Row>
        <Row label="Texte pendant que l’on parle" hint="Affiche un aperçu avant la fin de la phrase (un peu plus de quota Groq).">
          <Switch on={settings.livePreview} onChange={(v) => void update({ livePreview: v })} />
        </Row>
        <Row
          label={
            <>
              Distinguer les intervenants <span className="badge-beta">bêta</span>
            </>
          }
          hint="Reconnaît chaque voix : « Participant A, B, C… », chacun sa couleur, à renommer d’un clic. Calcul fait sur cet ordinateur, rien n’est envoyé."
        >
          <Switch on={settings.voices} onChange={(v) => void update({ voices: v })} />
        </Row>
      </Group>
      <Group title="Vocabulaire" foot="Les participants de l’agenda s’ajoutent d’eux-mêmes à chaque réunion.">
        <Row label="Noms propres, sigles, jargon" hint="Minute les écrira correctement. Séparés par des virgules." col>
          <textarea className="field" rows={3} value={vocab} onChange={(e) => setVocab(e.target.value)} onBlur={() => void update({ vocabulary: vocab })} />
        </Row>
        {!!sugg?.length && (
          <Row
            label="Suggestions"
            hint="Noms et sigles qui reviennent dans vos réunions."
            col
          >
            <div className="chips">
              {sugg.map((s) => (
                <button key={s.term} className="chip" onClick={() => addTerms([s.term])} title={`${s.count} fois, dans ${s.meetings} réunions`}>
                  <Plus /> {s.term}
                </button>
              ))}
              {sugg.length > 1 && (
                <button className="chip strong" onClick={() => addTerms(sugg.map((s) => s.term))}>
                  Tout ajouter
                </button>
              )}
            </div>
          </Row>
        )}
        <Row
          label="Corrections apprises"
          hint={settings.learned.length ? 'Réappliquées automatiquement aux nouvelles transcriptions.' : 'Corrigez une phrase d’un double-clic : Minute retiendra la correction.'}
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
                      aria-label="Oublier"
                      title="Oublier cette correction"
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
      <Row label="Micro">
        <select className="field" value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
          <option value="">Micro par défaut du système</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Micro'}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Son de l’ordinateur" hint="La voix des autres en visio (Teams, Meet, Zoom…).">
        <Switch on={settings.captureSystem} onChange={(v) => void update({ captureSystem: v })} />
      </Row>
      <Row label="Garder l’audio" hint="Pour réécouter une phrase en cliquant sur son heure.">
        <select className="field" value={settings.keepAudioDays} onChange={(e) => void update({ keepAudioDays: Number(e.target.value) })}>
          <option value={0}>Jamais</option>
          <option value={7}>7 jours</option>
          <option value={30}>30 jours</option>
          <option value={90}>90 jours</option>
          <option value={-1}>Toujours</option>
        </select>
      </Row>
      <Row label="Proposer d’arrêter après un silence" hint="Pour ne jamais laisser tourner un enregistrement oublié.">
        <select className="field" value={settings.autoStopMinutes} onChange={(e) => void update({ autoStopMinutes: Number(e.target.value) })}>
          <option value={0}>Jamais</option>
          <option value={2}>2 min</option>
          <option value={4}>4 min</option>
          <option value={8}>8 min</option>
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
    await update({ calendars: [...settings.calendars, { kind: 'ics', name: adding.name.trim() || 'Agenda', url: adding.url.trim() }] });
    toast(r.message, 'success');
    setAdding(null);
  };
  const saveClient = async () => {
    await minute.calendar.setGoogleClient(cid, csecret);
    const c = await minute.calendar.googleClient();
    setClient(c);
    setCsecret('');
    toast(c.configured ? 'Identifiants Google enregistrés' : 'Identifiants retirés', 'success');
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
            hint={state?.errors[c.url] ? <span className="ko">{state.errors[c.url]}</span> : state?.lastSync ? `À jour ${relativeTime(state.lastSync)}` : 'Synchronisation…'}
          >
            <button className="btn small ghost" onClick={() => void minute.calendar.disconnect(c.url)}>
              {c.kind === 'google' ? 'Déconnecter' : 'Retirer'}
            </button>
          </Row>
        ))}
        <Row
          label={settings.calendars.some((c) => c.kind === 'google') ? 'Ajouter un autre compte Google' : 'Google Agenda'}
          hint={
            client && !client.configured
              ? 'Il manque les identifiants OAuth de votre organisation (Avancé, plus bas).'
              : 'Votre navigateur s’ouvre sur la page de connexion Google ; l’accès est en lecture seule.'
          }
        >
          <button className="btn google-btn" onClick={() => void connectGoogle()} disabled={connecting || !client?.configured}>
            {connecting ? <Loader2 className="spin" /> : <GoogleMark />} {connecting ? 'En attente du navigateur…' : 'Se connecter avec Google'}
          </button>
        </Row>
        {adding ? (
          <Row label="Lien iCal privé" col>
            <div className="stack-6">
              <input className="field" placeholder="Nom (ex. Outlook)" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
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
                  {adding.busy ? <Loader2 className="spin" /> : 'Ajouter'}
                </button>
                <button className="btn ghost" onClick={() => setAdding(null)}>
                  Annuler
                </button>
              </div>
              {adding.msg && <span className={`test-msg ${adding.ok ? 'ok' : 'ko'}`}>{adding.msg}</span>}
            </div>
          </Row>
        ) : (
          <Row label="Autre agenda (Outlook, iCloud…)" hint="Par son lien iCal privé.">
            <button className="btn" onClick={() => setAdding({ name: '', url: '' })}>
              <Plus /> Lien iCal
            </button>
          </Row>
        )}
        {!!settings.calendars.length && (
          <Row label="Actualiser maintenant">
            <button className="icon-btn" aria-label="Actualiser" onClick={() => void minute.calendar.refresh().then(setState)}>
              <RefreshCw />
            </button>
          </Row>
        )}
      </Group>
      <Group>
        <Row label="Rappel au début d’une réunion" hint="Une notification pour lancer la transcription, avec le titre et les participants.">
          <Switch on={settings.calendarReminders} onChange={(v) => void update({ calendarReminders: v })} />
        </Row>
        {info.platform === 'win32' && (
          <Row label="Détecter les visios" hint="Quand Teams, Zoom ou Meet utilise le micro, Minute propose de transcrire — et d’arrêter à la fin.">
            <Switch on={settings.meetingDetection} onChange={(v) => void update({ meetingDetection: v })} />
          </Row>
        )}
      </Group>
      <button className="disclosure" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {advanced ? '▾' : '▸'} Avancé — identifiants OAuth Google
      </button>
      {advanced && (
        <Group
          foot={
            client?.builtIn
              ? 'Cette version de Minute contient déjà les identifiants de votre organisation. Vous pouvez les remplacer.'
              : 'Créés une fois pour toute l’organisation dans Google Cloud (application de bureau, audience « Interne »).'
          }
        >
          <Row label="ID client" col>
            <input className="field" value={cid} placeholder={client?.builtIn ? 'Identifiants intégrés' : '…apps.googleusercontent.com'} onChange={(e) => setCid(e.target.value)} />
          </Row>
          <Row label="Code secret du client" col>
            <div className="row">
              <input className="field" type="password" value={csecret} placeholder="GOCSPX-…" onChange={(e) => setCsecret(e.target.value)} />
              <button className="btn" onClick={() => void saveClient()}>
                Enregistrer
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
      <Group foot={provider.hint}>
        <Row label="Rédaction des comptes-rendus">
          <div className="segmented">
            {PROVIDERS.map((p) => (
              <button key={p.id} className={settings.llmProvider === p.id ? 'active' : ''} onClick={() => void update({ llmProvider: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        {settings.llmProvider !== 'groq' && (
          <Row label={<>Clé {provider.label}</>} hint={link(provider.url, 'Obtenir une clé')} col>
            <KeyField name={settings.llmProvider} onSaved={() => void minute.secrets.listModels(settings.llmProvider).then(setModels)} />
          </Row>
        )}
        <Row label="Modèle">
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
        <Row label="Compte-rendu automatique" hint="Rédigé dès la fin de la réunion : titre, décisions, actions, questions ouvertes.">
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
      <Group foot="Le mode compact remplace la fenêtre pendant la visio : une Dynamic Island discrète, qui se déplie en sous-titres.">
        <Row label="Passer en mode compact au démarrage">
          <select className="field" value={settings.compactOnStart} onChange={(e) => void update({ compactOnStart: e.target.value as Settings['compactOnStart'] })}>
            <option value="background">Si Minute est en arrière-plan</option>
            <option value="always">Toujours</option>
            <option value="never">Jamais</option>
          </select>
        </Row>
        <Row
          label="Masquer des partages d’écran et captures"
          hint={
            settings.miniHiddenFromCapture
              ? 'Les participants ne la voient pas quand vous partagez votre écran — mais vos captures d’écran non plus.'
              : 'Visible dans les captures d’écran… et dans vos partages d’écran Teams / Zoom.'
          }
        >
          <Switch on={settings.miniHiddenFromCapture} onChange={(v) => void update({ miniHiddenFromCapture: v })} />
        </Row>
      </Group>
      <Group title="Raccourcis — depuis n’importe quelle application">
        {(
          [
            ['toggleRecord', 'Démarrer / arrêter'],
            ['copy', 'Copier la transcription'],
            ['bookmark', 'Marquer un moment'],
            ['mini', 'Mode compact'],
          ] as [keyof Shortcuts, string][]
        ).map(([k, label]) => (
          <Row key={k} label={label} hint={fresh.shortcutErrors.includes(settings.shortcuts[k]) ? <span className="ko">Déjà pris par une autre application.</span> : undefined}>
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
      toast(`${r.imported} réunion${r.imported > 1 ? 's' : ''} importée${r.imported > 1 ? 's' : ''} depuis Natively`, 'success');
      setNatively(await minute.natively.detect());
    } catch (e) {
      toast(`Import impossible : ${(e as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <Group foot="Vos réunions restent sur cet ordinateur. Seul l’audio des phrases part chez Groq pour être transcrit, et seul le texte part chez le service d’IA choisi.">
        <Row label="Dossier des réunions" hint={<span className="path">{settings.storageDir}</span>}>
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
            <FolderOpen /> Changer…
          </button>
        </Row>
      </Group>
      <Group>
        <Row
          label="Historique Natively"
          hint={
            natively === null
              ? 'Recherche…'
              : !natively.found
                ? 'Aucun historique Natively sur cet ordinateur.'
                : `${natively.meetings} réunion${natively.meetings > 1 ? 's' : ''}${natively.alreadyImported ? `, dont ${natively.alreadyImported} déjà importée${natively.alreadyImported > 1 ? 's' : ''}` : ''}. Natively n’est pas modifié.`
          }
        >
          <button className="btn" disabled={!natively?.found || importing || natively.meetings === natively.alreadyImported} onClick={() => void runImport()}>
            {importing ? <Loader2 className="spin" /> : <Import />} Importer
          </button>
        </Row>
      </Group>
    </>
  );
}
