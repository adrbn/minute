// Mode compact : une petite fenêtre flottante qui remplace la fenêtre principale
// pendant la réunion (les deux ne sont jamais visibles en même temps).
//
// - Deux formes : « pilule » (discrète) et « panneau » de sous-titres.
// - Se déplace comme l'image-dans-l'image d'Apple : suit le pointeur 1:1, puis
//   file vers l'ancrage le plus proche du point PROJETÉ par l'élan du geste,
//   avec un ressort critique (amortissement 1, réponse 0,4 s).
// - Le passage pilule ↔ panneau est un morphing CSS ancré sur le coin d'écran :
//   la fenêtre (transparente) est agrandie avant d'agrandir la forme, et réduite
//   après l'avoir réduite, pour qu'aucune étape ne soit visible.
import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import type { Anchor, CompactLayout, CompactShape } from '../shared/types';
import { settings } from './settings';
import { getMain, paths, registerExtraWindows, secureWeb, setBeforeShowMain, showMain } from './windows';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** marge transparente autour de la forme (ombre portée dessinée en CSS) */
export const MARGIN = 14;
const EDGE = 12; // distance forme ↔ bord d'écran une fois aimantée
const PILL = { w: 272, h: 46 };
const PANEL_MIN = { w: 340, h: 200 };
const PANEL_MAX = { w: 900, h: 720 };

interface Geo {
  shape: CompactShape;
  anchor: Anchor;
  panel: { w: number; h: number };
  display?: number;
}

let win: BrowserWindow | null = null;
let active = false;
let geo: Geo = {
  shape: 'pill',
  anchor: isMac ? 'tr' : 'br', // Windows : loin des boutons de fenêtre et des barres d'outils des visios
  panel: { w: 420, h: 280 },
};
const listeners = new Set<(active: boolean) => void>();

const saveGeo = () => settings().appState('compactGeo', geo);
export const isCompact = () => active;
export const onCompactChange = (cb: (active: boolean) => void) => listeners.add(cb);
const emitActive = () => listeners.forEach((l) => l(active));

export function getCompactWindow() {
  return win && !win.isDestroyed() ? win : null;
}

function shapeSize(shape: CompactShape) {
  return shape === 'pill' ? PILL : geo.panel;
}
function winSize(shape: CompactShape) {
  const s = shapeSize(shape);
  return { width: s.w + 2 * MARGIN, height: s.h + 2 * MARGIN };
}

