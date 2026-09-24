import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import { join } from 'node:path';
import { release } from 'node:os';
import { settings } from './settings';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
export const isWin11 = isWin && Number(release().split('.')[2] ?? 0) >= 22000;

export const paths = {
  preload: () => join(__dirname, '..', 'preload', 'preload.cjs'),
  enginePreload: () => join(__dirname, '..', 'preload', 'engine.cjs'),
  renderer: () => join(__dirname, '..', 'renderer'),
  page: (name: string) => `app://minute/${name}.html`,
  icons: () => (app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons')),
};

let main: BrowserWindow | null = null;
let engine: BrowserWindow | null = null;
let engineReady: Promise<void> | null = null;
let onEngineCrash: () => void = () => undefined;
let extraWindows: () => BrowserWindow[] = () => [];
let beforeShowMain: () => void = () => undefined;
let onMinimize: () => boolean = () => false;
/** Réduire la fenêtre pendant une réunion peut ouvrir la Dynamic Island à la place. */
export const setOnMinimize = (fn: () => boolean) => (onMinimize = fn);

export const registerExtraWindows = (fn: () => BrowserWindow[]) => (extraWindows = fn);
export const setBeforeShowMain = (fn: () => void) => (beforeShowMain = fn);
export const setEngineCrashHandler = (fn: () => void) => (onEngineCrash = fn);
let tray: Tray | null = null;
export let quitting = false;
export function setQuitting() {
  quitting = true;
}

export function secureWeb(win: BrowserWindow) {
  // Liens externes → navigateur ; jamais de navigation dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://minute/')) e.preventDefault();
  });
}

const overlaySymbols = () => (nativeTheme.shouldUseDarkColors ? '#f5f5f7' : '#1d1d1f');

export function getMain() {
  return main && !main.isDestroyed() ? main : null;
}
export function allUiWindows(): BrowserWindow[] {
  return [getMain(), ...extraWindows()].filter((w): w is BrowserWindow => !!w);
}

export function createMain(): BrowserWindow {
  if (getMain()) return main!;
  // « mainBounds2 » : les tailles mémorisées avant la v0.3 (trop grandes par défaut) sont ignorées
  const bounds = settings().appState<{ x: number; y: number; width: number; height: number }>('mainBounds2');
  main = new BrowserWindow({
    width: bounds?.width ?? 1000,
    height: bounds?.height ?? 680,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 600,
    minHeight: 460,
    show: false,
    title: 'Minute',
    icon: isWin ? join(paths.icons(), 'app.png') : undefined,
    backgroundColor: isMac || isWin11 ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: overlaySymbols(), height: 48 },
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundMaterial: isWin11 ? 'mica' : undefined,
    webPreferences: {
      preload: paths.preload(),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  // Barre des tâches Windows : sans raccourci installé (lancement de développement via electron.exe),
  // Windows affiche l'icône d'Electron ; on lui donne explicitement celle de Minute.
  if (isWin) {
    main.setAppDetails({
      appId: 'fr.minute.app',
      appIconPath: app.isPackaged ? process.execPath : join(app.getAppPath(), 'build', 'icon.ico'),
      appIconIndex: 0,
    });
  }
  secureWeb(main);
  void main.loadURL(paths.page('index'));
  main.once('ready-to-show', () => main?.show());
  const saveBounds = () => {
    if (main && !main.isMinimized() && !main.isMaximized()) settings().appState('mainBounds2', main.getBounds());
  };
  main.on('resized', saveBounds);
  main.on('moved', saveBounds);
  main.on('minimize', () => {
    if (onMinimize()) main?.hide();
  });
  main.on('close', (e) => {
    if (quitting) return;
    // Minute reste disponible (barre des menus / zone de notification) : la fermeture masque.
    e.preventDefault();
    main?.hide();
    if (isWin && !settings().appState('trayHintShown')) {
      settings().appState('trayHintShown', true);
      tray?.displayBalloon({
        title: 'Minute reste à portée de main',
        content: 'L’app continue dans la zone de notification. Clic droit sur l’icône pour quitter.',
        iconType: 'info',
      });
    }
  });
  nativeTheme.on('updated', () => {
    if (!isMac && getMain()) main!.setTitleBarOverlay({ color: '#00000000', symbolColor: overlaySymbols(), height: 48 });
  });
  return main;
}

export function showMain() {
  beforeShowMain();
  const w = createMain();
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return w;
}

/** Fenêtre invisible qui possède les flux audio (indépendante de l'interface). */
export function ensureEngine(): Promise<void> {
  if (engine && !engine.isDestroyed() && engineReady) return engineReady;
  engine = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    webPreferences: {
      preload: paths.enginePreload(),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const self = engine;
  engineReady = new Promise<void>((resolve, reject) => {
    self.webContents.once('did-finish-load', () => resolve());
    self.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`Moteur audio : ${desc} (${code})`)));
    self.webContents.once('render-process-gone', () => reject(new Error('Le moteur audio s’est arrêté')));
  });
  engineReady.catch(() => undefined);
  self.webContents.on('render-process-gone', () => {
    if (engine === self) {
      engine = null;
      engineReady = null;
    }
    if (!self.isDestroyed()) self.destroy();
    onEngineCrash();
  });
  void engine.loadURL(paths.page('engine'));
  return engineReady;
}

