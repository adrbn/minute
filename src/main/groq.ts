// Client Groq Whisper + « budget » qui respecte les limites du compte
// (offre gratuite : 20 requêtes/min, 7 200 s d'audio facturées par heure,
// chaque requête comptant au minimum 10 s).
import { t } from '../shared/i18n';

export class SttError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'network' | 'server' | 'bad',
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

export interface SttResult {
  text: string;
  /** langue détectée (code ISO à deux lettres), en détection automatique */
  language?: string;
  noSpeech: number;
  avgLogprob: number;
  compression: number;
  /** avec `words` : les segments de Whisper (secondes) et chaque mot horodaté */
  segments?: SttSegment[];
  words?: { start: number; end: number }[];
}

export interface SttSegment {
  start: number;
  end: number;
  text: string;
  noSpeech: number;
  avgLogprob: number;
  compression: number;
}

interface VerboseSegment {
  start?: number;
  end?: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}

// MINUTE_GROQ_BASE : serveur de test local (scripts/mock-groq.mjs)
const GROQ_BASE = process.env.MINUTE_GROQ_BASE || 'https://api.groq.com/openai/v1';

/** Adresse de transcription d'un serveur compatible OpenAI : « http://asgard:8000 » → « http://asgard:8000/v1/audio/transcriptions ». */
export function sttEndpoint(base?: string): string {
  let b = (base || GROQ_BASE).trim().replace(/\/+$/, '');
  if (/\/audio\/transcriptions$/.test(b)) return b;
  if (!/\/v\d+$/.test(b)) b += '/v1';
  return `${b}/audio/transcriptions`;
}

export async function transcribe(
  key: string,
  wav: Buffer,
  opts: { model: string; language: string; prompt: string; timeoutMs?: number; words?: boolean; base?: string },
  budget?: Budget,
): Promise<SttResult> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  if (opts.model) fd.append('model', opts.model);
  if (opts.language && opts.language !== 'auto') fd.append('language', opts.language);
  if (opts.prompt) fd.append('prompt', opts.prompt);
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  // phrases groupées : l'horodatage des mots permet de rendre à chacune son texte
  if (opts.words) {
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
  }

  let res: Response;
  try {
    res = await fetch(sttEndpoint(opts.base), {
      method: 'POST',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      body: fd,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
  } catch (e) {
    throw new SttError(t('Réseau indisponible ({error})', { error: (e as Error).message }), 'network');
  }
  budget?.observeHeaders(res.headers);
  // serveur personnel : mêmes erreurs, mais nommées comme telles
  const own = !!opts.base;
  if (res.status === 401 || res.status === 403) throw new SttError(own ? t('Clé du serveur personnel refusée') : t('Clé Groq refusée'), 'auth');
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    throw new SttError(own ? t('Serveur personnel saturé') : t('Limite Groq atteinte'), 'rate', Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000);
  }
  if (res.status >= 500) {
    throw new SttError(own ? t('Serveur personnel indisponible ({status})', { status: res.status }) : t('Groq indisponible ({status})', { status: res.status }), 'server');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body.slice(0, 200);
    throw new SttError(
      own
        ? t('Le serveur personnel a refusé l’audio ({status}) {details}', { status: res.status, details })
        : t('Groq a refusé l\'audio ({status}) {details}', { status: res.status, details }),
      'bad',
    );
  }
  const json = (await res.json()) as {
    text?: string;
    segments?: VerboseSegment[];
    words?: { start?: number; end?: number }[];
    language?: string;
  };
  const segs = json.segments ?? [];
  const avg = (f: (s: VerboseSegment) => number | undefined, dflt: number) =>
    segs.length ? segs.reduce((a, s) => a + (f(s) ?? dflt), 0) / segs.length : dflt;
  return {
    text: (json.text ?? '').trim(),
    language: languageCode(json.language),
    noSpeech: avg((s) => s.no_speech_prob, 0),
    avgLogprob: avg((s) => s.avg_logprob, 0),
    compression: avg((s) => s.compression_ratio, 1),
    ...(opts.words
      ? {
          segments: segs.map((s) => ({
            start: s.start ?? 0,
            end: s.end ?? 0,
            text: s.text ?? '',
            noSpeech: s.no_speech_prob ?? 0,
            avgLogprob: s.avg_logprob ?? 0,
            compression: s.compression_ratio ?? 1,
          })),
          words: (json.words ?? []).map((w) => ({ start: w.start ?? 0, end: w.end ?? 0 })),
        }
      : {}),
  };
}

