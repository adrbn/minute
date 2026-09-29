// Mode de transcription : en ligne (Groq) ou hors ligne (le serveur personnel). Un seul actif à la fois ;
// les réglages et la clé de l'autre restent enregistrés pour y revenir d'un clic.
import { t } from './i18n';
import type { Settings } from './types';

export type SttMode = Settings['sttMode'] & string;

/** Mode actif. Réglages d'avant le choix : le serveur s'il est configuré (il passait déjà en premier), sinon Groq. */
export function sttModeOf(cfg: Pick<Partial<Settings>, 'sttMode' | 'sttServerUrl'>): SttMode {
  if (cfg.sttMode === 'cloud' || cfg.sttMode === 'server') return cfg.sttMode;
  return (cfg.sttServerUrl ?? '').trim() ? 'server' : 'cloud';
}

/** Ce qui manque pour transcrire dans le mode actif (message à afficher), ou null si tout est prêt. */
export function sttMissing(cfg: Pick<Partial<Settings>, 'sttMode' | 'sttServerUrl' | 'privacyMode'>, hasGroqKey: boolean): string | null {
  if (cfg.privacyMode) return null; // mode confidentiel : transcription sur cet ordinateur
  if (sttModeOf(cfg) === 'server') {
    return (cfg.sttServerUrl ?? '').trim() ? null : t('Indiquez l’adresse de votre serveur pour transcrire hors ligne');
  }
  return hasGroqKey ? null : t('Ajoutez votre clé Groq pour activer la transcription');
}
