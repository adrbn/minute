import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { minute } from '../api';

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