/** Whisper renvoie le nom anglais de la langue (« french ») ou son code : on garde le code. */
const LANG_CODES: Record<string, string> = {
  english: 'en', french: 'fr', italian: 'it', spanish: 'es', german: 'de', portuguese: 'pt', dutch: 'nl',
  catalan: 'ca', romanian: 'ro', polish: 'pl', russian: 'ru', ukrainian: 'uk', arabic: 'ar', turkish: 'tr',
  greek: 'el', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', czech: 'cs', hungarian: 'hu',
  chinese: 'zh', japanese: 'ja', korean: 'ko', hindi: 'hi', hebrew: 'he', persian: 'fa', vietnamese: 'vi',
  indonesian: 'id', thai: 'th', malay: 'ms', welsh: 'cy', latin: 'la',
};
export function languageCode(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return LANG_CODES[v] ?? (/^[a-z]{2}$/.test(v) ? v : undefined);
}

type Priority = 'final' | 'interim';

/** Durées des en-têtes de Groq (« 2m46.5s », « 15h7m12s », « 800ms ») → millisecondes. */
export function parseGroqDuration(s: string | null): number {
  if (!s) return NaN;
  let ms = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    found = true;
    const v = parseFloat(m[1]);
    ms += m[2] === 'h' ? v * 3_600_000 : m[2] === 'm' ? v * 60_000 : m[2] === 's' ? v * 1000 : v;
  }
  return found ? ms : NaN;
}

export class Budget {
  private rpm = 20;
  private ash = 7200;
  private requests: number[] = [];
  private audio: { t: number; sec: number }[] = [];
  private blockedUntil = 0;
  tier: 'free' | 'paid' = 'free';
  /**
   * Ce que Groq dit du compte après chaque réponse : c'est le vrai reste, toutes applications confondues
   * (Natively ou un autre outil avec la même clé consomme le même quota). Le quota audio se remplit en
   * continu (7 200 s par heure, soit 2 s par seconde).
   */
  private remote: { audio: number; at: number } | null = null;
  private day: { requests: number; resetAt: number; sent: number } | null = null;
  /** pourquoi la dernière attente (pour un message juste) */
  lastReason: 'rpm' | 'audio' | 'day' | null = null;

  private prune(now: number) {
    this.requests = this.requests.filter((t) => now - t < 60_000);
    this.audio = this.audio.filter((a) => now - a.t < 3_600_000);
  }

  private audioUsed() {
    return this.audio.reduce((a, b) => a + b.sec, 0);
  }

