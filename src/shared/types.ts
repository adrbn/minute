// Types partagés entre le process principal, les preloads et l'interface.

export type Channel = 'me' | 'them';

export interface Segment {
  id: string;
  ch: Channel;
  /** ms depuis le début de la réunion */
  t0: number;
  t1: number;
  text: string;
  /** fichier WAV dans le dossier audio/ de la réunion (si conservé) */
  audio?: string;
  /** audio capté, transcription en attente (file d'attente, hors-ligne, limite Groq) */
  pending?: boolean;
  edited?: boolean;
  /** intervenant reconnu à sa voix (clé de MeetingMeta.voices) */
  spk?: string;
}

/** Un intervenant distingué à sa voix. */
export interface Voice {
  /** numéro affiché (« Participant B ») ; 0 pour l'utilisateur */
  n: number;
  name?: string;
  /** la voix de l'utilisateur, dans son micro */
  owner?: boolean;
}

export interface Bookmark {
  id: string;
  t: number;
  label: string;
}

export interface Summary {
  markdown: string;
  generatedAt: number;
  provider: string;
  model: string;
}

export type MeetingStatus = 'recording' | 'paused' | 'done' | 'interrupted';

export interface MeetingMeta {
  id: string;
  title: string;
  titleIsAuto: boolean;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  status: MeetingStatus;
  source: 'minute' | 'natively';
  speakers: { me: string; them: string };
  notes: string;
  bookmarks: Bookmark[];
  summary?: Summary;
  followUp?: string;
  wordCount: number;
  preview: string;
  hasAudio: boolean;
  language: string;
  pinned?: boolean;
  /** rangée dans les archives (hors de la liste principale, toujours cherchable) */
  archived?: boolean;
  /** dans la corbeille depuis ce moment ; effacée définitivement 30 jours après */
  deletedAt?: number;
  /** participants connus (agenda) — noms donnés à Whisper et à l'IA */
  attendees?: string[];
  /** réunion de l'agenda à l'origine de l'enregistrement */
  eventId?: string;
  /** intervenants distingués à leur voix */
  voices?: Record<string, Voice>;
}

export interface MeetingFull {
  meta: MeetingMeta;
  segments: Segment[];
}

export interface ChannelState {
  enabled: boolean;
  ok: boolean;
  error?: string;
}

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface LiveState {
  meetingId: string | null;
  status: RecorderStatus;
  startedAt: number;
  /** cumul des pauses, pour afficher un chrono juste */
  pausedMs: number;
  pausedAt?: number;
  channels: Record<Channel, ChannelState>;
  /** segments audio en attente de transcription (toutes réunions confondues) */
  queue: number;
  /** message d'état non bloquant (limite Groq, hors-ligne, écho…) */
  notice?: { kind: 'info' | 'warn' | 'error'; text: string };
}

export interface Levels {
  me: number;
  them: number;
  meSpeaking: boolean;
  themSpeaking: boolean;
}

export type LiveEvent =
  | { type: 'segment'; meetingId: string; segment: Segment }
  | { type: 'remove'; meetingId: string; id: string }
  | { type: 'interim'; meetingId: string; ch: Channel; t0: number; text: string }
  | { type: 'bookmark'; meetingId: string; bookmark: Bookmark };

export type SecretName = 'groq' | 'anthropic' | 'gemini' | 'openai';
export type LlmProvider = 'groq' | 'anthropic' | 'gemini' | 'openai';

export interface CalendarSource {
  /** 'google' : compte connecté (OAuth) ; 'ics' : lien iCal privé */
  kind?: 'ics' | 'google';
  name: string;
  /** lien iCal, ou « google:<e-mail> » pour un compte connecté */
  url: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  attendees: string[];
  /** lien Teams / Meet / Zoom trouvé dans l'invitation */
  link?: string;
  source: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'disabled';
  /** version installée */
  current: string;
  /** nouvelle version */
  version?: string;
  notes?: string;
  percent?: number;
  /** Windows : installation automatique ; macOS : téléchargement manuel */
  canInstall: boolean;
  url: string;
  error?: string;
  reason?: string;
  checkedAt?: number;
}

