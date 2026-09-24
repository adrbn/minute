import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  Notification,
  protocol,
  session,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
} from 'electron';
import { appendFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AiRequest, CalendarEvent, EngineSegment, Levels, LlmProvider, SecretName, Segment, Settings } from '../shared/types';
import { cancelAi, runAi } from './ai';
import { CalendarService, fetchCalendar } from './calendar';
import { googleSignIn, revokeGoogle, type GoogleClient } from './google';
import { startMeetingDetector } from './meetingDetector';
import { learnFromEdit, mergeLearned, suggestTerms, vocabularyList } from './vocabulary';
import {
  applyCompactPrivacy,
  enterCompact,
  exitCompact,
  initCompact,
  isCompact,
  layout as compactLayout,
  onCompactChange,
  setShape as setCompactShape,
  toggleCompact,
} from './compact';
import { copyMeeting, exportMeeting } from './exporter';
import { transcribe } from './groq';
import { listModels } from './llm';
import { createMacSystemAudio, openMacPrivacy } from './macAudio';
import { detectNatively, importNatively } from './natively';
import { Recorder } from './recorder';
import { settings } from './settings';
import { planMerge, planSplit } from './merge';
import { installLocal, localStatus, onLocalStatus, removeLocalModel, stopLocal, type LocalModel } from './localStt';
import { findLocalLlm } from './llm';
import { installNetworkGuard, participantNotice, setPrivacy } from './privacy';
import { checkForUpdates, initUpdater, installUpdate, updateState } from './updater';
import { diagLog, diagnostics } from './diag';
import { locale, resolveLang, setLang, t } from '../shared/i18n';
import { newId, store } from './store';
import { pcm16ToWav } from './wav';
import {
  allUiWindows,
  createMain,
  createTray,
  engineSend,
  engineStart,
  engineWebContentsId,
  getMain,
  ensureEngine,
  isWin11,
  paths,
  refreshTray,
  setEngineCrashHandler,
  setOnMinimize,
  setOnBackground,
  setQuitting,
  showMain,
} from './windows';

const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'minute-audio', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } },
]);

// Profil isolé (tests / développement) : MINUTE_PROFILE_DIR=… npm start
if (process.env.MINUTE_PROFILE_DIR) app.setPath('userData', process.env.MINUTE_PROFILE_DIR);

