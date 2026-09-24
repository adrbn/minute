import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider, SecretName, Settings } from '../shared/types';

const isMac = process.platform === 'darwin';

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  groq: 'openai/gpt-oss-120b',
  anthropic: 'claude-opus-5',
  gemini: 'gemini-flash-latest',
  openai: 'gpt-5.4',
};

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    language: 'auto', // chaque phrase dans sa langue (sinon Whisper traduit tout en français)
    sttModel: 'whisper-large-v3-turbo',
    vocabulary: '',
    livePreview: true,
    micDeviceId: '',
    captureSystem: true,
    keepAudioDays: 30,
    llmProvider: 'groq',
    llmModels: { ...DEFAULT_MODELS },
    autoSummary: true,
    meName: 'Moi',
    themName: 'Participants',
    storageDir: process.env.MINUTE_STORAGE || join(app.getPath('documents'), 'Minute'),
    shortcuts: isMac
      ? {
          toggleRecord: 'Control+Alt+Command+R',
          copy: 'Control+Alt+Command+C',
          bookmark: 'Control+Alt+Command+M',
          mini: 'Control+Alt+Command+T',
        }
      : {
          toggleRecord: 'Control+Alt+R',
          copy: 'Control+Alt+C',
          bookmark: 'Control+Alt+M',
          mini: 'Control+Alt+T',
        },
    miniHiddenFromCapture: true,
    compactOnStart: 'background',
    copyWithTimestamps: false,
    autoStopMinutes: 4,
    theme: 'system',
    calendars: [],
    calendarReminders: true,
    openAtLogin: true,
    meetingDetection: true,
    nameAlerts: true,
    learned: [],
    minimizeToCompact: true,
    autoCompact: true,
    compactShape: 'pill',
    privacyMode: false,
    localModel: 'turbo',
    retentionDays: 30,
    autoUpdate: true,
    languages: ['fr', 'en', 'it'],
    uiLanguage: 'auto',
    palette: 'system',
    voices: true,
  };
}

function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

class SettingsStore {
  private file = join(app.getPath('userData'), 'settings.json');
  private secretsFile = join(app.getPath('userData'), 'secrets.json');
  private value: Settings;
  private secrets: Partial<Record<string, string>>;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const saved = readJson<Partial<Settings>>(this.file) ?? {};
    const d = defaultSettings();
    this.value = {
      ...d,
      ...saved,
      llmModels: { ...d.llmModels, ...(saved.llmModels ?? {}) },
      shortcuts: { ...d.shortcuts, ...(saved.shortcuts ?? {}) },
    };
    this.secrets = this.loadSecrets();
  }

  get(): Settings {
    return this.value;
  }

  set(patch: Partial<Settings>): Settings {
    this.value = {
      ...this.value,
      ...patch,
      llmModels: { ...this.value.llmModels, ...(patch.llmModels ?? {}) },
      shortcuts: { ...this.value.shortcuts, ...(patch.shortcuts ?? {}) },
    };
    writeJsonAtomic(this.file, this.value);
    for (const l of this.listeners) l(this.value);
    return this.value;
  }

  onChange(cb: (s: Settings) => void) {
    this.listeners.add(cb);
  }

  // --- Clés API : chiffrées par l'OS (DPAPI sous Windows, Trousseau sous macOS).
  private loadSecrets(): Partial<Record<string, string>> {
    const raw = readJson<Record<string, string>>(this.secretsFile);
    if (!raw) return {};
    const out: Partial<Record<string, string>> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        out[k] = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(v, 'base64'))
          : Buffer.from(v, 'base64').toString('utf8');
      } catch {
        /* clé illisible (autre machine / autre utilisateur) : ignorée */
      }
    }
    return out;
  }

  private saveSecrets() {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.secrets)) {
      if (!v) continue;
      raw[k] = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(v).toString('base64')
        : Buffer.from(v, 'utf8').toString('base64');
    }
    writeJsonAtomic(this.secretsFile, raw);
  }

  secret(name: SecretName): string | undefined {
    return this.secrets[name] || process.env[`${name.toUpperCase()}_API_KEY`] || undefined;
  }

  setSecret(name: SecretName, value: string) {
    this.secrets[name] = value.trim();
    this.saveSecrets();
  }

  /** Secret libre (ex. jeton Google d'un compte), chiffré comme les clés. */
  vault(key: string, value?: string | null): string | undefined {
    if (value === undefined) return this.secrets[key] || undefined;
    if (value === null) delete this.secrets[key];
    else this.secrets[key] = value;
    this.saveSecrets();
    return value ?? undefined;
  }

  secretStatus(): Record<SecretName, boolean> {
    return {
      groq: !!this.secret('groq'),
      anthropic: !!this.secret('anthropic'),
      gemini: !!this.secret('gemini'),
      openai: !!this.secret('openai'),
    };
  }

  /** Enregistre l'état d'import déjà fait, etc. */
  appState<T>(key: string, value?: T): T | undefined {
    const file = join(app.getPath('userData'), 'state.json');
    const all = readJson<Record<string, unknown>>(file) ?? {};
    if (value === undefined) return all[key] as T | undefined;
    all[key] = value;
    writeJsonAtomic(file, all);
    return value;
  }
}

let instance: SettingsStore | null = null;
export function settings(): SettingsStore {
  if (!instance) instance = new SettingsStore();
  return instance;
}

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
