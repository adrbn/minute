// Agenda : lecture des calendriers via leur adresse iCal privée (Google Agenda,
// Outlook / Teams…) — sans application OAuth à déclarer chez Google ou Microsoft.
// On en tire les réunions du jour (récurrences et fuseaux compris), leurs
// participants et le lien de visio.
import ICAL from 'ical.js';
import type { CalendarEvent, CalendarSource } from '../shared/types';
import { t } from '../shared/i18n';
import { fetchGoogleEvents, type GoogleClient } from './google';

const WINDOW_BEFORE = 12 * 3600_000;
const WINDOW_AFTER = 8 * 24 * 3600_000;

function normalizeUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

const LINK_RE = /(https:\/\/(?:meet\.google\.com\/[a-z-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+|teams\.live\.com\/meet\/[^\s"<>]+|[\w.-]*zoom\.us\/[jw]\/[^\s"<>]+|[\w.-]*webex\.com\/[^\s"<>]+))/i;

function attendeeNames(ev: ICAL.Event): string[] {
  const names = new Set<string>();
  const add = (prop: ICAL.Property | null) => {
    if (!prop) return;
    const cn = prop.getParameter('cn');
    const value = String(prop.getFirstValue() ?? '');
    const email = value.replace(/^mailto:/i, '');
    const name = (typeof cn === 'string' && cn.trim()) || email.split('@')[0].replace(/[._-]+/g, ' ');
    // les salles et les listes de diffusion ne sont pas des personnes
    if (name && !/salle|room|resource|calendar\.google|group\./i.test(email + name)) names.add(prettyName(name));
  };
  for (const p of ev.component.getAllProperties('attendee')) add(p);
  add(ev.component.getFirstProperty('organizer'));
  return [...names];
}

function prettyName(n: string): string {
  const clean = n.replace(/["']/g, '').trim();
  // « DUPONT Marie » ou « marie dupont » → « Marie Dupont »
  return clean
    .split(/\s+/)
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

function linkOf(ev: ICAL.Event): string | undefined {
  const hay = [ev.location, ev.description, String(ev.component.getFirstPropertyValue('url') ?? '')].join(' ');
  return LINK_RE.exec(hay)?.[1];
}

export function parseIcs(text: string, source: string, now = Date.now()): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* fuseau déjà connu */
    }
  }
  const from = ICAL.Time.fromJSDate(new Date(now - WINDOW_BEFORE), true);
  const to = ICAL.Time.fromJSDate(new Date(now + WINDOW_AFTER), true);

  // occurrences modifiées (RECURRENCE-ID) rattachées à leur série
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const comp of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(comp);
    if (comp.getFirstPropertyValue('recurrence-id')) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId}`, ex);
  }

  const out: CalendarEvent[] = [];
  const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (start.isDate) return; // événements « journée entière » : pas des réunions
    const status = String(ev.component.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'CANCELLED') return;
    const s = start.toJSDate().getTime();
    const e = end.toJSDate().getTime();
    out.push({
      id: `${ev.uid}@${s}`,
      title: ev.summary?.trim() || t('Réunion'),
      start: s,
      end: e > s ? e : s + 30 * 60_000,
      attendees: attendeeNames(ev),
      link: linkOf(ev),
      source,
    });
  };

  for (const ev of masters.values()) {
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next: ICAL.Time | null;
        let guard = 0;
        while ((next = it.next()) && guard++ < 2000) {
          if (next.compare(to) > 0) break;
          const occ = ev.getOccurrenceDetails(next);
          if (occ.endDate.compare(from) < 0) continue;
          push(occ.item, occ.startDate, occ.endDate);
        }
      } else if (ev.startDate && ev.endDate && ev.endDate.compare(from) >= 0 && ev.startDate.compare(to) <= 0) {
        push(ev, ev.startDate, ev.endDate);
      }
    } catch {
      /* événement mal formé : ignoré */
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export class CalendarService {
  events: CalendarEvent[] = [];
  errors: Record<string, string> = {};
  lastSync = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sources: () => CalendarSource[],
    private readonly onChange: () => void,
    /** identifiants OAuth + jeton du compte Google */
    private readonly google: (src: CalendarSource) => { client: GoogleClient; refreshToken: string } | null,
  ) {}

  start() {
    void this.sync();
    this.timer = setInterval(() => void this.sync(), 5 * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async sync(): Promise<void> {
    const all: CalendarEvent[] = [];
    const errors: Record<string, string> = {};
    for (const src of this.sources()) {
      try {
        if (src.kind === 'google') {
          const g = this.google(src);
          if (!g) throw new Error(t('Compte Google à reconnecter.'));
          all.push(...(await fetchGoogleEvents(g.client, g.refreshToken, src.name)));
        } else all.push(...(await fetchCalendar(src)));
      } catch (e) {
        errors[src.url] = (e as Error).message;
      }
    }
    // une même réunion peut figurer dans deux agendas
    const seen = new Set<string>();
    this.events = all
      .sort((a, b) => a.start - b.start)
      .filter((e) => {
        const k = `${e.title.toLowerCase()}|${e.start}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    this.errors = errors;
    this.lastSync = Date.now();
    this.onChange();
  }

  /** Réunion en cours (ou qui commence dans les 10 minutes). */
  current(now = Date.now()): CalendarEvent | null {
    return this.events.find((e) => e.start - 10 * 60_000 <= now && now < e.end) ?? null;
  }

  upcoming(now = Date.now(), limit = 6): CalendarEvent[] {
    return this.events.filter((e) => e.end > now).slice(0, limit);
  }
}

export async function fetchCalendar(src: CalendarSource): Promise<CalendarEvent[]> {
  const url = normalizeUrl(src.url);
  if (!/^https:\/\//i.test(url)) throw new Error(t('L’adresse doit commencer par https:// ou webcal://'));
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/calendar' } });
  } catch (e) {
    throw new Error(t('Agenda injoignable ({error})', { error: (e as Error).message }));
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new Error(t('Adresse refusée : vérifiez qu’il s’agit bien de l’adresse iCal privée (secrète).'));
  }
  if (!res.ok) throw new Error(t('Agenda : erreur {status}', { status: res.status }));
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(t('Ce lien ne renvoie pas un agenda iCal.'));
  return parseIcs(text, src.name || t('Agenda'));
}
