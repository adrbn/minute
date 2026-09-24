import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, shell, Tray } from 'electron';
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
let mini: BrowserWindow | null = null;
let engine: BrowserWindow | null = null;
let engineReady: Promise<void> | null = null;
let tray: Tray | null = null;
export let quitting = false;
export function setQuitting() {
  quitting = true;
}

function secureWeb(win: BrowserWindow) {
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
export function getMini() {
  return mini && !mini.isDestroyed() ? mini : null;
}
export function allUiWindows(): BrowserWindow[] {
  return [getMain(), getMini()].filter((w): w is BrowserWindow => !!w);
}

export function createMain(): BrowserWindow {
  if (getMain()) return main!;
  const bounds = settings().appState<{ x: number; y: number; width: number; height: number }>('mainBounds');
  main = new BrowserWindow({
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 780,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 760,
    minHeight: 520,
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
  secureWeb(main);
  void main.loadURL(paths.page('index'));
  main.once('ready-to-show', () => main?.show());
  const saveBounds = () => {
    if (main && !main.isMinimized() && !main.isMaximized()) settings().appState('mainBounds', main.getBounds());
  };
  main.on('resized', saveBounds);
  main.on('moved', saveBounds);
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
  const w = createMain();
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return w;
}

export function createMini(): BrowserWindow {
  if (getMini()) return mini!;
  const pos = settings().appState<{ x: number; y: number; width: number; height: number }>('miniBounds');
  const area = screen.getPrimaryDisplay().workArea;
  const width = pos?.width ?? 400;
  const height = pos?.height ?? 176;
  mini = new BrowserWindow({
    width,
    height,
    x: pos?.x ?? area.x + area.width - width - 24,
    y: pos?.y ?? area.y + 24,
    minWidth: 300,
    minHeight: 120,
    maxHeight: 560,
    show: false,
    frame: false,
    transparent: isMac,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    title: 'Minute — direct',
    vibrancy: isMac ? 'hud' : undefined,
    visualEffectState: 'active',
    backgroundMaterial: isWin11 ? 'acrylic' : undefined,
    backgroundColor: isMac || isWin11 ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#2c2c2e' : '#ffffff',
    webPreferences: { preload: paths.preload(), contextIsolation: true, sandbox: true },
  });
  mini.setAlwaysOnTop(true, 'floating');
  if (isMac) mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mini.setContentProtection(settings().get().miniHiddenFromCapture);
  secureWeb(mini);
  void mini.loadURL(paths.page('mini'));
  const save = () => mini && settings().appState('miniBounds', mini.getBounds());
  mini.on('moved', save);
  mini.on('resized', save);
  mini.on('closed', () => {
    mini = null;
  });
  return mini;
}

export function toggleMini(force?: boolean) {
  const existing = getMini();
  const visible = !!existing?.isVisible();
  const want = force ?? !visible;
  if (!want) {
    existing?.hide();
    return;
  }
  const w = createMini();
  if (w.webContents.isLoading()) w.once('ready-to-show', () => w.showInactive());
  else w.showInactive();
}

export function applyMiniPrivacy(hidden: boolean) {
  getMini()?.setContentProtection(hidden);
}

/** Fenêtre invisible qui possède les flux audio (indépendante de l'interface). */
export function ensureEngine(onCrash: () => void): Promise<void> {
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
  engine.webContents.on('render-process-gone', () => {
    engine = null;
    engineReady = null;
    onCrash();
  });
  engineReady = new Promise<void>((resolve) => {
    engine!.webContents.once('did-finish-load', () => resolve());
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
      { label: 'Mini-fenêtre', accelerator: accel(sc.mini), registerAccelerator: false, click: a.mini },
      { type: 'separator' },
      { label: 'Ouvrir Minute', click: () => showMain() },
      { label: 'Quitter Minute', click: a.quit },
    ]),
  );
}
