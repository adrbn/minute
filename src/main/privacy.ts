// Mode confidentiel (RGPD) : tout reste sur cet ordinateur.
// - verrou réseau : toute connexion sortante hors de la machine est refusée
//   (un seul point de passage, vérifiable) ;
// - la transcription passe par le moteur local (localStt.ts), l'audio est effacé
//   dès la transcription et les réunions expirées sont supprimées (main.ts).
import { session } from 'electron';
import { t } from '../shared/i18n';

let enabled = false;
export const privacyOn = () => enabled;
export const setPrivacy = (on: boolean) => (enabled = on);

// ------------------------------------------------------------------ verrou réseau
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

export function isLocalUrl(input: string | URL): boolean {
  try {
    const u = typeof input === 'string' ? new URL(input) : input;
    if (['app:', 'minute-audio:', 'file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:'].includes(u.protocol)) return true;
    return LOCAL.test(u.hostname);
  } catch {
    return false;
  }
}

export class BlockedError extends Error {
  constructor(host: string) {
    super(t('Mode confidentiel : connexion vers {host} bloquée — rien ne sort de cet ordinateur.', { host }));
  }
}

let installed = false;
/** Installe le verrou sur fetch (process principal) et sur les fenêtres. */
export function installNetworkGuard() {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (enabled && !isLocalUrl(url)) {
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        /* url illisible */
      }
      return Promise.reject(new BlockedError(host));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: enabled && !isLocalUrl(details.url) });
  });
}

/** Message à coller dans la conversation de la visio (exact : il ne promet que ce que l'app garantit). */
export function participantNotice(local: boolean, name: string): string {
  // « Moi » : nom par défaut (valeur enregistrée dans les réglages), jamais traduit
  const named = !!name && name !== 'Moi';
  // une phrase entière par cas : l'accord (« son » / « mon ») change selon la langue
  if (local) {
    return named
      ? t('Pour information : {name} utilise Minute pour la prise de notes de cette réunion. La transcription est faite sur son ordinateur : aucun son ni aucun texte n’est envoyé à un service extérieur, l’audio est effacé aussitôt transcrit, et les notes sont supprimées automatiquement après la durée de conservation. Dites-le si vous ne le souhaitez pas.', { name })
      : t('Pour information : J’utilise Minute pour la prise de notes de cette réunion. La transcription est faite sur mon ordinateur : aucun son ni aucun texte n’est envoyé à un service extérieur, l’audio est effacé aussitôt transcrit, et les notes sont supprimées automatiquement après la durée de conservation. Dites-le si vous ne le souhaitez pas.');
  }
  return named
    ? t('Pour information : {name} utilise Minute pour la prise de notes de cette réunion : les échanges sont transcrits automatiquement par un service en ligne, et la transcription est conservée sur son ordinateur. Dites-le si vous ne le souhaitez pas.', { name })
    : t('Pour information : J’utilise Minute pour la prise de notes de cette réunion : les échanges sont transcrits automatiquement par un service en ligne, et la transcription est conservée sur mon ordinateur. Dites-le si vous ne le souhaitez pas.');
}
