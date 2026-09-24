// Client Groq Whisper + « budget » qui respecte les limites du compte
// (offre gratuite : 20 requêtes/min, 7 200 s d'audio facturées par heure,
// chaque requête comptant au minimum 10 s).
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
  noSpeech: number;
  avgLogprob: number;
  compression: number;
}

interface VerboseSegment {
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}

// MINUTE_GROQ_BASE : serveur de test local (scripts/mock-groq.mjs)
const ENDPOINT = `${process.env.MINUTE_GROQ_BASE || 'https://api.groq.com/openai/v1'}/audio/transcriptions`;

export async function transcribe(
  key: string,
  wav: Buffer,
  opts: { model: string; language: string; prompt: string; timeoutMs?: number },
  budget?: Budget,
): Promise<SttResult> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', opts.model);
  if (opts.language && opts.language !== 'auto') fd.append('language', opts.language);
  if (opts.prompt) fd.append('prompt', opts.prompt);
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
  } catch (e) {
    throw new SttError(`Réseau indisponible (${(e as Error).message})`, 'network');
  }
  budget?.observeHeaders(res.headers);
  if (res.status === 401 || res.status === 403) throw new SttError('Clé Groq refusée', 'auth');
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    throw new SttError('Limite Groq atteinte', 'rate', Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000);
  }
  if (res.status >= 500) throw new SttError(`Groq indisponible (${res.status})`, 'server');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SttError(`Groq a refusé l'audio (${res.status}) ${body.slice(0, 200)}`, 'bad');
  }
  const json = (await res.json()) as { text?: string; segments?: VerboseSegment[] };
  const segs = json.segments ?? [];
  const avg = (f: (s: VerboseSegment) => number | undefined, dflt: number) =>
    segs.length ? segs.reduce((a, s) => a + (f(s) ?? dflt), 0) / segs.length : dflt;
  return {
    text: (json.text ?? '').trim(),
    noSpeech: avg((s) => s.no_speech_prob, 0),
    avgLogprob: avg((s) => s.avg_logprob, 0),
    compression: avg((s) => s.compression_ratio, 1),
  };
}

type Priority = 'final' | 'interim';

export class Budget {
  private rpm = 20;
  private ash = 7200;
  private requests: number[] = [];
  private audio: { t: number; sec: number }[] = [];
  private blockedUntil = 0;
  tier: 'free' | 'paid' = 'free';

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
    const rpmCap = Math.floor(this.rpm * (priority === 'final' ? 0.9 : 0.55));
    const ashCap = this.ash * (priority === 'final' ? 0.97 : 0.6);
    if (this.requests.length >= rpmCap) {
      if (priority === 'interim') return Infinity;
      return 60_000 - (now - this.requests[0]) + 50;
    }
    if (this.audioUsed() + billed > ashCap) {
      if (priority === 'interim') return Infinity;
      let used = this.audioUsed();
      for (const a of this.audio) {
        used -= a.sec;
        if (used + billed <= ashCap) return 3_600_000 - (now - a.t) + 50;
      }
      return 60_000;
    }
    return 0;
  }

  record(durationSec: number) {
    const now = Date.now();
    this.requests.push(now);
    this.audio.push({ t: now, sec: Math.max(10, durationSec) });
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
  }

  get usageLabel(): string {
    this.prune(Date.now());
    return `${Math.round(this.audioUsed())} s / ${this.ash} s par heure`;
  }
}
