// Mode compact : une petite fenêtre flottante qui remplace la fenêtre principale
// pendant la réunion (les deux ne sont jamais visibles en même temps).
//
// - Deux formes : « pilule » (discrète) et « panneau » de sous-titres.
// - Suit le pointeur 1:1 et reste où on la pose ; près d'un bord, elle s'y aimante.
//   Lancée d'un geste vif, elle file vers le coin visé (point PROJETÉ par l'élan,
//   comme l'image-dans-l'image d'Apple), avec un ressort critique (réponse 0,4 s).
// - Le passage pilule ↔ panneau est un morphing CSS ancré sur le coin d'écran :
//   la fenêtre (transparente) est agrandie avant d'agrandir la forme, et réduite
//   après l'avoir réduite, pour qu'aucune étape ne soit visible.
import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import type { Anchor, CompactLayout, CompactShape } from '../shared/types';
import { settings } from './settings';
import { fadeInOnNextShow, fadeWindow, getMain, paths, registerExtraWindows, secureWeb, setBeforeShowMain, showMain } from './windows';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** marge transparente autour de la forme (ombre portée dessinée en CSS) */
export const MARGIN = 14;
const EDGE = 12; // distance forme ↔ bord d'écran une fois aimantée
const SNAP = 56; // en deçà, la forme se colle au bord
const FLING = 1400; // px/s : au-delà, c'est un lancer vers un coin
const PILL = { w: 420, h: 46 }; // assez large pour lire la dernière phrase en direct
const PANEL_MIN = { w: 340, h: 220 };
const PANEL_MAX = { w: 900, h: 720 };

interface Geo {
  /** 2 : pilule élargie et panneau plus grand (v0.3) */
  v?: number;
  shape: CompactShape;
  anchor: Anchor;
  panel: { w: number; h: number };
  display?: number;
}

