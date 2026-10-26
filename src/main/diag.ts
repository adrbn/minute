// Journal technique et rapport de problème. Le journal ne contient jamais de texte de réunion :
// seulement des événements techniques, et tout ce qui pourrait identifier quelqu'un est masqué
// (dossiers de l'utilisateur, clés d'API, adresses e-mail) avant de quitter la machine.
import { app } from 'electron';
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir, release, arch, totalmem, cpus } from 'node:os';
import { join } from 'node:path';

const MAX = 400;
const lines: string[] = [];
/** au-delà, minute.log devient minute.old.log (une seule génération gardée) */
const FILE_MAX = 2 * 1024 * 1024;

/** Fichier du journal (dossier de l'app) : il survit au redémarrage, l'utilisateur peut l'envoyer tel quel. */
export function logFile(): string {
  return join(app.getPath('userData'), 'minute.log');
}

/**
 * Ajoute une ligne au journal technique : en mémoire (les 400 dernières) et dans minute.log, masquée
 * comme le rapport (dossiers, clés, e-mails). Jamais de texte de réunion ici.
 */
export function diagLog(kind: string, msg: string) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${t} ${kind} — ${msg.replace(/\s+/g, ' ').slice(0, 400)}`;
  lines.push(line);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  persist(line);
}

function persist(line: string) {
  // tests unitaires (electron simulé) : rien sur le disque
  if (typeof app.isReady !== 'function' || !app.isReady()) return;
  try {
    const file = logFile();
    if (existsSync(file) && statSync(file).size > FILE_MAX) renameSync(file, file.replace(/\.log$/, '.old.log'));
    appendFileSync(file, sanitize(line) + '\n', 'utf8');
  } catch {
    /* disque indisponible : le journal en mémoire suffit */
  }
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
    const file = logFile();
    if (!existsSync(file)) return [] as string[];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-40);
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
    ...(tail.length ? ['', '— fin de minute.log (sessions précédentes comprises) —', ...tail] : []),
    '```',
  ].join('\n');
  return sanitize(body);
}
