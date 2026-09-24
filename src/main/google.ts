// « Se connecter avec Google » : OAuth 2.0 pour applications de bureau
// (redirection sur 127.0.0.1 + PKCE), puis lecture de l'agenda via l'API Calendar.
// Le jeton d'actualisation est chiffré par le système (safeStorage).
import { shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CalendarEvent } from '../shared/types';
import { getLang, t } from '../shared/i18n';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.readonly'];

export interface GoogleClient {
  id: string;
  secret: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// page affichée dans le navigateur : textes déjà traduits par l'appelant
const PAGE = (title: string, body: string) => `<!doctype html><html lang="${getLang()}"><meta charset="utf-8"><title>Minute</title>
<style>body{font:15px -apple-system,'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f7;color:#1d1d1f}
main{text-align:center;max-width:420px}h1{font-size:22px;margin:0 0 8px}p{color:#6e6e73;margin:0}</style>
<main><h1>${title}</h1><p>${body}</p></main>`;

/** Ouvre le navigateur sur la page de connexion Google et attend l'autorisation. */
export async function googleSignIn(client: GoogleClient): Promise<{ refreshToken: string; email: string }> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  const redirect = `http://127.0.0.1:${port}`;

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(t('Connexion abandonnée (délai dépassé).')));
    }, 5 * 60_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirect);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const got = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (err || !got || url.searchParams.get('state') !== state) {
        res.end(PAGE(t('Connexion annulée'), t('Vous pouvez fermer cet onglet et réessayer depuis Minute.')));
        clearTimeout(timer);
        server.close();
        reject(new Error(err === 'access_denied' ? t('Autorisation refusée.') : t('Connexion Google interrompue.')));
        return;
      }
      res.end(PAGE(t('Minute est connecté à votre agenda'), t('Vous pouvez fermer cet onglet et revenir à Minute.')));
      clearTimeout(timer);
      server.close();
      resolve(got);
    });
    const auth = new URL(AUTH_URL);
    auth.search = new URLSearchParams({
      client_id: client.id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
    void shell.openExternal(auth.toString());
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { refresh_token?: string; id_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(json.error_description || json.error || t('Google n’a pas renvoyé d’autorisation durable.'));
  const email = emailFromIdToken(json.id_token) ?? 'Google';
  return { refreshToken: json.refresh_token, email };
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

const tokenCache = new Map<string, { token: string; until: number }>();

async function accessToken(client: GoogleClient, refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error === 'invalid_grant' ? t('Autorisation Google expirée : reconnectez votre compte.') : t('Google : jeton refusé.'));
  }
  tokenCache.set(refreshToken, { token: json.access_token, until: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  location?: string;
  description?: string;
}

const nameOf = (p: { email?: string; displayName?: string }) =>
  (p.displayName?.trim() ||
    (p.email ?? '')
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())) ||
  '';

export async function fetchGoogleEvents(client: GoogleClient, refreshToken: string, source: string, now = Date.now()): Promise<CalendarEvent[]> {
  const token = await accessToken(client, refreshToken);
  const url = new URL(EVENTS_URL);
  url.search = new URLSearchParams({
    timeMin: new Date(now - 12 * 3600_000).toISOString(),
    timeMax: new Date(now + 8 * 24 * 3600_000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '150',
  }).toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) {
    tokenCache.delete(refreshToken);
    throw new Error(t('Autorisation Google expirée : reconnectez votre compte.'));
  }
  if (res.status === 403) throw new Error(t('Google refuse l’accès à l’agenda (API Calendar non activée pour ce client ?).'));
  if (!res.ok) throw new Error(t('Google Agenda : erreur {status}', { status: res.status }));
  const json = (await res.json()) as { items?: GEvent[] };
  const out: CalendarEvent[] = [];
  for (const e of json.items ?? []) {
    if (e.status === 'cancelled' || !e.start?.dateTime || !e.end?.dateTime) continue; // journées entières : pas des réunions
    if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue; // invitation refusée
    const people = new Set<string>();
    for (const a of e.attendees ?? []) if (!a.resource) people.add(nameOf(a));
    if (e.organizer && !e.organizer.email?.endsWith('calendar.google.com')) people.add(nameOf(e.organizer));
    people.delete('');
    const video = e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
    const inText = /(https:\/\/(?:teams\.microsoft\.com|[\w.-]*zoom\.us|meet\.google\.com)\/[^\s"<>]+)/i.exec(`${e.location ?? ''} ${e.description ?? ''}`)?.[1];
    out.push({
      id: `g:${e.id}`,
      title: e.summary?.trim() || t('Réunion'),
      start: Date.parse(e.start.dateTime),
      end: Date.parse(e.end.dateTime),
      attendees: [...people],
      link: video || inText,
      source,
    });
  }
  return out;
}

export async function revokeGoogle(refreshToken: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  tokenCache.delete(refreshToken);
}
