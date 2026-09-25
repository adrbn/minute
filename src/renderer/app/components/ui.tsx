import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { UpdateState } from '../../../shared/types';
import { t } from '../../../shared/i18n';
import { minute } from '../api';

/** Pastille « Dynamic Island » (mode compact). */
export function IslandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="7.5" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** Emblème de Minute (comme l'icône de l'app) : carré arrondi bleu, ondes blanches. */
export function AppGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="app-glyph" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5692ff" />
          <stop offset="0.6" stopColor="#3a54de" />
          <stop offset="1" stopColor="#282c96" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="19" height="19" rx="4.6" fill="url(#app-glyph)" />
      {[
        [5.95, 3.2],
        [8.65, 5.6],
        [11.35, 4],
        [14.05, 2.2],
      ].map(([x, h], k) => (
        <rect key={k} x={x - 0.8} y={10 - h} width="1.6" height={h * 2} rx="0.8" fill="#fff" opacity={[0.92, 1, 0.96, 0.85][k]} />
      ))}
    </svg>
  );
}

/** Icône de l'app (rendu macOS « Liquid Glass » de build/icon.icon) pour les grands formats. */
export function AppIcon({ size }: { size: number }) {
  return <img className="app-icon" src="icon.png" width={size} height={size} alt="" draggable={false} />;
}

/** Largeur de la fenêtre (mise en page adaptative). */
export function useWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

// ------------------------------------------------------------------ interrupteur
export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

// ------------------------------------------------------------------ menus contextuels
export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  onClick?: () => void;
  separator?: boolean;
  section?: string;
}

export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
    });
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={pos}>
      {items.map((it, i) =>
        it.separator ? (
          <hr key={i} />
        ) : it.section ? (
          <div key={i} className="label">
            {it.section}
          </div>
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.hint && <span className="k">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Petit hook pour ouvrir un menu sous un bouton ou au clic droit. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (e.type === 'contextmenu') setMenu({ x: e.clientX, y: e.clientY, items });
    else {
      const r = target.getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom + 6, items });
    }
  }, []);
  const node = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open, node };
}

// ------------------------------------------------------------------ toasts
type ToastKind = 'info' | 'success' | 'warn' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Math.random();
    setItems((prev) => [...prev.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3600);
  }, []);
  useEffect(() => minute.on('toast', (t) => push(t.text, t.kind ?? 'info')), [push]);
  const icon = (k: ToastKind) =>
    k === 'success' ? <CheckCircle2 /> : k === 'error' ? <XCircle /> : k === 'warn' ? <AlertTriangle /> : <Info />;
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {icon(t.kind)}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ niveau micro de prévisualisation
export function useMicPreview(deviceId: string, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const loop = () => {
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (const v of buf) s += v * v;
          const r = Math.sqrt(s / buf.length);
          setLevel(r > 1e-6 ? Math.max(0, Math.min(1, (20 * Math.log10(r) + 55) / 50)) : 0);
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setLevel(-1);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [deviceId, enabled]);
  return level;
}

export function useAudioInputs(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')));
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  return devices;
}

// ------------------------------------------------------------------ mise à jour disponible
/**
 * Fenêtre « Nouvelle version » : n'apparaît jamais pendant une réunion (elle attend la fin),
 * et « Plus tard » la fait taire jusqu'au prochain lancement.
 */
export function UpdatePrompt({ recording }: { recording: boolean }) {
  const [st, setSt] = useState<UpdateState | null>(null);
  const [later, setLater] = useState<string | null>(null);
  useEffect(() => {
    void minute.updates.state().then(setSt);
    return minute.on('update', setSt);
  }, []);
  if (!st || recording || !st.version || later === st.version) return null;
  const ready = st.status === 'ready';
  const manual = st.status === 'available' && !st.canInstall;
  if (!ready && !manual) return null;
  return (
    <div className="scrim update-scrim" onMouseDown={(e) => e.target === e.currentTarget && setLater(st.version!)}>
      <div className="sheet update-sheet" role="dialog" aria-label={t('Mise à jour disponible')}>
        <AppIcon size={64} />
        <h2>{t('Minute {v} est disponible', { v: st.version })}</h2>
        <p className="update-sub">
          {t('Vous avez la version {v}.', { v: st.current })}{' '}
          {ready ? t('Elle est téléchargée : il suffit de redémarrer.') : t('Téléchargez-la pour en profiter.')}
        </p>
        {st.notes && (
          <div className="update-notes">
            <b>{t('Nouveautés')}</b>
            <p>{st.notes}</p>
          </div>
        )}
        <div className="update-actions">
          <button className="btn" onClick={() => setLater(st.version!)}>
            {t('Plus tard')}
          </button>
          {ready ? (
            <button className="btn primary" onClick={() => void minute.updates.install()}>
              {t('Redémarrer et mettre à jour')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void minute.windows.openExternal(st.url)}>
              {t('Télécharger')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
