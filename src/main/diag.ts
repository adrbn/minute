// Journal technique et rapport de problème. Le journal ne contient jamais de texte de réunion :
// seulement des événements techniques, et tout ce qui pourrait identifier quelqu'un est masqué
// (dossiers de l'utilisateur, clés d'API, adresses e-mail) avant de quitter la machine.
import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, release, arch, totalmem, cpus } from 'node:os';
import { join } from 'node:path';

const MAX = 400;
const lines: string[] = [];

/** Ajoute une ligne au journal technique (mémoire, les 400 dernières). */
export function diagLog(kind: string, msg: string) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  lines.push(`${t} ${kind} — ${msg.replace(/\s+/g, ' ').slice(0, 400)}`);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

/** Masque ce qui ne doit pas partir : dossiers personnels, identifiants, clés, e-mails. */
export function sanitize(text: string): string {
  const home = homedir();
  const user = home.split(/[\\/]/).pop() ?? '';
  let s = text.split(home).join('~');
  if (user.length > 2) s = s.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<utilisateur>');
  return s
    .replace(/\b(gsk_|sk-ant-[a-z0-9-]*|sk-proj-|sk-|AIza|ghp_|github_pat_)[A-Za-z0-9_\-]{8,}/g, '<clé masquée>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>')
    .replace(/\b(Bearer|token=|key=)\s*[A-Za-z0-9._\-]{12,}/gi, '$1 <masqué>');
}

/** Rapport lisible (Markdown) : environnement, état, journal récent. */
export function diagnostics(context: Record<string, string | number | boolean | undefined>): string {
  const tail = (() => {
    const file = join(app.getPath('userData'), 'minute.log');
    if (!existsSync(file)) return [] as string[];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-20);
  })();
  const env = [
    `Minute ${app.getVersion()}${app.isPackaged ? '' : ' (développement)'}`,
    `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform} ${release()} (${arch()})`,
    `Electron ${process.versions.electron} · ${cpus().length} cœurs · ${Math.round(totalmem() / 1073741824)} Go`,
    ...Object.entries(context)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k} : ${v}`),
  ];
  const body = [
    '### Environnement',
    '```',
    ...env,
    '```',
    '### Journal récent',
    '```',
    ...(lines.length ? lines.slice(-80) : ['(vide)']),
    ...(tail.length ? ['', '— erreurs enregistrées —', ...tail] : []),
    '```',
  ].join('\n');
  return sanitize(body);
}