export interface LocalStatus {
  supported: boolean;
  engine: boolean;
  models: Record<'turbo' | 'small', boolean>;
  running: boolean;
  download?: { what: string; received: number; total: number };
  error?: string;
}

export interface CalendarState {
  events: CalendarEvent[];
  errors: Record<string, string>;
  lastSync: number;
}

export interface LearnedCorrection {
  from: string;
  to: string;
  count: number;
}

export interface Shortcuts {
  toggleRecord: string;
  copy: string;
  bookmark: string;
  mini: string;
}

export interface Settings {
  onboarded: boolean;
  language: string;
  sttModel: string;
  vocabulary: string;
  livePreview: boolean;
  micDeviceId: string;
  captureSystem: boolean;
  keepAudioDays: number;
  llmProvider: LlmProvider;
  llmModels: Record<LlmProvider, string>;
  autoSummary: boolean;
  meName: string;
  themName: string;
  storageDir: string;
  shortcuts: Shortcuts;
  miniHiddenFromCapture: boolean;
  /** passer en mode compact au démarrage d'une réunion */
  compactOnStart: 'never' | 'background' | 'always';
  copyWithTimestamps: boolean;
  autoStopMinutes: number;
  theme: 'system' | 'light' | 'dark';
  /** thème de couleur (« system » : accent du système) */
  palette: string;
  calendars: CalendarSource[];
  /** rappel « la réunion commence » depuis l'agenda */
  calendarReminders: boolean;
  /** Windows : proposer de transcrire quand Teams / Zoom / Meet utilise le micro */
  meetingDetection: boolean;
  /** alerte quand quelqu'un prononce votre prénom */
  nameAlerts: boolean;
  learned: LearnedCorrection[];
  /** réduire la fenêtre pendant une réunion ouvre la Dynamic Island */
  minimizeToCompact: boolean;
  /** pendant une réunion, la fenêtre qui passe au second plan laisse place à la Dynamic Island */
  autoCompact: boolean;
  /** forme de la Dynamic Island à l'ouverture pendant une réunion */
  compactShape: 'panel' | 'pill';
  /** mode confidentiel : transcription locale, verrou réseau, rien de conservé au-delà du nécessaire */
  privacyMode: boolean;
  /** modèle Whisper local (mode confidentiel) */
  localModel: 'turbo' | 'small';
  /** mode confidentiel : réunions supprimées définitivement au-delà de N jours (0 = jamais) */
  retentionDays: number;
  /** vérifier et télécharger les nouvelles versions tout seul */
  autoUpdate: boolean;
  /** « Plusieurs langues » : langues parlées dans les réunions ; une autre langue détectée = bruit mal compris */
  languages: string[];
  /** distinguer les intervenants à leur voix (calcul local) */
  voices: boolean;
}

export interface CopyOptions {
  range?: 'all' | 'last5' | 'last10' | 'sinceBookmark' | 'summary' | 'notes';
  timestamps?: boolean;
}

export interface SearchHit {
  meetingId: string;
  title: string;
  startedAt: number;
  kind: 'segment' | 'title' | 'notes' | 'summary';
  t?: number;
  ch?: Channel;
  snippet: string;
}

export type AiKind = 'summary' | 'catchup' | 'ask' | 'followup' | 'names';

export interface AiRequest {
  kind: AiKind;
  meetingId: string;
  question?: string;
  minutes?: number;
}

export interface AiEvent {
  requestId: string;
  meetingId: string;
  kind: AiKind;
  text: string;
  done: boolean;
  error?: string;
  progress?: string;
}

export interface NativelyInfo {
  found: boolean;
  meetings: number;
  alreadyImported: number;
}

