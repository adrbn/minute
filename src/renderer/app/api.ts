import { useEffect, useRef, useState } from 'react';
import type { AppInfo, Channel, LiveEvent, Levels, LiveState, MeetingFull, MeetingMeta, MinuteAPI, Settings } from '../../shared/types';
import { sortSegments } from '../../shared/transcript';
import { locale, t } from '../../shared/i18n';

declare global {
  interface Window {
    minute: MinuteAPI;
  }
}

export const minute = window.minute;

export function useLiveState(): LiveState | null {
  const [s, setS] = useState<LiveState | null>(null);
  useEffect(() => {
    void minute.recorder.state().then(setS);
    return minute.on('state', setS);
  }, []);
  return s;
}

const zero: Levels = { me: 0, them: 0, meSpeaking: false, themSpeaking: false };
export function useLevels(active: boolean): Levels {
  const [l, setL] = useState<Levels>(zero);
  useEffect(() => {
    if (!active) {
      setL(zero);
      return;
    }
    return minute.on('levels', setL);
  }, [active]);
  return l;
}

/** Qui parle en ce moment ? Ne provoque un rendu que lorsque la réponse change. */
export function useSpeaking(active: boolean): { me: boolean; them: boolean } {
  const [s, setS] = useState({ me: false, them: false });
  useEffect(() => {
    if (!active) {
      setS({ me: false, them: false });
      return;
    }
    return minute.on('levels', (l) =>
      setS((prev) => (prev.me === l.meSpeaking && prev.them === l.themSpeaking ? prev : { me: l.meSpeaking, them: l.themSpeaking })),
    );
  }, [active]);
  return s;
}

export function useMeetings(): MeetingMeta[] {
  const [list, setList] = useState<MeetingMeta[]>([]);
  useEffect(() => {
    const load = () => void minute.meetings.list().then(setList);
    load();
    return minute.on('meetings', load);
  }, []);
  return list;
}

export function useSettings(): [Settings | null, (p: Partial<Settings>) => Promise<void>] {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void minute.settings.get().then(setS);
    return minute.on('settings', setS);
  }, []);
  const update = async (p: Partial<Settings>) => {
    setS(await minute.settings.set(p));
  };
  return [s, update];
}

export function useInfo(): AppInfo | null {
  const [i, setI] = useState<AppInfo | null>(null);
  useEffect(() => {
    void minute.info().then(setI);
  }, []);
  return i;
}

export type Interims = Record<Channel, { t0: number; text: string } | null>;

/** Réunion complète, tenue à jour en direct. */
export function useMeeting(id: string | null) {
  const [data, setData] = useState<MeetingFull | null>(null);
  const [interims, setInterims] = useState<Interims>({ me: null, them: null });
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    setData(null);
    setInterims({ me: null, them: null });
    if (!id) return;
    let alive = true;
    const load = () =>
      void minute.meetings
        .get(id)
        .then((d) => {
          if (alive && idRef.current === id) setData(d);
        })
        .catch(() => undefined); // supprimée entre-temps : la liste se met à jour et la sélection saute
    load();
    const offLive = minute.on('live', (e: LiveEvent) => {
      if (e.meetingId !== id) return;
      if (e.type === 'interim') {
        setInterims((prev) => ({ ...prev, [e.ch]: e.text ? { t0: e.t0, text: e.text } : null }));
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        if (e.type === 'segment') {
          const others = prev.segments.filter((s) => s.id !== e.segment.id);
          return { ...prev, segments: sortSegments([...others, e.segment]) };
        }
        if (e.type === 'remove') return { ...prev, segments: prev.segments.filter((s) => s.id !== e.id) };
        if (e.type === 'bookmark') return { ...prev, meta: { ...prev.meta, bookmarks: [...prev.meta.bookmarks, e.bookmark] } };
        return prev;
      });
    });
    // les métadonnées (titre, compte-rendu…) changent aussi hors du direct
    const offMeta = minute.on('meetings', () => {
      void minute.meetings
        .get(id)
        .then((d) => {
          if (!alive || !d || idRef.current !== id) return;
          setData((prev) => (prev ? { ...prev, meta: d.meta } : d));
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
      offLive();
      offMeta();
    };
  }, [id]);

  return { data, setData, interims };
}

export function useElapsed(live: LiveState | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live?.meetingId) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live?.meetingId]);
  if (!live?.meetingId) return 0;
  const paused = live.pausedMs + (live.pausedAt ? Date.now() - live.pausedAt : 0);
  return Math.max(0, Date.now() - live.startedAt - paused);
}

export function shortcutLabel(accel: string, platform: string): string {
  if (!accel) return '';
  if (platform === 'darwin') {
    return accel
      .replace(/Control\+/g, '⌃')
      .replace(/Alt\+/g, '⌥')
      .replace(/Shift\+/g, '⇧')
      .replace(/Command\+|CommandOrControl\+/g, '⌘');
  }
  return accel.replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl');
}

/** Prénom de l'utilisateur (pour repérer les phrases qui lui sont adressées). */
export function firstNameRe(name: string): RegExp | null {
  const first = name.trim().split(/\s+/)[0];
  if (!first || first.length < 2 || /^moi$/i.test(first)) return null;
  const n = first
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}])${n}(?![\\p{L}])`, 'u');
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return t('à l’instant');
  if (min < 60) return t('il y a {n} min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('il y a {n} h', { n: h });
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
