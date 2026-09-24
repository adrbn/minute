// Détection automatique des visios (Windows) : Windows tient à jour, pour chaque
// application, l'usage du micro (Paramètres › Confidentialité › Microphone).
// Quand Teams, Zoom, Meet (navigateur)… se met à utiliser le micro, Minute
// propose de transcrire ; quand il le relâche, Minute propose d'arrêter.
import { execFile } from 'node:child_process';

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

// `name` sert aussi d'identifiant : il reste en français ici, main.ts le traduit par t() pour l'afficher
const APPS: { re: RegExp; name: string }[] = [
  { re: /msteams|ms-teams|teams\.exe|microsoftteams/i, name: 'Teams' },
  { re: /zoom/i, name: 'Zoom' },
  { re: /webex|ciscocollab/i, name: 'Webex' },
  { re: /slack/i, name: 'Slack' },
  { re: /whatsapp/i, name: 'WhatsApp' },
  { re: /skype/i, name: 'Skype' },
  { re: /discord/i, name: 'Discord' },
  { re: /chrome\.exe|msedge\.exe|firefox\.exe|brave\.exe|opera|arc\.exe|vivaldi/i, name: 'votre navigateur (Meet, Teams web…)' },
];

function appName(key: string): string | null {
  if (/electron\.exe|minute\.exe/i.test(key)) return null; // Minute lui-même
  return APPS.find((a) => a.re.test(key))?.name ?? null;
}

/** Applications de visio qui utilisent le micro en ce moment. */
function micUsers(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile('reg', ['query', KEY, '/s', '/v', 'LastUsedTimeStop'], { windowsHide: true, timeout: 4000 }, (_err, stdout) => {
      const users = new Set<string>();
      // reg peut sortir en erreur pour une clé sans valeur tout en listant les autres
      if (!stdout) return resolve(users);
      let current = '';
      for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith('HKEY_')) current = line;
        else if (/LastUsedTimeStop\s+REG_QWORD\s+0x0\s*$/i.test(line)) {
          const name = appName(current);
          if (name) users.add(name);
        }
      }
      resolve(users);
    });
  });
}

export interface DetectorEvents {
  started(app: string): void;
  ended(app: string): void;
}

export function startMeetingDetector(enabled: () => boolean, ev: DetectorEvents) {
  if (process.platform !== 'win32') return () => undefined;
  let prev = new Set<string>();
  let releasedAt = new Map<string, number>();
  const tick = async () => {
    if (!enabled()) {
      prev = new Set();
      return;
    }
    const now = await micUsers();
    for (const app of now) {
      if (!prev.has(app) && !releasedAt.has(app)) ev.started(app);
      releasedAt.delete(app);
    }
    // un micro coupé 30 s (et pas juste « muet ») = fin de la visio
    for (const app of prev) if (!now.has(app) && !releasedAt.has(app)) releasedAt.set(app, Date.now());
    for (const [app, t] of releasedAt) {
      if (now.has(app)) releasedAt.delete(app);
      else if (Date.now() - t > 30_000) {
        releasedAt.delete(app);
        ev.ended(app);
      }
    }
    prev = new Set([...now, ...releasedAt.keys()]);
  };
  const timer = setInterval(() => void tick(), 4000);
  void tick();
  return () => {
    clearInterval(timer);
    releasedAt = new Map();
  };
}