  /** Délai (ms) avant de pouvoir envoyer ; 0 = maintenant. */
  delayFor(durationSec: number, priority: Priority): number {
    const now = Date.now();
    this.prune(now);
    if (now < this.blockedUntil) return this.blockedUntil - now;
    const billed = Math.max(10, durationSec);
    // requêtes du jour presque épuisées : on garde les dernières pour les vraies transcriptions
    if (this.day && now < this.day.resetAt) {
      const left = this.day.requests - this.day.sent;
      if (left <= (priority === 'final' ? 3 : 300)) {
        if (priority === 'interim') return Infinity;
        this.lastReason = 'day';
        return this.day.resetAt - now + 1000;
      }
    }
    // reste réel annoncé par Groq (récent) : il prime sur notre propre compte
    if (this.remote && this.tier === 'free' && now - this.remote.at < 15 * 60_000) {
      const left = this.remoteLeft(now);
      const keep = this.ash * (priority === 'final' ? 0.03 : 0.7);
      if (left - billed < keep) {
        if (priority === 'interim') return Infinity;
        this.lastReason = 'audio';
        return Math.ceil(((billed + keep - left) / (this.ash / 3600)) * 1000) + 50;
      }
      if (this.requests.length >= Math.floor(this.rpm * (priority === 'final' ? 0.9 : 0.55))) {
        if (priority === 'interim') return Infinity;
        this.lastReason = 'rpm';
        return 60_000 - (now - this.requests[0]) + 50;
      }
      return 0;
    }
    const rpmCap = Math.floor(this.rpm * (priority === 'final' ? 0.9 : 0.55));
    // les aperçus en direct s'arrêtent tôt : le quota horaire va d'abord aux vraies transcriptions
    const ashCap = this.ash * (priority === 'final' ? 0.97 : 0.3);
    if (this.requests.length >= rpmCap) {
      if (priority === 'interim') return Infinity;
      this.lastReason = 'rpm';
      return 60_000 - (now - this.requests[0]) + 50;
    }
    if (this.audioUsed() + billed > ashCap) {
      if (priority === 'interim') return Infinity;
      this.lastReason = 'audio';
      let used = this.audioUsed();
      for (const a of this.audio) {
        used -= a.sec;
        if (used + billed <= ashCap) return 3_600_000 - (now - a.t) + 50;
      }
      return 60_000;
    }
    return 0;
  }

  /** Reste du quota audio estimé maintenant, d'après la dernière réponse de Groq. */
  private remoteLeft(now: number): number {
    if (!this.remote) return Infinity;
    const r = this.remote;
    const refill = ((now - r.at) / 1000) * (this.ash / 3600);
    const sent = this.audio.filter((a) => a.t > r.at).reduce((s, a) => s + a.sec, 0);
    return Math.min(this.ash, r.audio + refill) - sent;
  }

  /** Part du quota déjà consommée (0 à 1), toutes applications confondues si Groq l'a dit ; 0 sur un compte payant. */
  pressure(): number {
    if (this.tier === 'paid') return 0;
    const now = Date.now();
    this.prune(now);
    let p = this.remote && now - this.remote.at < 15 * 60_000 ? 1 - Math.max(0, this.remoteLeft(now)) / this.ash : this.audioUsed() / this.ash;
    // peu de requêtes restantes aujourd'hui : on groupe tout
    if (this.day && now < this.day.resetAt && this.day.requests - this.day.sent < 400) p = Math.max(p, 1);
    return Math.min(1, Math.max(0, p));
  }

  record(durationSec: number) {
    const now = Date.now();
    this.requests.push(now);
    this.audio.push({ t: now, sec: Math.max(10, durationSec) });
    if (this.day) this.day.sent++;
  }

  block(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  /** Les en-têtes révèlent l'offre : au-delà de 2 000 requêtes/jour, c'est un compte payant. */
  observeHeaders(h: Headers) {
    const perDay = Number(h.get('x-ratelimit-limit-requests'));
    if (Number.isFinite(perDay) && perDay > 2000 && this.tier === 'free') {
      this.tier = 'paid';
      this.rpm = 300;
      this.ash = 1_000_000;
    }
    if (this.tier === 'paid') return;
    const num = (k: string) => (h.get(k) === null ? NaN : Number(h.get(k)));
    const limit = num('x-ratelimit-limit-audio-seconds');
    if (limit > 0) this.ash = limit;
    const audio = num('x-ratelimit-remaining-audio-seconds');
    if (Number.isFinite(audio)) this.remote = { audio, at: Date.now() };
    const requests = num('x-ratelimit-remaining-requests');
    const reset = parseGroqDuration(h.get('x-ratelimit-reset-requests'));
    if (Number.isFinite(requests)) this.day = { requests, sent: 0, resetAt: Date.now() + (Number.isFinite(reset) ? reset : 3_600_000) };
  }

  get usageLabel(): string {
    this.prune(Date.now());
    return t('{used} s / {max} s par heure', { used: Math.round(this.audioUsed()), max: this.ash });
  }
}
