// Fournisseurs d'IA pour les comptes-rendus.
//  - Groq / Gemini / OpenAI : API « chat completions » compatibles (streaming SSE).
//  - Claude : SDK officiel Anthropic.
import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from '../shared/types';
import { settings } from './settings';

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
  /** tâche courte et pressée (rattrapage, question) */
  quick?: boolean;
  onText?: (full: string) => void;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'context' | 'network' | 'other',
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

const BASES: Record<Exclude<LlmProvider, 'anthropic'>, string> = {
  groq: process.env.MINUTE_GROQ_BASE || 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
};

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  groq: 'Groq',
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'OpenAI',
};

/** Débit (tokens/minute) annoncé par Groq pour chaque modèle, lu dans les en-têtes de réponse. */
const groqTpm = new Map<string, number>();

/** Taille d'entrée « confortable » par fournisseur (en tokens estimés). */
export function inputBudget(provider: LlmProvider, model = ''): number {
  switch (provider) {
    case 'groq': {
      // offre gratuite : quelques milliers de tokens/min, réponse comprise
      const tpm = groqTpm.get(model);
      return tpm ? Math.max(3_000, Math.min(60_000, Math.floor(tpm * 0.5))) : 4_000;
    }
    case 'openai':
      return 150_000;
    default:
      return 400_000;
  }
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 3.2);

export function activeProvider(): { provider: LlmProvider; model: string } | null {
  const cfg = settings().get();
  const ordered: LlmProvider[] = [cfg.llmProvider, 'groq', 'anthropic', 'gemini', 'openai'];
  for (const p of ordered) {
    if (settings().secret(p)) return { provider: p, model: cfg.llmModels[p] };
  }
  return null;
}

export async function chat(provider: LlmProvider, model: string, req: ChatRequest): Promise<string> {
  const key = settings().secret(provider);
  if (!key) throw new LlmError(`Aucune clé ${PROVIDER_LABEL[provider]} configurée`, 'auth');
  if (provider === 'anthropic') return chatClaude(key, model, req);
  return chatOpenAiCompatible(provider, key, model, req);
}

async function chatOpenAiCompatible(
  provider: Exclude<LlmProvider, 'anthropic'>,
  key: string,
  model: string,
  req: ChatRequest,
  plain = false,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_completion_tokens: req.maxTokens ?? 4096,
  };
  if (!plain && provider === 'groq' && model.startsWith('openai/gpt-oss')) {
    body.reasoning_effort = req.quick ? 'low' : 'medium';
    body.include_reasoning = false;
  }
  let res: Response;
  try {
    res = await fetch(`${BASES[provider]}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new LlmError(`Réseau indisponible (${(e as Error).message})`, 'network');
  }
  if (provider === 'groq') {
    const tpm = Number(res.headers.get('x-ratelimit-limit-tokens'));
    if (Number.isFinite(tpm) && tpm > 0) groqTpm.set(model, tpm);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // paramètre de raisonnement refusé par ce modèle : on relance sans
    if (res.status === 400 && 'reasoning_effort' in body && /reasoning|include_reasoning|unsupported|unknown/i.test(text)) {
      return chatOpenAiCompatible(provider, key, model, req, true);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError(`Clé ${PROVIDER_LABEL[provider]} refusée`, 'auth');
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new LlmError('Limite atteinte', 'rate', Number.isFinite(ra) && ra > 0 ? ra * 1000 : 30_000);
    }
    if (res.status === 413 || /context|too (long|large)|maximum.*tokens|reduce the length/i.test(text)) {
      throw new LlmError('Texte trop long pour ce modèle', 'context');
    }
    throw new LlmError(`${PROVIDER_LABEL[provider]} : erreur ${res.status} ${text.slice(0, 240)}`, 'other');
  }
  let full = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
        if (json.error) throw new LlmError(json.error.message ?? 'Erreur du modèle', 'other');
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          req.onText?.(full);
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
      }
    }
  }
  return full.trim();
}

async function chatClaude(key: string, model: string, req: ChatRequest): Promise<string> {
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  let full = '';
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: req.quick ? 16000 : 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: req.quick ? 'low' : 'medium' },
        // si le modèle décline, l'API relance la demande sur le modèle de secours recommandé
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
      { signal: req.signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        full += event.delta.text;
        req.onText?.(full);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new LlmError('Claude a décliné cette demande.', 'other');
    return full.trim();
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new LlmError('Clé Claude refusée', 'auth');
    }
    if (error instanceof Anthropic.RateLimitError) throw new LlmError('Limite Claude atteinte', 'rate', 30_000);
    if (error instanceof Anthropic.BadRequestError) throw new LlmError(`Claude : ${error.message}`, 'other');
    if (error instanceof Anthropic.APIConnectionError) throw new LlmError('Réseau indisponible', 'network');
    if (error instanceof Anthropic.APIError) throw new LlmError(`Claude : erreur ${error.status}`, 'other');
    throw error;
  }
}

/** Petite vérification de clé (et liste des modèles pour les menus). */
export async function listModels(provider: LlmProvider): Promise<string[]> {
  const key = settings().secret(provider);
  if (!key) return [];
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    const out: string[] = [];
    for await (const m of client.models.list()) out.push(m.id);
    return out;
  }
  const res = await fetch(`${BASES[provider]}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new LlmError('Clé refusée', 'auth');
  if (!res.ok) throw new LlmError(`Erreur ${res.status}`, 'other');
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? [])
    .map((m) => m.id.replace(/^models\//, ''))
    .filter((id) => !/whisper|tts|embed|guard|orpheus|playai|distil|moderation|dall-e|image|audio|realtime|transcribe|search/i.test(id))
    .sort();
}