export interface AppInfo {
  platform: NodeJS.Platform;
  /** fond translucide natif (Mica / vibrancy) disponible */
  material: boolean;
  version: string;
  accent: string;
  storageDir: string;
  shortcutErrors: string[];
}

export type CompactShape = 'pill' | 'panel';
/** coin (ou bord) d'écran auquel la fenêtre compacte est aimantée : t/b + l/c/r */
export type Anchor = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export interface CompactLayout {
  shape: CompactShape;
  anchor: Anchor;
  margin: number;
  pill: { w: number; h: number };
  /** la fenêtre compacte est affichée (et non simplement préchargée) */
  active: boolean;
}

export interface MinuteAPI {
  info(): Promise<AppInfo>;
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    chooseStorageDir(): Promise<string | null>;
  };
  secrets: {
    status(): Promise<Record<SecretName, boolean>>;
    set(name: SecretName, value: string): Promise<void>;
    test(name: SecretName): Promise<{ ok: boolean; message: string }>;
    listModels(provider: LlmProvider): Promise<string[]>;
  };
  meetings: {
    list(): Promise<MeetingMeta[]>;
    get(id: string): Promise<MeetingFull | null>;
    update(id: string, patch: Partial<MeetingMeta>): Promise<MeetingMeta | null>;
    remove(id: string): Promise<void>;
    /** corbeille de Minute : récupérable 30 jours */
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    /** suppression définitive */
    purge(id: string): Promise<void>;
    emptyTrash(): Promise<number>;
    /** réunit deux réunions en une (la plus ancienne garde son titre) ; renvoie l'id conservé */
    merge(a: string, b: string): Promise<string>;
    /** coupe la réunion avant cette phrase ; renvoie l'id de la nouvelle réunion (la suite) */
    split(id: string, segId: string): Promise<string>;
    editSegment(id: string, segId: string, text: string): Promise<void>;
    deleteSegment(id: string, segId: string): Promise<void>;
    reveal(id: string): Promise<void>;
    exportTo(id: string, format: 'md' | 'txt' | 'docx'): Promise<string | null>;
    copy(id: string, opts: CopyOptions): Promise<{ words: number }>;
    search(query: string): Promise<SearchHit[]>;
    retryPending(id: string): Promise<number>;
  };
  recorder: {
    state(): Promise<LiveState>;
    start(opts?: { title?: string; eventId?: string }): Promise<{ ok: boolean; error?: string }>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    bookmark(label?: string): Promise<void>;
  };
  ai: {
    run(req: AiRequest): Promise<string>;
    cancel(requestId: string): Promise<void>;
  };
  windows: {
    toggleCompact(): Promise<void>;
    enterCompact(): Promise<void>;
    exitCompact(opts?: { showMain?: boolean; meetingId?: string }): Promise<void>;
    setCompactShape(shape: CompactShape): Promise<void>;
    compactLayout(): Promise<CompactLayout>;
    /** déplacement direct (coordonnées écran) — vitesse en px/s au relâchement */
    compactDrag(phase: 'start' | 'move' | 'end', x: number, y: number, vx?: number, vy?: number): void;
    /** `corner` : le coin saisi ; le coin opposé reste fixe */
    compactResize(phase: 'start' | 'move' | 'end', dx: number, dy: number, corner?: Anchor): void;
    compactAck(): void;
    /** Windows : la fenêtre compacte prend le clavier (saisie) puis le rend */
    compactFocus(on: boolean): void;
    showMain(meetingId?: string): Promise<void>;
    /** quitte la Dynamic Island et ouvre les réglages de l'app (section donnée) */
    openSettings(section?: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    openPrivacySettings(kind: 'microphone' | 'audio'): Promise<void>;
  };
  diag: {
    /** rapport de problème : texte complet et adresse du ticket GitHub pré-rempli */
    report(input: { title: string; what: string; logs: boolean }): Promise<{ text: string; url: string; truncated: boolean }>;
  };
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    /** Windows : redémarre sur la nouvelle version */
    install(): Promise<void>;
  };
  /** mode confidentiel : moteur de transcription local, IA locale, message aux participants */
  local: {
    status(): Promise<LocalStatus>;
    install(model: 'turbo' | 'small'): Promise<LocalStatus>;
    remove(model: 'turbo' | 'small'): Promise<LocalStatus>;
    llm(): Promise<{ base: string; model: string } | null>;
    notice(): Promise<string>;
  };
  calendar: {
    state(): Promise<CalendarState>;
    refresh(): Promise<CalendarState>;
    test(url: string): Promise<{ ok: boolean; message: string }>;
    /** « Se connecter avec Google » : ouvre le navigateur, renvoie l'e-mail connecté */
    connectGoogle(): Promise<{ ok: boolean; message: string }>;
    disconnect(url: string): Promise<void>;
    googleClient(): Promise<{ configured: boolean; builtIn: boolean; id: string }>;
    setGoogleClient(id: string, secret: string): Promise<void>;
  };
  vocabulary: {
    suggestions(): Promise<{ term: string; count: number; meetings: number }[]>;
  };
  natively: {
    detect(): Promise<NativelyInfo>;
    importAll(): Promise<{ imported: number; skipped: number }>;
  };
  audioUrl(meetingId: string, file: string): string;
  on(event: 'live', cb: (e: LiveEvent) => void): () => void;
  on(event: 'state', cb: (s: LiveState) => void): () => void;
  on(event: 'levels', cb: (l: Levels) => void): () => void;
  on(event: 'meetings', cb: () => void): () => void;
  on(event: 'ai', cb: (e: AiEvent) => void): () => void;
  on(event: 'localStatus', cb: (s: LocalStatus) => void): () => void;
  on(event: 'update', cb: (s: UpdateState) => void): () => void;
  on(event: 'navigate', cb: (target: { meetingId?: string; view?: string; section?: string }) => void): () => void;
  on(event: 'toast', cb: (t: { text: string; kind?: 'info' | 'success' | 'warn' | 'error' }) => void): () => void;
  on(event: 'settings', cb: (s: Settings) => void): () => void;
  on(event: 'compactLayout', cb: (l: CompactLayout) => void): () => void;
  on(event: 'compact', cb: (active: boolean) => void): () => void;
  on(event: 'calendar', cb: (s: CalendarState) => void): () => void;
  on(event: 'mention', cb: (m: { meetingId: string; text: string }) => void): () => void;
}