let win: BrowserWindow | null = null;
let active = false;
let geo: Geo = {
  v: 2,
  shape: 'pill', // la pastille, qui montre la dernière phrase ; les sous-titres sont à un clic
  anchor: isMac ? 'tr' : 'br', // Windows : loin des boutons de fenêtre et des barres d'outils des visios
  panel: { w: 460, h: 340 },
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
  return { shape: geo.shape, anchor: geo.anchor, margin: MARGIN, pill: PILL, active };
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
  const pos = process.env.MINUTE_OFFSCREEN
    ? { x: -3000, y: 900 }
    : saved && screen.getAllDisplays().some((d) => pointIn(saved, d.workArea))
      ? saved
      : placeAt(geo.anchor, size, area);
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

/** Passe en mode compact : la fenêtre principale s'efface (en fondu si `animate`). */
export function enterCompact(opts: { animate?: boolean } = {}) {
  const w = create();
  active = true;
  const main = getMain();
  if (main && opts.animate && main.isVisible() && !main.isMinimized()) {
    void fadeWindow(main, 1, 0).then(() => {
      if (!active) return fadeWindow(main, main.getOpacity(), 1); // revenu entre-temps
      main.hide();
      main.setOpacity(1);
    });
  } else {
    main?.hide();
  }
  const show = () => {
    // taille ou écran changés depuis la dernière fois : la forme reste entièrement visible
    const b = w.getBounds();
    const size = winSize(geo.shape);
    const fit = settle({ ...b, ...size }, displayFor(b).workArea);
    w.setBounds({ ...fit, ...size });
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
  sendLayout();
  getCompactWindow()?.hide();
  emitActive();
  if (opts.showMain !== false) {
    fadeInOnNextShow();
    showMain();
  }
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
  // on reste sur l'écran où l'on a lâché la fenêtre
  const area = displayFor(b).workArea;
  const size = { width: b.width, height: b.height };
  let target: { x: number; y: number };
  if (Math.hypot(vx, vy) > FLING) {
    // lancer : l'élan choisit le coin (ou le milieu d'un bord)
    const px = b.x + project(vx);
    const py = b.y + project(vy);
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
    target = placeAt(best, size, area);
  } else {
    target = settle(b, area);
  }
  geo = { ...geo, anchor: nearestAnchor({ ...target, ...size }, area) };
  saveGeo();
  sendLayout();
  springTo(w, target, vx, vy);
}

/** Posée : reste où elle est (dans l'écran), aimantée seulement aux bords tout proches. */
function settle(b: Rectangle, area: Rectangle) {
  const sx = b.x + MARGIN;
  const sy = b.y + MARGIN;
  const sw = b.width - 2 * MARGIN;
  const sh = b.height - 2 * MARGIN;
  const inset = EDGE - MARGIN;
  let x = clamp(b.x, area.x + inset, area.x + area.width - b.width - inset);
  let y = clamp(b.y, area.y + inset, area.y + area.height - b.height - inset);
  if (sx - area.x < SNAP) x = area.x + inset;
  else if (area.x + area.width - (sx + sw) < SNAP) x = area.x + area.width - b.width - inset;
  else if (Math.abs(sx + sw / 2 - (area.x + area.width / 2)) < SNAP / 2) x = Math.round(area.x + (area.width - b.width) / 2);
  if (sy - area.y < SNAP) y = area.y + inset;
  else if (area.y + area.height - (sy + sh) < SNAP) y = area.y + area.height - b.height - inset;
  return { x: Math.round(x), y: Math.round(y) };
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
let resizeStart: { b: Rectangle; panel: { w: number; h: number }; corner: Anchor } | null = null;

/** Redimensionne depuis le coin saisi : le coin opposé ne bouge pas (comme une fenêtre ordinaire). */
export function compactResize(phase: 'start' | 'move' | 'end', dx: number, dy: number, corner?: unknown) {
  const w = getCompactWindow();
  if (!w || geo.shape !== 'panel') return;
  if (phase === 'start') {
    const c = (['tl', 'tr', 'bl', 'br'] as const).find((k) => k === corner) ?? 'br';
    resizeStart = { b: w.getBounds(), panel: { ...geo.panel }, corner: c };
    return;
  }
  if (!resizeStart) return;
  const { b, corner: c } = resizeStart;
  const pw = clamp(resizeStart.panel.w + (c[1] === 'r' ? dx : -dx), PANEL_MIN.w, PANEL_MAX.w);
  const ph = clamp(resizeStart.panel.h + (c[0] === 'b' ? dy : -dy), PANEL_MIN.h, PANEL_MAX.h);
  geo = { ...geo, panel: { w: Math.round(pw), h: Math.round(ph) } };
  const size = winSize('panel');
  const x = c[1] === 'r' ? b.x : b.x + b.width - size.width;
  const y = c[0] === 'b' ? b.y : b.y + b.height - size.height;
  w.setBounds({ x: Math.round(x), y: Math.round(y), ...size });
  if (phase === 'end') {
    resizeStart = null;
    const nb = w.getBounds();
    geo = { ...geo, anchor: nearestAnchor(nb, displayFor(nb).workArea) };
    saveGeo();
    sendLayout();
    settings().appState('compactPos', { x: nb.x, y: nb.y });
  }
}

// ------------------------------------------------------------------ branchements
export function initCompact() {
  const saved = settings().appState<Geo>('compactGeo');
  // tailles d'avant la v0.3 (trop petites) : on repart des nouvelles valeurs, en gardant le coin choisi
  geo = saved?.v === 2 ? { ...geo, ...saved } : { ...geo, anchor: saved?.anchor ?? geo.anchor };
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
  ipcMain.on('compact:resize', (_e, phase, dx, dy, corner) => compactResize(phase, num(dx), num(dy), corner));
  // saisie (notes, question) : la fenêtre accepte le clavier le temps de taper, puis rend la main
  ipcMain.on('compact:focus', (_e, on: unknown) => {
    const w = getCompactWindow();
    if (!w || !isWin) return;
    if (on === true) {
      w.setFocusable(true);
      w.focus();
    } else {
      w.setFocusable(false);
    }
  });
  // pré-charge la fenêtre pour une apparition instantanée
  create();
}

