// Langue de l'interface : français (langue source), anglais, italien.
// La clé de chaque traduction est la phrase française telle qu'elle est écrite dans le code :
//   t('Nouvelle réunion')                  → « New meeting » en anglais
//   t('Version {v}', { v: '0.4.0' })       → variables entre accolades
// Règle : t() s'appelle au moment d'afficher (jamais au chargement d'un module), pour suivre la langue choisie.
import en from './locales/en.json';
import it from './locales/it.json';

export type Lang = 'fr' | 'en' | 'it';
export type UiLanguage = 'auto' | Lang;

const DICTS: Record<Exclude<Lang, 'fr'>, Record<string, string>> = { en, it };
let lang: Lang = 'fr';

export const getLang = () => lang;
export const setLang = (l: Lang) => {
  lang = l;
};

/** Langue effective : choisie dans les réglages, sinon celle du système (anglais par défaut hors fr/it). */
export function resolveLang(setting: UiLanguage | undefined, systemLocale: string): Lang {
  if (setting && setting !== 'auto') return setting;
  const l = (systemLocale || '').toLowerCase();
  if (l.startsWith('fr')) return 'fr';
  if (l.startsWith('it')) return 'it';
  return 'en';
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = lang === 'fr' ? fr : (DICTS[lang][fr] ?? fr);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Locale des dates et nombres. */
export const locale = () => (lang === 'en' ? 'en-GB' : lang === 'it' ? 'it-IT' : 'fr-FR');

/** Nom de la langue de l'interface, pour dire à l'IA dans quelle langue répondre. */
export const langName = () => (lang === 'en' ? 'anglais' : lang === 'it' ? 'italien' : 'français');