/** Pont réservé à la fenêtre invisible qui capte l'audio. */
export interface EngineStartOptions {
  startedAt: number;
  /** pauses déjà écoulées (reprise après un crash du moteur) */
  pausedMs: number;
  micDeviceId: string;
  captureSystem: boolean;
  /** 'display' = boucle système via Chromium (Windows) ; 'pcm' = PCM poussé par le main (macOS / AudioTee) */
  systemMode: 'display' | 'pcm' | 'off';
  livePreview: boolean;
  /** calculer l'empreinte de voix de chaque extrait (séparation des intervenants) */
  voices: boolean;
}

export interface EngineSegment {
  ch: Channel;
  t0: number;
  t1: number;
  /** PCM 16 bits mono 16 kHz */
  pcm: ArrayBuffer;
  interim: boolean;
  /** empreinte de la voix (512 valeurs), si la séparation des voix est active */
  voice?: number[];
}

export interface EngineBridge {
  onStart(cb: (o: EngineStartOptions) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  onStop(cb: () => void): void;
  onSystemPcm(cb: (pcm: ArrayBuffer) => void): void;
  segment(s: EngineSegment): void;
  levels(l: Levels): void;
  status(ch: Channel, ok: boolean, error?: string): void;
  stopped(): void;
  log(msg: string): void;
}