// Journal des erreurs imprévues (userData/minute.log) au lieu d'une boîte de dialogue bloquante.
function logError(kind: string, err: unknown) {
  const line = `[${new Date().toISOString()}] ${kind}: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`;
  try {
    appendFileSync(join(app.getPath('userData'), 'minute.log'), line);
  } catch {
    /* disque indisponible */
  }
  console.error(line);
  diagLog('erreur', `${kind}: ${err instanceof Error ? err.message : String(err)}`);
}
process.on('uncaughtException', (err) => logError('uncaughtException', err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
// Identité Windows (notifications, épinglage). En développement (electron.exe), Windows prendrait
// alors l'icône d'Electron pour la barre des tâches : on laisse l'icône de la fenêtre s'afficher.
if (app.isPackaged || process.platform !== 'win32') app.setAppUserModelId('fr.minute.app');

// ------------------------------------------------------------------ diffusion vers l'interface
function broadcast(channel: string, payload?: unknown) {
  for (const w of allUiWindows()) w.webContents.send(channel, payload);
}
const toast = (text: string, kind: 'info' | 'success' | 'warn' | 'error' = 'info') => broadcast('toast', { text, kind });

/** Notification système quand Minute n'est pas au premier plan (raccourcis globaux). */
function notify(title: string, body = '') {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    toast(body ? `${title} — ${body}` : title, 'success');
    return;
  }
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

const recorder = new Recorder({
  live: (e) => broadcast('live', e),
  state: (s) => {
    broadcast('state', s);
    refreshTray();
  },
  levels: (l) => broadcast('levels', l),
  meetingsChanged: () => broadcast('meetings'),
  toast,
  engineStart: async (o) => {
    await ensureEngine();
    await engineStart(o);
  },
  engineSend,
  systemAudio: isMac ? createMacSystemAudio() : null,
  finished: (id) => {
    const meta = store.meta(id);
    if (!meta) return;
    // rien n'a été dit ni noté (essai de micro, démarrage par erreur) : on n'encombre pas l'historique
    const empty = !store.segments(id).some((s) => s.text.trim()) && !meta.notes.trim() && !meta.bookmarks.length;
    if (empty && meta.source === 'minute') {
      void store.remove(id).then(() => {
        broadcast('meetings');
        toast(t('Rien n’a été capté : la réunion n’a pas été conservée.'));
      });
      return;
    }
    if (meta.summary || !settings().get().autoSummary || meta.wordCount < 40) return;
    void runAi({ kind: 'summary', meetingId: id }, (e) => {
      broadcast('ai', e);
      if (e.done) broadcast('meetings');
    });
  },
  ended: () => undefined,
  mention: (meetingId, text) => {
    broadcast('mention', { meetingId, text });
    // au premier plan, la transcription le montre déjà ; sinon, une notification discrète
    if (!BrowserWindow.getFocusedWindow() && Notification.isSupported()) {
      const n = new Notification({ title: t('On parle de vous'), body: t('« {text} »', { text: text.slice(0, 140) }), silent: false });
      n.on('click', () => {
        showMain();
        broadcast('navigate', { meetingId });
      });
      n.show();
    }
  },
  showMain: (id) => {
    showMain();
    if (id) broadcast('navigate', { meetingId: id });
  },
});

// ------------------------------------------------------------------ agenda et détection des visios
// Identifiants OAuth Google : intégrés à la compilation (MINUTE_GOOGLE_CLIENT_ID/SECRET),
// ou saisis dans les réglages avancés.
declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;
function googleClient(): (GoogleClient & { builtIn: boolean }) | null {
  const saved = settings().vault('googleClient');
  if (saved) {
    try {
      const c = JSON.parse(saved) as GoogleClient;
      if (c.id) return { ...c, builtIn: false };
    } catch {
      /* ignoré */
    }
  }
  return __GOOGLE_CLIENT_ID__ ? { id: __GOOGLE_CLIENT_ID__, secret: __GOOGLE_CLIENT_SECRET__, builtIn: true } : null;
}

const calendar = new CalendarService(
  () => settings().get().calendars,
  () => broadcast('calendar', calendarState()),
  (src) => {
    const client = googleClient();
    const refreshToken = settings().vault(src.url);
    return client && refreshToken ? { client, refreshToken } : null;
  },
);
const calendarState = () => ({ events: calendar.upcoming(Date.now(), 12), errors: calendar.errors, lastSync: calendar.lastSync });

/** Démarre depuis l'agenda, une notification ou un raccourci, avec le contexte de la réunion en cours. */
async function startFromContext(opts: { event?: CalendarEvent | null; inBackground: boolean }) {
  if (recorder.state.status !== 'idle') return;
  const r = await recorder.start({ event: opts.event ?? calendar.current() });
  if (!r.ok) {
    showMain();
    toast(r.error ?? t('Impossible de démarrer'), 'error');
    return;
  }
  broadcast('navigate', { meetingId: recorder.state.meetingId ?? undefined });
  if (!maybeCompactOnStart(opts.inBackground)) notify(t('Transcription démarrée'), t('Minute transcrit la réunion en direct.'));
}

function notifyAction(title: string, body: string, onClick: () => void) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', onClick);
  n.show();
}

const reminded = new Set<string>();
/** Rappels de l'agenda : 10 minutes avant, 5 minutes avant, puis au début (pour lancer la transcription). */
function checkReminders() {
  if (!settings().get().calendarReminders) return;
  const now = Date.now();
  for (const ev of calendar.upcoming(now, 4)) {
    const left = ev.start - now;
    const time = new Date(ev.start).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    // un seul rappel par palier ; Minute lancé 3 minutes avant ne rattrape pas celui des 10 minutes
    const step = left <= 60_000 ? 0 : left <= 5 * 60_000 ? 5 : left <= 10 * 60_000 ? 10 : -1;
    const key = `${ev.id}:${step}`;
    if (step < 0 || reminded.has(key)) continue;
    if (step === 0) {
      if (now - ev.start >= 5 * 60_000 || recorder.state.status !== 'idle') continue;
      reminded.add(key);
      notifyAction(t('« {title} » commence', { title: ev.title }), t('Cliquez pour transcrire la réunion.'), () => void startFromContext({ event: ev, inBackground: true }));
      continue;
    }
    reminded.add(key);
    const mins = Math.max(1, Math.round(left / 60_000));
    notifyAction(
      t('« {title} » dans {n} min', { title: ev.title, n: mins }),
      ev.attendees.length ? t('À {time}, avec {who}.', { time, who: ev.attendees.slice(0, 3).join(', ') }) : t('À {time}.', { time }),
      () => showMain(),
    );
  }
}

/** Ouverture de session : Minute se lance discrètement pour les rappels (version installée seulement). */
function applyLoginItem() {
  if (!app.isPackaged || process.platform === 'linux') return;
  const on = settings().get().openAtLogin;
  if (app.getLoginItemSettings().openAtLogin === on) return;
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

let detectedSnooze = 0;
/** Nom de l'application de visio (identifiant en français, cf. meetingDetector.ts), traduit, avec majuscule. */
const appLabel = (app: string) => {
  const name = t(app);
  return `${name[0].toUpperCase()}${name.slice(1)}`;
};
function onMeetingAppStarted(app: string) {
  if (recorder.state.status !== 'idle' || Date.now() < detectedSnooze) return;
  const ev = calendar.current();
  detectedSnooze = Date.now() + 90_000;
  notifyAction(
    ev ? t('« {title} » a commencé', { title: ev.title }) : t('Visio détectée'),
    t('{app} utilise votre micro — cliquez pour transcrire.', { app: appLabel(app) }),
    () => void startFromContext({ event: ev, inBackground: true }),
  );
}
function onMeetingAppEnded(app: string) {
  if (recorder.state.status !== 'recording') return;
  notifyAction(t('La visio semble terminée'), t('{app} n’utilise plus le micro — cliquez pour arrêter la transcription.', { app: appLabel(app) }), () =>
    void recorder.stop(),
  );
}

const TRASH_DAYS = 30;
/**
 * Effacements automatiques : la corbeille après 30 jours ; en mode confidentiel, les réunions
 * plus anciennes que la durée de conservation (sauf épinglées).
 */
function purgeExpired() {
  const cfg = settings().get();
  const now = Date.now();
  const retention = cfg.privacyMode && cfg.retentionDays ? now - cfg.retentionDays * 86_400_000 : 0;
  let n = 0;
  for (const m of store.list()) {
    if (recorder.busyWith(m.id)) continue;
    const trashExpired = m.deletedAt && m.deletedAt < now - TRASH_DAYS * 86_400_000;
    const tooOld = retention && m.startedAt < retention && !m.pinned;
    if (trashExpired || tooOld) {
      store.removePermanently(m.id);
      n++;
    }
  }
  if (n) broadcast('meetings');
}

// ------------------------------------------------------------------ actions communes (UI, menu, raccourcis)
let stopArmedAt = 0;
/** « Control+Alt+R » → « Ctrl+Alt+R » (ou ⌃⌥⌘R sur Mac) pour les messages. */
const shortcutText = (accel: string) =>
  isMac
    ? accel.replace(/Control\+?/g, '⌃').replace(/Alt\+?/g, '⌥').replace(/Command\+?/g, '⌘').replace(/Shift\+?/g, '⇧')
    : accel.replace(/Control/g, 'Ctrl').replace(/Command/g, 'Win');
const actions = {
  async toggleRecord() {
    const st = recorder.state.status;
    if (st === 'idle') {
      await startFromContext({ inBackground: !BrowserWindow.getFocusedWindow() });
    } else if (st === 'recording' || st === 'paused') {
      // une fausse manip ne doit pas couper la réunion : il faut appuyer une seconde fois
      if (Date.now() - stopArmedAt > 3000) {
        stopArmedAt = Date.now();
        recorder.notice(
          'warn',
          t('Appuyez encore sur {shortcut} pour terminer la réunion', { shortcut: shortcutText(settings().get().shortcuts.toggleRecord) }),
          'stopArmed',
        );
        setTimeout(() => {
          if (Date.now() - stopArmedAt >= 3000 && recorder.noticeIs('stopArmed')) recorder.notice('info', null);
        }, 3100);
        return;
      }
      stopArmedAt = 0;
      recorder.notice('info', null);
      await recorder.stop();
      notify(t('Réunion enregistrée'), t('Le compte-rendu se prépare.'));
    }
  },
  pauseResume() {
    if (recorder.state.status === 'paused') recorder.resume();
    else recorder.pause();
  },
  bookmark() {
    if (!recorder.state.meetingId) return;
    recorder.bookmark();
  },
  async copy() {
    const id = recorder.state.meetingId ?? store.list()[0]?.id;
    if (!id) return notify(t('Rien à copier pour l’instant'));
    const { words } = await copyMeeting(id, { range: 'all' }, settings().get().copyWithTimestamps);
    const n = words.toLocaleString(locale());
    notify(t('Transcription copiée'), words > 1 ? t('{n} mots dans le presse-papiers.', { n }) : t('{n} mot dans le presse-papiers.', { n }));
  },
  mini() {
    toggleCompact();
  },
};

/** Mode compact au démarrage : « toujours », ou seulement quand Minute est en arrière-plan. */
function maybeCompactOnStart(inBackground: boolean): boolean {
  const pref = settings().get().compactOnStart;
  if (pref === 'always' || (pref === 'background' && inBackground)) {
    enterCompact();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ raccourcis globaux
let shortcutErrors: string[] = [];
function registerShortcuts(s: Settings) {
  globalShortcut.unregisterAll();
  shortcutErrors = [];
  const map: [string, () => void][] = [
    [s.shortcuts.toggleRecord, () => void actions.toggleRecord()],
    [s.shortcuts.copy, () => void actions.copy()],
    [s.shortcuts.bookmark, actions.bookmark],
    [s.shortcuts.mini, actions.mini],
  ];
  for (const [accel, fn] of map) {
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, fn)) shortcutErrors.push(accel);
    } catch {
      shortcutErrors.push(accel);
    }
  }
}

// ------------------------------------------------------------------ IPC
type Handler = (e: IpcMainInvokeEvent, ...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
const handle = (channel: string, fn: Handler) => ipcMain.handle(channel, fn);

function wireIpc() {
  handle('info', () => ({
    platform: process.platform,
    material: isMac || isWin11,
    version: app.getVersion(),
    locale: app.getLocale(),
    accent: accentColor(),
    storageDir: store.root,
    shortcutErrors,
  }));

  handle('settings:get', () => settings().get());
  handle('settings:set', (_e, patch: Partial<Settings>) => {
    const before = settings().get();
    if (patch.storageDir && patch.storageDir !== before.storageDir && (recorder.state.meetingId || recorder.busyTranscribing)) {
      throw new Error(t('Impossible de changer de dossier pendant un enregistrement ou une transcription en cours.'));
    }
    if (patch.privacyMode !== undefined && patch.privacyMode !== before.privacyMode) {
      if (recorder.state.meetingId) throw new Error(t('Terminez la réunion en cours avant de changer de mode.'));
      if (patch.privacyMode) {
        const st = localStatus();
        const model = patch.localModel ?? before.localModel;
        if (!st.supported) throw new Error(t('Le mode confidentiel est proposé sous Windows.'));
        if (!st.engine || !st.models[model]) throw new Error(t('Téléchargez d’abord le moteur de transcription local.'));
      }
    }
    const next = settings().set(patch);
    if (patch.privacyMode !== undefined) {
      setPrivacy(next.privacyMode);
      if (!next.privacyMode) stopLocal();
      if (next.privacyMode) purgeExpired();
    }
    if (patch.retentionDays !== undefined) purgeExpired();
    if (patch.storageDir && patch.storageDir !== before.storageDir) {
      store.load(next.storageDir);
      broadcast('meetings');
    }
    if (patch.shortcuts) registerShortcuts(next);
    if (patch.miniHiddenFromCapture !== undefined) applyCompactPrivacy(next.miniHiddenFromCapture);
    if (patch.theme) nativeTheme.themeSource = next.theme;
    if (patch.uiLanguage) {
      setLang(resolveLang(next.uiLanguage, app.getLocale()));
      buildAppMenu(); // menu macOS construit une fois : reconstruit dans la nouvelle langue (la zone de notification suit plus bas)
    }
    if (patch.calendars) void calendar.sync();
    broadcast('settings', next);
    refreshTray();
    return next;
  });
  // ---------------------------------------------------------------- mode confidentiel
  // ---------------------------------------------------------------- signaler un problème
  handle('diag:report', (_e, input: { title?: string; what?: string; logs?: boolean }) => {
    const cfg = settings().get();
    const st = localStatus();
    const context = {
      'Langue des réunions': cfg.language,
      Transcription: cfg.privacyMode ? `locale (${cfg.localModel})` : cfg.sttModel,
      IA: cfg.privacyMode ? 'locale' : cfg.llmProvider,
      'Mode confidentiel': cfg.privacyMode,
      'Qui parle': cfg.voices,
      Thème: `${cfg.theme} / ${cfg.palette}`,
      Enregistrement: recorder.state.status,
      'Phrases en attente': recorder.state.queue,
      'Moteur local': st.supported ? (st.engine ? `installé (${Object.entries(st.models).filter(([, v]) => v).map(([k]) => k).join(', ') || 'sans modèle'})` : 'non installé') : undefined,
      'Mise à jour': updateState().status,
    };
    // (les libellés du contexte ci-dessus restent en français : diagnostic technique destiné au développeur)
    const what = (input.what ?? '').trim() || `_${t('(non précisé)')}_`;
    const logs = input.logs === false ? '' : diagnostics(context);
    const text = [`**${t('Que s’est-il passé ?')}**`, what, '', logs].join('\n').trim();
    const title = (input.title ?? '').trim() || t('Problème signalé depuis l’app');
    // l'adresse du ticket a une taille limite : au-delà, le journal complet passe par le presse-papiers
    const base = `https://github.com/adrbn/minute/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=`;
    let body = text;
    let truncated = false;
    if (encodeURIComponent(body).length > 6500) {
      truncated = true;
      body = [
        `**${t('Que s’est-il passé ?')}**`,
        what,
        '',
        `_${t('Le journal technique complet a été copié par Minute : collez-le ici (Ctrl+V).')}_`,
        '',
      ].join('\n');
    }
    return { text, url: base + encodeURIComponent(body), truncated };
  });
  handle('updates:state', () => updateState());
  handle('updates:check', () => checkForUpdates(true));
  handle('updates:install', () => {
    if (recorder.state.meetingId) throw new Error(t('Terminez la réunion en cours avant de mettre à jour.'));
    installUpdate();
  });
  handle('local:status', () => localStatus());
  handle('local:install', async (_e, model: LocalModel) => {
    if (settings().get().privacyMode) throw new Error(t('Le téléchargement se fait avant d’activer le mode confidentiel.'));
    await installLocal(model === 'small' ? 'small' : 'turbo');
    return localStatus();
  });
  handle('local:remove', (_e, model: LocalModel) => {
    if (settings().get().privacyMode && settings().get().localModel === model) throw new Error(t('Modèle utilisé par le mode confidentiel.'));
    removeLocalModel(model);
    return localStatus();
  });
  handle('local:llm', () => findLocalLlm());
  handle('privacy:notice', () => {
    const cfg = settings().get();
    return participantNotice(cfg.privacyMode, cfg.meName);
  });
  handle('settings:chooseStorageDir', async (e) => {
    const { dialog } = await import('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[], defaultPath: store.root };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : res.filePaths[0];
  });

  handle('secrets:status', () => settings().secretStatus());
  handle('secrets:set', (_e, name: SecretName, value: string) => {
    settings().setSecret(name, value);
    if (name === 'groq') recorder.unblock();
    broadcast('settings', settings().get());
  });
  handle('secrets:test', async (_e, name: SecretName) => {
    try {
      if (name === 'groq') {
        const key = settings().secret('groq');
        if (!key) return { ok: false, message: t('Aucune clé') };
        // une seconde de silence : vérifie la clé ET l'accès à Whisper
        await transcribe(key, pcm16ToWav(Buffer.alloc(32000)), { model: settings().get().sttModel, language: 'fr', prompt: '' });
        return { ok: true, message: t('Clé valide — Whisper répond.') };
      }
      const models = await listModels(name as LlmProvider);
      const n = models.length;
      return { ok: true, message: n > 1 ? t('Clé valide — {n} modèles disponibles.', { n }) : t('Clé valide — {n} modèle disponible.', { n }) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  handle('secrets:listModels', async (_e, p: LlmProvider) => {
    try {
      return await listModels(p);
    } catch {
      return [];
    }
  });

  handle('meetings:list', () => store.list());
  handle('meetings:get', (_e, id: string) => {
    const meta = store.meta(id);
    return meta ? { meta, segments: store.segments(id) } : null;
  });
  handle('meetings:update', (_e, id: string, patch) => {
    if (patch?.hasAudio === false) store.deleteAudio(id);
    const m = store.update(id, patch);
    broadcast('meetings');
    return m;
  });
  // ---------------------------------------------------------------- fusionner / séparer
  /** Déplace les extraits audio (et les empreintes de voix) d'une réunion à l'autre. */
  const moveAssets = (from: string, to: string, segs: Segment[]) => {
    for (const s of segs) {
      if (!s.audio) continue;
      const src = store.audioFile(from, s.audio);
      const dst = store.audioFile(to, s.audio);
      try {
        if (src && dst && existsSync(src)) renameSync(src, dst);
      } catch (e) {
        logError(`fusion audio ${s.audio}`, e);
      }
    }
    const fromDir = store.dir(from);
    const toDir = store.dir(to);
    const prints = fromDir && join(fromDir, 'voices.jsonl');
    if (!prints || !toDir || !existsSync(prints)) return;
    const ids = new Set(segs.map((s) => s.id));
    const lines = readFileSync(prints, 'utf8')
      .split('\n')
      .filter((l) => {
        const m = /"id":"([^"]+)"/.exec(l);
        return m && ids.has(m[1]);
      });
    if (lines.length) appendFileSync(join(toDir, 'voices.jsonl'), lines.join('\n') + '\n', 'utf8');
  };
  handle('meetings:merge', async (_e, idA: string, idB: string) => {
    const ma = store.meta(idA);
    const mb = store.meta(idB);
    if (!ma || !mb || idA === idB) throw new Error(t('Réunions introuvables.'));
    if (recorder.busyWith(idA) || recorder.busyWith(idB)) throw new Error(t('Une des réunions est encore en cours : attendez la fin de la transcription.'));
    const [a, b] = ma.startedAt <= mb.startedAt ? [ma, mb] : [mb, ma];
    const bSegs = store.segments(b.id);
    const plan = planMerge(a, store.segments(a.id), b, bSegs);
    moveAssets(b.id, a.id, bSegs);
    store.writeSegments(a.id, plan.segments);
    store.update(a.id, plan.patch);
    store.refreshStats(a.id);
    await store.remove(b.id);
    broadcast('meetings');
    return a.id;
  });
  handle('meetings:split', (_e, id: string, segId: string) => {
    const meta = store.meta(id);
    if (!meta) throw new Error(t('Réunion introuvable.'));
    if (recorder.busyWith(id)) throw new Error(t('Réunion en cours : attendez la fin de la transcription.'));
    const plan = planSplit(meta, store.segments(id), segId, newId());
    store.create(plan.newMeta);
    store.writeSegments(plan.newMeta.id, plan.move);
    moveAssets(id, plan.newMeta.id, plan.move);
    store.writeSegments(id, plan.keep);
    store.update(id, plan.keepPatch);
    store.refreshStats(id);
    store.refreshStats(plan.newMeta.id);
    broadcast('meetings');
    return plan.newMeta.id;
  });
  /** Suppression pour de bon : les derniers extraits partent avec la réunion ; on attend ceux déjà envoyés. */
  const purge = async (id: string) => {
    if (recorder.state.meetingId === id) await recorder.stop();
    recorder.forget(id);
    for (let i = 0; i < 100 && recorder.busyWith(id); i++) await new Promise((r) => setTimeout(r, 100));
    store.removePermanently(id);
  };
  handle('meetings:remove', async (_e, id: string) => {
    await purge(id);
    broadcast('meetings');
  });
  // corbeille de Minute : la réunion sort des listes et reste récupérable 30 jours
  handle('meetings:trash', async (_e, id: string) => {
    if (recorder.state.meetingId === id) await recorder.stop();
    store.update(id, { deletedAt: Date.now(), pinned: false });
    broadcast('meetings');
  });
  handle('meetings:restore', (_e, id: string) => {
    store.update(id, { deletedAt: undefined });
    broadcast('meetings');
  });
  handle('meetings:purge', async (_e, id: string) => {
    await purge(id);
    broadcast('meetings');
  });
  handle('meetings:emptyTrash', async () => {
    const trashed = store.list().filter((m) => m.deletedAt);
    for (const m of trashed) await purge(m.id);
    broadcast('meetings');
    return trashed.length;
  });
  handle('meetings:editSegment', (_e, id: string, segId: string, text: string) => {
    const seg = store.segments(id).find((s) => s.id === segId);
    if (!seg) return;
    const next = { ...seg, text: text.trim(), edited: true };
    store.putSegment(id, next);
    // on apprend la correction pour les prochaines transcriptions
    const learned = learnFromEdit(seg.text, next.text);
    if (learned.length) {
      const cfg = settings().get();
      const vocab = vocabularyList(cfg.vocabulary);
      for (const l of learned) if (!vocab.some((v) => v.toLowerCase() === l.to.toLowerCase())) vocab.push(l.to);
      const updated = settings().set({ learned: mergeLearned(cfg.learned, learned), vocabulary: vocab.join(', ') });
      broadcast('settings', updated);
      toast(t('Appris : « {from} » → « {to} »', { from: learned[0].from, to: learned[0].to }), 'success');
    }
    broadcast('live', { type: 'segment', meetingId: id, segment: next });
  });
  handle('meetings:deleteSegment', (_e, id: string, segId: string) => {
    store.removeSegment(id, segId);
    broadcast('live', { type: 'remove', meetingId: id, id: segId });
  });
  handle('meetings:reveal', (_e, id: string) => {
    const d = store.dir(id);
    if (d) shell.showItemInFolder(`${d}/meeting.json`);
  });
  handle('meetings:export', (e, id: string, format: 'md' | 'txt' | 'docx') =>
    exportMeeting(id, format, BrowserWindow.fromWebContents(e.sender)),
  );
  handle('meetings:copy', (_e, id: string, opts) => copyMeeting(id, opts, settings().get().copyWithTimestamps));
  handle('meetings:search', (_e, q: string) => store.search(q));
  handle('meetings:retry', (_e, id: string) => recorder.retryMeeting(id));

  handle('recorder:state', () => recorder.state);
  handle('recorder:start', async (e, opts?: { title?: string; eventId?: string }) => {
    const fromCompact = e.sender !== getMain()?.webContents;
    const event = opts?.eventId ? calendar.events.find((x) => x.id === opts.eventId) : opts?.title ? null : calendar.current();
    const r = await recorder.start({ title: opts?.title, event });
    if (r.ok && !fromCompact) maybeCompactOnStart(false);
    return r;
  });
  handle('recorder:stop', () => recorder.stop());
  handle('recorder:pause', () => recorder.pause());
  handle('recorder:resume', () => recorder.resume());
  handle('recorder:bookmark', (_e, label?: string) => recorder.bookmark(label));

  handle('ai:run', (_e, req: AiRequest) =>
    runAi(req, (ev) => {
      broadcast('ai', ev);
      if (ev.done && (ev.kind === 'summary' || ev.kind === 'followup')) broadcast('meetings');
    }),
  );
  handle('ai:cancel', (_e, id: string) => cancelAi(id));

  handle('compact:toggle', () => toggleCompact());
  handle('compact:enter', () => enterCompact());
  handle('compact:exit', (_e, opts?: { showMain?: boolean; meetingId?: string }) => {
    exitCompact({ showMain: opts?.showMain });
    if (opts?.meetingId) broadcast('navigate', { meetingId: opts.meetingId });
  });
  handle('compact:shape', (_e, shape: 'pill' | 'panel') => setCompactShape(shape));
  handle('compact:layout', () => compactLayout());
  // Réglages depuis la Dynamic Island : on quitte l'île, la fenêtre revient, puis la feuille s'ouvre
  // (une fois la page prête, si la fenêtre vient d'être recréée).
  handle('windows:settings', (_e, section?: string) => {
    if (isCompact()) exitCompact({ showMain: true });
    const w = showMain();
    const send = () => w.webContents.send('navigate', { view: 'settings', section: typeof section === 'string' ? section : undefined });
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(send, 120));
    else send();
  });
  handle('windows:showMain', (_e, meetingId?: string) => {
    showMain();
    if (meetingId) broadcast('navigate', { meetingId });
  });
  handle('windows:openExternal', (_e, url: string) => {
    if (/^(https?:|ms-settings:|x-apple\.systempreferences:)/.test(url)) void shell.openExternal(url);
  });
  handle('windows:privacy', (_e, kind: 'microphone' | 'audio') => {
    if (isMac) openMacPrivacy(kind);
    else void shell.openExternal('ms-settings:privacy-microphone');
  });

  handle('calendar:state', () => calendarState());
  handle('calendar:refresh', async () => {
    await calendar.sync();
    return calendarState();
  });
  handle('calendar:test', async (_e, url: string) => {
    try {
      const events = await fetchCalendar({ name: 'test', url });
      const soon = events.filter((ev) => ev.end > Date.now()).length;
      return {
        ok: true,
        message:
          soon > 1
            ? t('Agenda lu — {n} réunions à venir cette semaine.', { n: soon })
            : t('Agenda lu — {n} réunion à venir cette semaine.', { n: soon }),
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  handle('calendar:googleClient', () => {
    const c = googleClient();
    return { configured: !!c, builtIn: !!c?.builtIn, id: c?.id ?? '' };
  });
  handle('calendar:setGoogleClient', (_e, id: string, secret: string) => {
    settings().vault('googleClient', id.trim() ? JSON.stringify({ id: id.trim(), secret: secret.trim() }) : null);
  });
  handle('calendar:connectGoogle', async () => {
    const client = googleClient();
    if (!client) return { ok: false, message: t('Identifiants OAuth Google manquants (Réglages › Agenda › Avancé).') };
    try {
      const { refreshToken, email } = await googleSignIn(client);
      const key = `google:${email}`;
      settings().vault(key, refreshToken);
      const cals = settings().get().calendars.filter((c) => c.url !== key);
      const next = settings().set({ calendars: [...cals, { kind: 'google', name: email, url: key }] });
      broadcast('settings', next);
      showMain();
      await calendar.sync();
      const n = calendar.upcoming(Date.now(), 50).length;
      return {
        ok: true,
        message: n > 1 ? t('{email} connecté — {n} réunions à venir.', { email, n }) : t('{email} connecté — {n} réunion à venir.', { email, n }),
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  handle('calendar:disconnect', async (_e, url: string) => {
    const token = settings().vault(url);
    if (token && url.startsWith('google:')) await revokeGoogle(token);
    if (token) settings().vault(url, null);
    const next = settings().set({ calendars: settings().get().calendars.filter((c) => c.url !== url) });
    broadcast('settings', next);
    await calendar.sync();
  });

  handle('vocabulary:suggestions', () => {
    const cfg = settings().get();
    const recent = store
      .list()
      .slice(0, 40)
      .map((meta) => ({ meta, segments: store.segments(meta.id) }));
    return suggestTerms(recent, cfg.vocabulary, cfg.learned);
  });

  handle('natively:detect', () => detectNatively());
  handle('natively:import', () => {
    const r = importNatively();
    broadcast('meetings');
    return r;
  });

  // --- moteur audio (fenêtre invisible)
  const fromEngine = (e: Electron.IpcMainEvent) => e.sender.id === engineWebContentsId();
  ipcMain.on('engine:segment', (e, s: EngineSegment) => fromEngine(e) && recorder.onEngineSegment(s));
  ipcMain.on('engine:levels', (e, l: Levels) => fromEngine(e) && recorder.levels(l));
  ipcMain.on('engine:status', (e, ch, ok, error) => fromEngine(e) && recorder.channelStatus(ch, ok, error));
  ipcMain.on('engine:stopped', (e) => fromEngine(e) && recorder.engineStopped());
  ipcMain.on('engine:log', (e, msg: string) => {
    if (!fromEngine(e)) return;
    console.log('[engine]', msg);
    diagLog('moteur', String(msg));
  });
}

/** Menu d'application : complet et traduit sur macOS (reconstruit si la langue change), absent sous Windows. */
function buildAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const go = (view: string) => {
    showMain();
    broadcast('navigate', { view });
  };
  // Mots qui ont un autre sens ailleurs dans l'app (« Annuler » = Cancel, « Réduire » = Minimize) :
  // clé « menu:… » pour les traductions, texte français inchangé.
  const menuLabel = (fr: string) => {
    const key = `menu:${fr}`;
    const s = t(key);
    return s === key ? fr : s;
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Minute',
        submenu: [
          { role: 'about', label: t('À propos de Minute') },
          { type: 'separator' },
          { label: t('Réglages…'), accelerator: 'Command+,', click: () => go('settings') },
          { type: 'separator' },
          { role: 'hide', label: t('Masquer Minute') },
          { role: 'hideOthers', label: t('Masquer les autres') },
          { role: 'unhide', label: t('Tout afficher') },
          { type: 'separator' },
          { role: 'quit', label: t('Quitter Minute') },
        ],
      },
      {
        label: t('Fichier'),
        submenu: [
          { label: t('Nouvelle réunion'), accelerator: 'Command+N', click: () => go('new') },
          { label: t('Démarrer / arrêter l’enregistrement'), click: () => void actions.toggleRecord() },
          { type: 'separator' },
          { role: 'close', label: t('Fermer la fenêtre') },
        ],
      },
      {
        label: t('Édition'),
        submenu: [
          { role: 'undo', label: menuLabel('Annuler') },
          { role: 'redo', label: t('Rétablir') },
          { type: 'separator' },
          { role: 'cut', label: t('Couper') },
          { role: 'copy', label: t('Copier') },
          { role: 'paste', label: t('Coller') },
          { role: 'selectAll', label: t('Tout sélectionner') },
          { type: 'separator' },
          { label: t('Rechercher dans toutes les réunions'), accelerator: 'Command+Shift+F', click: () => go('search') },
        ],
      },
      {
        label: t('Présentation'),
        submenu: [
          { label: t('Mode compact'), click: () => toggleCompact() },
          { type: 'separator' },
          { role: 'resetZoom', label: t('Taille réelle') },
          { role: 'zoomIn', label: menuLabel('Agrandir') },
          { role: 'zoomOut', label: menuLabel('Réduire') },
          { type: 'separator' },
          { role: 'togglefullscreen', label: t('Plein écran') },
        ],
      },
      { role: 'windowMenu', label: t('Fenêtre') },
    ]),
  );
}

function accentColor(): string {
  try {
    if (isMac || process.platform === 'win32') return `#${systemPreferences.getAccentColor().slice(0, 6)}`;
  } catch {
    /* pas de couleur système */
  }
  return '#0a84ff';
}

// ------------------------------------------------------------------ démarrage
app.on('second-instance', () => showMain());

app.whenReady().then(() => {
  const cfg = settings().get();
  setLang(resolveLang(cfg.uiLanguage, app.getLocale()));
  nativeTheme.themeSource = cfg.theme;
  store.load(cfg.storageDir);
  store.purgeOldAudio(cfg.keepAudioDays);
  // mode confidentiel : verrou réseau posé avant toute fenêtre, réunions expirées supprimées
  installNetworkGuard();
  setPrivacy(cfg.privacyMode);
  purgeExpired();
  setInterval(purgeExpired, 6 * 3600_000);
  onLocalStatus((s) => broadcast('localStatus', s));
  initUpdater({
    notify: (s) => broadcast('update', s),
    enabled: () => ({ auto: settings().get().autoUpdate, privacy: settings().get().privacyMode }),
  });

  // Interface servie depuis app://minute/ (fetch, WASM et worklets s'y comportent comme sur le web)
  const rendererRoot = resolve(paths.renderer());
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = resolve(rendererRoot, `.${decodeURIComponent(pathname)}`);
    const rel = relative(rendererRoot, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) return new Response('introuvable', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Lecture des extraits audio : minute-audio://m/<réunion>/<fichier>
  protocol.handle('minute-audio', (req) => {
    const url = new URL(req.url);
    const [, meetingId, file] = url.pathname.split('/');
    const path = store.audioFile(decodeURIComponent(meetingId ?? ''), decodeURIComponent(file ?? ''));
    if (!path || !existsSync(path)) return new Response('introuvable', { status: 404 });
    return net.fetch(pathToFileURL(path).toString());
  });

  // Son de l'ordinateur sous Windows : boucle système fournie par Chromium, sans sélecteur.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const fromEngine = request.frame?.url?.includes('engine.html');
      if (!fromEngine) return callback({});
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {});
      });
    },
    { useSystemPicker: false },
  );
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const local = wc.getURL().startsWith('app://minute/');
    cb(local && ['media', 'display-capture', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
    ['media', 'clipboard-sanitized-write'].includes(permission) && (origin.startsWith('app://minute') || origin === ''),
  );

  wireIpc();
  buildAppMenu();
  registerShortcuts(cfg);
  settings().onChange(() => {
    refreshTray();
    applyLoginItem();
  });
  applyLoginItem();
  createTray({
    compact: isCompact,
    recording: () => {
      const s = recorder.state.status;
      return s === 'recording' || s === 'paused' ? s : s === 'idle' ? 'idle' : 'busy';
    },
    toggleRecord: () => void actions.toggleRecord(),
    pauseResume: actions.pauseResume,
    bookmark: actions.bookmark,
    copy: () => void actions.copy(),
    mini: actions.mini,
    report: () => {
      const w = showMain();
      const send = () => w.webContents.send('navigate', { view: 'report' });
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(send, 120));
      else send();
    },
    quit: () => app.quit(),
  });
  createMain();
  initCompact();
  onCompactChange((active) => {
    broadcast('compact', active);
    refreshTray();
  });
  setEngineCrashHandler(() => void recorder.onEngineCrash());
  // pendant une réunion, réduire la fenêtre = passer en Dynamic Island
  setOnMinimize(() => {
    if (!recorder.state.meetingId || !settings().get().minimizeToCompact) return false;
    enterCompact();
    return true;
  });
  // pendant une réunion, cliquer dans une autre application fait place à la Dynamic Island
  setOnBackground(() => {
    if (!recorder.state.meetingId || !settings().get().autoCompact || isCompact()) return;
    setTimeout(() => {
      const w = getMain();
      if (!w || w.isDestroyed() || w.isFocused() || !w.isVisible() || w.isMinimized() || !w.isEnabled()) return;
      // le premier plan est passé à une autre fenêtre de Minute (dialogue, outils) : on ne bouge pas
      if (BrowserWindow.getFocusedWindow() || w.webContents.isDevToolsFocused()) return;
      if (!recorder.state.meetingId || isCompact()) return;
      enterCompact({ animate: true });
    }, 400);
  });
  calendar.start();
  setInterval(checkReminders, 20_000);
  startMeetingDetector(() => settings().get().meetingDetection, { started: onMeetingAppStarted, ended: onMeetingAppEnded });
  void ensureEngine().catch(() => undefined);
  recorder.recover();

  app.on('activate', () => showMain());
});

let quitHandled = false;
app.on('before-quit', (e) => {
  setQuitting();
  if (quitHandled) return;
  if (recorder.state.status === 'recording' || recorder.state.status === 'paused') {
    e.preventDefault();
    quitHandled = true;
    void recorder.stop().finally(() => app.quit());
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  /* Minute reste dans la barre des menus / zone de notification */
});
