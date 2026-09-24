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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AiRequest, EngineSegment, Levels, LlmProvider, SecretName, Settings } from '../shared/types';
import { cancelAi, runAi } from './ai';
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
  applyMiniPrivacy,
  createMain,
  createTray,
  engineSend,
  engineStart,
  engineWebContentsId,
  ensureEngine,
  isWin11,
  paths,
  refreshTray,
  setQuitting,
  showMain,
  toggleMini,
} from './windows';

const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'minute-audio', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } },
]);

// Profil isolé (tests / développement) : MINUTE_PROFILE_DIR=… npm start
if (process.env.MINUTE_PROFILE_DIR) app.setPath('userData', process.env.MINUTE_PROFILE_DIR);

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
    await ensureEngine(() => {
      if (recorder.state.status !== 'idle') recorder.channelStatus('me', false, 'Le moteur audio s’est arrêté');
    });
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
  showMini: () => toggleMini(true),
  showMain: (id) => {
    showMain();
    if (id) broadcast('navigate', { meetingId: id });
  },
});

// ------------------------------------------------------------------ actions communes (UI, menu, raccourcis)
const actions = {
  async toggleRecord() {
    const st = recorder.state.status;
    if (st === 'idle') {
      const r = await recorder.start();
      if (!r.ok) {
        showMain();
        toast(r.error ?? 'Impossible de démarrer', 'error');
      } else {
        notify('Enregistrement démarré', 'Minute transcrit la réunion en direct.');
        broadcast('navigate', { meetingId: recorder.state.meetingId ?? undefined });
      }
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
    toggleMini();
  },
};

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
    const next = settings().set(patch);
    if (patch.storageDir && patch.storageDir !== before.storageDir) {
      store.load(next.storageDir);
      broadcast('meetings');
    }
    if (patch.shortcuts) registerShortcuts(next);
    if (patch.miniHiddenFromCapture !== undefined) applyMiniPrivacy(next.miniHiddenFromCapture);
    if (patch.theme) nativeTheme.themeSource = next.theme;
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
  handle('recorder:start', async (_e, opts) => {
    const r = await recorder.start(opts);
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

  handle('windows:toggleMini', () => toggleMini());
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
          { label: 'Mini-fenêtre', click: () => toggleMini() },
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
    if (!file.startsWith(rendererRoot) || !existsSync(file)) return new Response('introuvable', { status: 404 });
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
  void ensureEngine(() => undefined);
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
