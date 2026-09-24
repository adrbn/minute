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
import { appendFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AiRequest, CalendarEvent, EngineSegment, Levels, LlmProvider, SecretName, Settings } from '../shared/types';
import { cancelAi, runAi } from './ai';
import { CalendarService, fetchCalendar } from './calendar';
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
import { store } from './store';
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
}
process.on('uncaughtException', (err) => logError('uncaughtException', err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('fr.minute.app');

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
    if (!meta || meta.summary || !settings().get().autoSummary || meta.wordCount < 40) return;
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
      const n = new Notification({ title: 'On parle de vous', body: `« ${text.slice(0, 140)} »`, silent: false });
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
const calendar = new CalendarService(
  () => settings().get().calendars,
  () => broadcast('calendar', calendarState()),
);
const calendarState = () => ({ events: calendar.upcoming(Date.now(), 12), errors: calendar.errors, lastSync: calendar.lastSync });

/** Démarre depuis l'agenda, une notification ou un raccourci, avec le contexte de la réunion en cours. */
async function startFromContext(opts: { event?: CalendarEvent | null; inBackground: boolean }) {
  if (recorder.state.status !== 'idle') return;
  const r = await recorder.start({ event: opts.event ?? calendar.current() });
  if (!r.ok) {
    showMain();
    toast(r.error ?? 'Impossible de démarrer', 'error');
    return;
  }
  broadcast('navigate', { meetingId: recorder.state.meetingId ?? undefined });
  if (!maybeCompactOnStart(opts.inBackground)) notify('Transcription démarrée', 'Minute transcrit la réunion en direct.');
}

function notifyAction(title: string, body: string, onClick: () => void) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', onClick);
  n.show();
}

const reminded = new Set<string>();
function checkReminders() {
  if (!settings().get().calendarReminders || recorder.state.status !== 'idle') return;
  const now = Date.now();
  for (const ev of calendar.upcoming(now, 4)) {
    if (reminded.has(ev.id)) continue;
    if (ev.start - now <= 60_000 && now - ev.start < 5 * 60_000) {
      reminded.add(ev.id);
      notifyAction(`« ${ev.title} » commence`, 'Cliquez pour transcrire la réunion.', () => void startFromContext({ event: ev, inBackground: true }));
    }
  }
}

let detectedSnooze = 0;
function onMeetingAppStarted(app: string) {
  if (recorder.state.status !== 'idle' || Date.now() < detectedSnooze) return;
  const ev = calendar.current();
  detectedSnooze = Date.now() + 90_000;
  notifyAction(
    ev ? `« ${ev.title} » a commencé` : 'Visio détectée',
    `${app[0].toUpperCase()}${app.slice(1)} utilise votre micro — cliquez pour transcrire.`,
    () => void startFromContext({ event: ev, inBackground: true }),
  );
}
function onMeetingAppEnded(app: string) {
  if (recorder.state.status !== 'recording') return;
  notifyAction('La visio semble terminée', `${app[0].toUpperCase()}${app.slice(1)} n’utilise plus le micro — cliquez pour arrêter la transcription.`, () =>
    void recorder.stop(),
  );
}

// ------------------------------------------------------------------ actions communes (UI, menu, raccourcis)
const actions = {
  async toggleRecord() {
    const st = recorder.state.status;
    if (st === 'idle') {
      await startFromContext({ inBackground: !BrowserWindow.getFocusedWindow() });
    } else if (st === 'recording' || st === 'paused') {
      await recorder.stop();
      notify('Réunion enregistrée', 'Le compte-rendu se prépare.');
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
    if (!id) return notify('Rien à copier pour l’instant');
    const { words } = await copyMeeting(id, { range: 'all' }, settings().get().copyWithTimestamps);
    notify('Transcription copiée', `${words.toLocaleString('fr-FR')} mots dans le presse-papiers.`);
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
    accent: accentColor(),
    storageDir: store.root,
    shortcutErrors,
  }));

  handle('settings:get', () => settings().get());
  handle('settings:set', (_e, patch: Partial<Settings>) => {
    const before = settings().get();
    if (patch.storageDir && patch.storageDir !== before.storageDir && (recorder.state.meetingId || recorder.busyTranscribing)) {
      throw new Error('Impossible de changer de dossier pendant un enregistrement ou une transcription en cours.');
    }
    const next = settings().set(patch);
    if (patch.storageDir && patch.storageDir !== before.storageDir) {
      store.load(next.storageDir);
      broadcast('meetings');
    }
    if (patch.shortcuts) registerShortcuts(next);
    if (patch.miniHiddenFromCapture !== undefined) applyCompactPrivacy(next.miniHiddenFromCapture);
    if (patch.theme) nativeTheme.themeSource = next.theme;
    if (patch.calendars) void calendar.sync();
    broadcast('settings', next);
    refreshTray();
    return next;
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
        if (!key) return { ok: false, message: 'Aucune clé' };
        // une seconde de silence : vérifie la clé ET l'accès à Whisper
        await transcribe(key, pcm16ToWav(Buffer.alloc(32000)), { model: settings().get().sttModel, language: 'fr', prompt: '' });
        return { ok: true, message: 'Clé valide — Whisper répond.' };
      }
      const models = await listModels(name as LlmProvider);
      return { ok: true, message: `Clé valide — ${models.length} modèles disponibles.` };
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
  handle('meetings:remove', async (_e, id: string) => {
    if (recorder.state.meetingId === id) await recorder.stop();
    await store.remove(id);
    broadcast('meetings');
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
      toast(`Appris : « ${learned[0].from} » → « ${learned[0].to} »`, 'success');
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
      return { ok: true, message: `Agenda lu — ${soon} réunion${soon > 1 ? 's' : ''} à venir cette semaine.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
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
  ipcMain.on('engine:log', (e, msg: string) => fromEngine(e) && console.log('[engine]', msg));
}

/** Menu d'application : complet et en français sur macOS, absent sous Windows. */
function buildAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const go = (view: string) => {
    showMain();
    broadcast('navigate', { view });
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Minute',
        submenu: [
          { role: 'about', label: 'À propos de Minute' },
          { type: 'separator' },
          { label: 'Réglages…', accelerator: 'Command+,', click: () => go('settings') },
          { type: 'separator' },
          { role: 'hide', label: 'Masquer Minute' },
          { role: 'hideOthers', label: 'Masquer les autres' },
          { role: 'unhide', label: 'Tout afficher' },
          { type: 'separator' },
          { role: 'quit', label: 'Quitter Minute' },
        ],
      },
      {
        label: 'Fichier',
        submenu: [
          { label: 'Nouvelle réunion', accelerator: 'Command+N', click: () => go('new') },
          { label: 'Démarrer / arrêter l’enregistrement', click: () => void actions.toggleRecord() },
          { type: 'separator' },
          { role: 'close', label: 'Fermer la fenêtre' },
        ],
      },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo', label: 'Annuler' },
          { role: 'redo', label: 'Rétablir' },
          { type: 'separator' },
          { role: 'cut', label: 'Couper' },
          { role: 'copy', label: 'Copier' },
          { role: 'paste', label: 'Coller' },
          { role: 'selectAll', label: 'Tout sélectionner' },
          { type: 'separator' },
          { label: 'Rechercher dans toutes les réunions', accelerator: 'Command+Shift+F', click: () => go('search') },
        ],
      },
      {
        label: 'Présentation',
        submenu: [
          { label: 'Mode compact', click: () => toggleCompact() },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Taille réelle' },
          { role: 'zoomIn', label: 'Agrandir' },
          { role: 'zoomOut', label: 'Réduire' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
      { role: 'windowMenu', label: 'Fenêtre' },
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
  nativeTheme.themeSource = cfg.theme;
  store.load(cfg.storageDir);
  store.purgeOldAudio(cfg.keepAudioDays);

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
  settings().onChange(() => refreshTray());
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
    quit: () => app.quit(),
  });
  createMain();
  initCompact();
  onCompactChange((active) => {
    broadcast('compact', active);
    refreshTray();
  });
  setEngineCrashHandler(() => void recorder.onEngineCrash());
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