/** Démarre la capture. Passe par executeJavaScript « avec geste utilisateur » :
 *  Chromium exige un geste pour getDisplayMedia (son de l'ordinateur). */
export async function engineStart(o: unknown): Promise<{ me: boolean; them: boolean }> {
  if (!engine || engine.isDestroyed()) throw new Error('Moteur audio indisponible');
  return engine.webContents.executeJavaScript(`window.__minuteStart(${JSON.stringify(o)})`, true);
}

export function engineSend(channel: string, payload?: unknown) {
  if (engine && !engine.isDestroyed()) engine.webContents.send(channel, payload);
}

export function engineWebContentsId(): number | null {
  return engine && !engine.isDestroyed() ? engine.webContents.id : null;
}

// ------------------------------------------------------------------ zone de notification
export interface TrayActions {
  recording: () => 'idle' | 'recording' | 'paused' | 'busy';
  compact: () => boolean;
  toggleRecord: () => void;
  pauseResume: () => void;
  bookmark: () => void;
  copy: () => void;
  mini: () => void;
  quit: () => void;
}

function trayImage(recording: boolean) {
  const dir = paths.icons();
  if (isMac) {
    const img = nativeImage.createFromPath(join(dir, recording ? 'trayRecTemplate.png' : 'trayTemplate.png'));
    img.setTemplateImage(!recording);
    return img;
  }
  return nativeImage.createFromPath(join(dir, recording ? 'tray-rec.png' : 'tray.png'));
}

let trayActions: TrayActions | null = null;

export function createTray(actions: TrayActions) {
  trayActions = actions;
  tray = new Tray(trayImage(false));
  tray.setToolTip('Minute');
  if (!isMac) tray.on('click', () => showMain());
  refreshTray();
}

export function refreshTray() {
  if (!tray || !trayActions) return;
  const a = trayActions;
  const state = a.recording();
  const sc = settings().get().shortcuts;
  const accel = (s: string) => s.replace('Control+Alt+Command', 'Ctrl+Alt+Cmd');
  tray.setImage(trayImage(state === 'recording' || state === 'paused'));
  tray.setToolTip(state === 'recording' ? 'Minute — enregistrement en cours' : state === 'paused' ? 'Minute — en pause' : 'Minute');
  const live = state === 'recording' || state === 'paused';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: live ? 'Arrêter l’enregistrement' : 'Démarrer une réunion',
        accelerator: accel(sc.toggleRecord),
        registerAccelerator: false,
        enabled: state !== 'busy',
        click: a.toggleRecord,
      },
      { label: state === 'paused' ? 'Reprendre' : 'Pause', enabled: live, click: a.pauseResume },
      { label: 'Marquer un moment', accelerator: accel(sc.bookmark), registerAccelerator: false, enabled: live, click: a.bookmark },
      { label: 'Copier la transcription', accelerator: accel(sc.copy), registerAccelerator: false, click: a.copy },
      { label: 'Mode compact', type: 'checkbox', checked: a.compact(), accelerator: accel(sc.mini), registerAccelerator: false, click: a.mini },
      { type: 'separator' },
      { label: 'Ouvrir Minute', click: () => showMain() },
      { label: 'Quitter Minute', click: a.quit },
    ]),
  );
}