function displayFor(b: Rectangle) {
  return screen.getDisplayNearestPoint({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
}

/** Position de la fenêtre pour qu'une forme de taille `size` soit aimantée à `anchor`. */
function placeAt(anchor: Anchor, size: { width: number; height: number }, area: Rectangle) {
  const inset = EDGE - MARGIN;
  const x =
    anchor[1] === 'l'
      ? area.x + inset
      : anchor[1] === 'r'
        ? area.x + area.width - size.width - inset
        : Math.round(area.x + (area.width - size.width) / 2);
  const y = anchor[0] === 't' ? area.y + inset : area.y + area.height - size.height - inset;
  return { x, y };
}

/** Ancrage le plus proche de la position actuelle (sert au morphing). */
function nearestAnchor(b: Rectangle, area: Rectangle): Anchor {
  const cx = b.x + b.width / 2 - area.x;
  const cy = b.y + b.height / 2 - area.y;
  const h = cx < area.width / 3 ? 'l' : cx > (area.width * 2) / 3 ? 'r' : 'c';
  const v = cy < area.height / 2 ? 't' : 'b';
  return `${v}${h}` as Anchor;
}

export function layout(): CompactLayout {
  return { shape: geo.shape, anchor: geo.anchor, margin: MARGIN, pill: PILL };
}

function sendLayout() {
  getCompactWindow()?.webContents.send('compactLayout', layout());
}

// ------------------------------------------------------------------ fenêtre
function create(): BrowserWindow {
  if (getCompactWindow()) return win!;
  const size = winSize(geo.shape);
  const saved = settings().appState<{ x: number; y: number }>('compactPos');
  const area = screen.getPrimaryDisplay().workArea;
  const pos = saved && screen.getAllDisplays().some((d) => pointIn(saved, d.workArea)) ? saved : placeAt(geo.anchor, size, area);
  win = new BrowserWindow({
    ...size,
    ...pos,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false, // ombre dessinée en CSS (forme arrondie)
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // ne vole jamais le focus à Teams / Zoom : on clique sans perdre la frappe en cours
    focusable: !isWin,
    type: isMac ? 'panel' : undefined,
    title: 'Minute — mode compact',
    backgroundColor: '#00000000',
    webPreferences: { preload: paths.preload(), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(settings().get().miniHiddenFromCapture);
  secureWeb(win);
  void win.loadURL(paths.page('mini'));
  win.on('closed', () => {
    win = null;
    active = false;
    emitActive();
  });
  return win;
}

function pointIn(p: { x: number; y: number }, r: Rectangle) {
  return p.x >= r.x - 40 && p.y >= r.y - 40 && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

export function applyCompactPrivacy(hidden: boolean) {
  getCompactWindow()?.setContentProtection(hidden);
}

/** Passe en mode compact : la fenêtre principale s'efface. */
export function enterCompact() {
  const w = create();
  active = true;
  getMain()?.hide();
  const show = () => {
    sendLayout();
    w.showInactive();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show);
  else show();
  emitActive();
}

/** Quitte le mode compact ; par défaut la fenêtre principale revient. */
export function exitCompact(opts: { showMain?: boolean } = {}) {
  active = false;
  getCompactWindow()?.hide();
  emitActive();
  if (opts.showMain !== false) showMain();
}

export function toggleCompact() {
  if (active) exitCompact();
  else enterCompact();
}

// ------------------------------------------------------------------ morphing pilule ↔ panneau
function waitAck(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, timeout);
    function done() {
      clearTimeout(t);
      ipcMain.removeListener('compact:ack', done);
      resolve();
    }
    ipcMain.once('compact:ack', done);
  });
}

let morphing = false;
export async function setShape(shape: CompactShape) {
  const w = getCompactWindow();
  if (!w || morphing || shape === geo.shape) return;
  morphing = true;
  stopSpring();
  try {
    const b = w.getBounds();
    const area = displayFor(b).workArea;
    const anchor = nearestAnchor(b, area);
    const target = winSize(shape);
    const fixed = anchoredBounds(b, target, anchor, area);
    if (shape === 'panel') {
      // 1. la forme reste une pilule mais s'ancre au bon coin ; 2. la fenêtre grandit ; 3. la forme grandit
      geo = { ...geo, anchor, shape: 'pill' };
      sendLayout();
      await waitAck(160);
      w.setBounds(fixed);
      geo = { ...geo, shape: 'panel' };
      sendLayout();
    } else {
      // 1. la forme rétrécit (animation CSS) ; 2. la fenêtre se resserre autour
      geo = { ...geo, anchor, shape: 'pill' };
      sendLayout();
      await waitAck(700);
      w.setBounds(fixed);
    }
    saveGeo();
    settings().appState('compactPos', { x: fixed.x, y: fixed.y });
  } finally {
    morphing = false;
  }
}

/** Nouvelles dimensions en gardant fixe le coin (ou le bord) d'ancrage, dans l'écran. */
function anchoredBounds(b: Rectangle, size: { width: number; height: number }, anchor: Anchor, area: Rectangle): Rectangle {
  let x = anchor[1] === 'l' ? b.x : anchor[1] === 'r' ? b.x + b.width - size.width : Math.round(b.x + (b.width - size.width) / 2);
  let y = anchor[0] === 't' ? b.y : b.y + b.height - size.height;
  x = clamp(x, area.x - MARGIN, area.x + area.width - size.width + MARGIN);
  y = clamp(y, area.y - MARGIN, area.y + area.height - size.height + MARGIN);
  return { x: Math.round(x), y: Math.round(y), ...size };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
/** Toute valeur venant de l'interface est vérifiée : jamais de NaN/Infinity vers le système. */
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Déplace la fenêtre sans jamais pouvoir faire planter l'app. */
function moveTo(w: BrowserWindow, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || w.isDestroyed()) return false;
  try {
    w.setPosition(Math.round(clamp(x, -100_000, 100_000)), Math.round(clamp(y, -100_000, 100_000)));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ déplacement façon PiP
let drag: { offX: number; offY: number } | null = null;
let spring: NodeJS.Timeout | null = null;

function stopSpring() {
  if (spring) clearInterval(spring);
  spring = null;
}

/** Projection d'élan d'Apple (« Designing Fluid Interfaces ») : où le geste s'arrêterait. */
const project = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);

export function compactDrag(phase: 'start' | 'move' | 'end', rawX: unknown, rawY: unknown, rawVx?: unknown, rawVy?: unknown) {
  const w = getCompactWindow();
  if (!w) return;
  const sx = num(rawX, NaN);
  const sy = num(rawY, NaN);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
  // vitesse bornée : un geste vif, pas une téléportation
  const vx = clamp(num(rawVx), -4000, 4000);
  const vy = clamp(num(rawVy), -4000, 4000);
  if (phase === 'start') {
    stopSpring(); // on peut rattraper la fenêtre en plein vol
    const b = w.getBounds();
    drag = { offX: sx - b.x, offY: sy - b.y };
    return;
  }
  if (!drag) return;
  if (phase === 'move') {
    moveTo(w, sx - drag.offX, sy - drag.offY);
    return;
  }
  drag = null;
  const b = w.getBounds();
  const px = b.x + project(vx);
  const py = b.y + project(vy);
  // l'élan choisit le coin, pas l'écran : on reste sur l'écran où l'on a lâché la fenêtre
  const area = displayFor(b).workArea;
  const size = { width: b.width, height: b.height };
  const anchors: Anchor[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
  let best: Anchor = geo.anchor;
  let bestD = Infinity;
  for (const a of anchors) {
    const p = placeAt(a, size, area);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  const target = placeAt(best, size, area);
  geo = { ...geo, anchor: best };
  saveGeo();
  sendLayout();
  springTo(w, target, vx, vy);
}

/** Ressort critique (sans rebond) sur X et Y séparément, en héritant de la vitesse du geste. */
function springTo(w: BrowserWindow, target: { x: number; y: number }, vx: number, vy: number) {
  stopSpring();
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
  const omega = (2 * Math.PI) / 0.4;
  const b = w.getBounds();
  let x = b.x;
  let y = b.y;
  let t = 0;
  spring = setInterval(() => {
    if (w.isDestroyed()) return stopSpring();
    const steps = 4;
    const h = 1 / 60 / steps;
    for (let i = 0; i < steps; i++) {
      vx += (-omega * omega * (x - target.x) - 2 * omega * vx) * h;
      vy += (-omega * omega * (y - target.y) - 2 * omega * vy) * h;
      x += vx * h;
      y += vy * h;
    }
    t += 1 / 60;
    const settled = Math.abs(x - target.x) < 0.5 && Math.abs(y - target.y) < 0.5 && Math.hypot(vx, vy) < 20;
    const broken = !Number.isFinite(x) || !Number.isFinite(y);
    if (settled || broken || t > 2) {
      moveTo(w, target.x, target.y);
      settings().appState('compactPos', target);
      return stopSpring();
    }
    moveTo(w, x, y);
  }, 1000 / 60);
}

// ------------------------------------------------------------------ redimensionnement du panneau
let resizeStart: { b: Rectangle; panel: { w: number; h: number } } | null = null;

export function compactResize(phase: 'start' | 'move' | 'end', dx: number, dy: number) {
  const w = getCompactWindow();
  if (!w || geo.shape !== 'panel') return;
  if (phase === 'start') {
    resizeStart = { b: w.getBounds(), panel: { ...geo.panel } };
    return;
  }
  if (!resizeStart) return;
  // la poignée est au coin opposé à l'ancrage : on grandit vers l'intérieur de l'écran
  const sx = geo.anchor[1] === 'r' ? -1 : 1;
  const sy = geo.anchor[0] === 'b' ? -1 : 1;
  const pw = clamp(resizeStart.panel.w + dx * sx * (geo.anchor[1] === 'c' ? 2 : 1), PANEL_MIN.w, PANEL_MAX.w);
  const ph = clamp(resizeStart.panel.h + dy * sy, PANEL_MIN.h, PANEL_MAX.h);
  geo = { ...geo, panel: { w: Math.round(pw), h: Math.round(ph) } };
  const size = winSize('panel');
  const area = displayFor(resizeStart.b).workArea;
  w.setBounds(anchoredBounds(resizeStart.b, size, geo.anchor, area));
  if (phase === 'end') {
    resizeStart = null;
    saveGeo();
    const nb = w.getBounds();
    settings().appState('compactPos', { x: nb.x, y: nb.y });
  }
}

// ------------------------------------------------------------------ branchements
export function initCompact() {
  geo = { ...geo, ...(settings().appState<Geo>('compactGeo') ?? {}) };
  registerExtraWindows(() => {
    const w = getCompactWindow();
    return w ? [w] : [];
  });
  // Afficher la fenêtre principale fait quitter le mode compact (modes exclusifs).
  setBeforeShowMain(() => {
    if (active) {
      active = false;
      getCompactWindow()?.hide();
      emitActive();
    }
  });
  ipcMain.on('compact:drag', (_e, phase, sx, sy, vx, vy) => compactDrag(phase, sx, sy, vx, vy));
  ipcMain.on('compact:resize', (_e, phase, dx, dy) => compactResize(phase, num(dx), num(dy)));
  // pré-charge la fenêtre pour une apparition instantanée
  create();
}

