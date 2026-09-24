// Mises à jour : Minute regarde les versions publiées sur GitHub au démarrage, puis toutes les 6 h.
// - Windows : la nouvelle version se télécharge en arrière-plan ; on propose de redémarrer pour
//   l'installer (jamais pendant une réunion), sinon elle s'installe d'elle-même à la fermeture.
// - macOS : sans notarisation Apple, l'installation automatique est impossible : on propose
//   de télécharger la nouvelle version.
// - Mode confidentiel : aucune connexion vers l'extérieur, donc pas de vérification.
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import type { UpdateState } from '../shared/types';
import { diagLog } from './diag';
import { t } from '../shared/i18n';

const RELEASES = 'https://github.com/adrbn/minute/releases/latest';
const canInstall = process.platform === 'win32';

let state: UpdateState = { status: 'idle', current: app.getVersion(), canInstall, url: RELEASES };
let notify: (s: UpdateState) => void = () => undefined;
let enabled: () => { auto: boolean; privacy: boolean } = () => ({ auto: true, privacy: false });

const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  notify(state);
};
export const updateState = () => state;

/** Notes de version (HTML de GitHub) → texte simple, lisible dans la fenêtre. */
function notesOf(info: UpdateInfo): string {
  const raw = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((n) => n.note ?? '').join('\n')
    : (info.releaseNotes ?? '');
  return raw
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|li|h\d|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

export function initUpdater(opts: { notify: (s: UpdateState) => void; enabled: () => { auto: boolean; privacy: boolean } }) {
  notify = opts.notify;
  enabled = opts.enabled;
  // démonstration (profil de test uniquement) : une mise à jour prête, pour vérifier la fenêtre
  if (process.env.MINUTE_UPDATE_DEMO) {
    setTimeout(
      () =>
        set({
          status: canInstall ? 'ready' : 'available',
          version: '9.9.9',
          notes: t('• Exemple de note de version\n• Affiché uniquement avec MINUTE_UPDATE_DEMO'),
        }),
      4000,
    );
    return;
  }
  if (!app.isPackaged) return set({ status: 'disabled', reason: t('Version de développement') });

  autoUpdater.logger = null;
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }));
  autoUpdater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) =>
    set({ status: canInstall ? 'downloading' : 'available', version: info.version, notes: notesOf(info), percent: 0, checkedAt: Date.now() }),
  );
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, notes: notesOf(info) || state.notes }));
  autoUpdater.on('error', (e) => {
    diagLog('mise à jour', e?.message?.split('\n')[0] ?? 'erreur');
    set({ status: 'error', error: e?.message?.split('\n')[0] ?? t('Erreur inconnue'), checkedAt: Date.now() });
  });

  setTimeout(() => void checkForUpdates(false), 10_000);
  setInterval(() => void checkForUpdates(false), 6 * 3600_000);
}

/** `manual` : demandé depuis les réglages (même si les mises à jour automatiques sont coupées). */
export async function checkForUpdates(manual = true): Promise<UpdateState> {
  if (state.status === 'disabled' && !app.isPackaged) return state;
  const { auto, privacy } = enabled();
  if (privacy) {
    set({ status: 'disabled', reason: t('Mode confidentiel : aucune connexion vers l’extérieur') });
    return state;
  }
  if (!auto && !manual) return state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: 'error', error: (e as Error).message.split('\n')[0], checkedAt: Date.now() });
  }
  return state;
}

/** Windows : ferme Minute, installe la nouvelle version et la relance. */
export function installUpdate() {
  if (state.status !== 'ready' || !canInstall) return;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
