// Tout ce que l'IA fait pour l'utilisateur : compte-rendu, rattrapage,
// questions sur la réunion, e-mail de suivi.
import { clock, dateLabel, durationLabel, transcriptForAi } from '../shared/transcript';
import type { AiEvent, AiRequest, MeetingMeta, Segment } from '../shared/types';
import { activeProvider, chat, estimateTokens, inputBudget, LlmError, PROVIDER_LABEL } from './llm';
import { settings } from './settings';
import { newId, store } from './store';

type Emit = (e: AiEvent) => void;

const running = new Map<string, AbortController>();

function context(meta: MeetingMeta) {
  const cfg = settings().get();
  const me = meta.speakers.me || cfg.meName || 'Moi';
  return `Tu assistes ${me === 'Moi' ? 'l’utilisateur' : me} dans ses réunions de travail. La transcription est automatique (Whisper) :
- « ${me} » = la personne qui utilise l’app (son micro) ; « ${meta.speakers.them || 'Eux'} » = les autres participants (son de l’ordinateur, plusieurs personnes possibles).
- Elle peut contenir des erreurs de reconnaissance : corrige silencieusement les mots manifestement mal transcrits grâce au contexte, sans jamais inventer de faits.
- Réponds en français, avec un ton professionnel, clair et direct.`;
}

function header(meta: MeetingMeta) {
  return `Réunion : ${meta.title}\nDate : ${dateLabel(meta.startedAt)} — durée ${durationLabel(meta.durationMs)}`;
}

function extras(meta: MeetingMeta, segments: Segment[]) {
  const parts: string[] = [];
  if (meta.notes.trim()) {
    parts.push(`Notes prises pendant la réunion (prioritaires : elles disent ce qui compte pour l’utilisateur) :\n${meta.notes.trim()}`);
  }
  if (meta.bookmarks.length) {
    const lines = meta.bookmarks.map((b) => {
      const around = segments
        .filter((s) => s.t1 >= b.t - 20_000 && s.t0 <= b.t + 25_000)
        .map((s) => s.text)
        .join(' ')
        .slice(0, 400);
      return `- [${clock(b.t)}] ${b.label}${around ? ` — « ${around} »` : ''}`;
    });
    parts.push(`Moments marqués comme importants par l’utilisateur :\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

const SUMMARY_FORMAT = `Rédige le compte-rendu en Markdown, exactement dans ce format (omets une section qui serait vide) :

# <titre court et précis de la réunion, 3 à 8 mots, sans date>

## En bref
<2 à 4 phrases : de quoi il s’agissait et ce qui en ressort>

## Décisions
- <décision prise>

## Actions
- [ ] **<Qui>** — <quoi> (<échéance si mentionnée>)

## Points clés
### <Thème>
- <information utile : chiffres, noms, dates, arguments>

## Questions ouvertes
- <question restée sans réponse ou point à clarifier>

Règles : sois fidèle et concret (chiffres, noms, dates exacts) ; pas de remplissage ; n’invente aucune action ni décision ; les moments marqués et les notes de l’utilisateur doivent apparaître.`;

async function withRetry<T>(fn: () => Promise<T>, onWait: (s: string) => void, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmError && e.kind === 'rate' && attempt < 4 && !signal.aborted) {
        const wait = Math.min(65_000, e.retryAfterMs || 30_000);
        onWait(`Limite atteinte, reprise dans ${Math.ceil(wait / 1000)} s…`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

function chunkTranscript(text: string, maxTokens: number): string[] {
  const maxChars = Math.floor(maxTokens * 3.2);
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > maxChars) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function cancelAi(requestId: string) {
  running.get(requestId)?.abort();
}

export async function runAi(req: AiRequest, emit: Emit): Promise<string> {
  const requestId = newId();
  const ctrl = new AbortController();
  running.set(requestId, ctrl);
  const send = (text: string, done = false, extra: Partial<AiEvent> = {}) =>
    emit({ requestId, meetingId: req.meetingId, kind: req.kind, text, done, ...extra });

  void (async () => {
    try {
      const meta = store.meta(req.meetingId);
      if (!meta) throw new Error('Réunion introuvable');
      const active = activeProvider();
      if (!active) throw new Error('Ajoutez une clé d’IA (Groq suffit) dans les Réglages.');
      const { provider, model } = active;
      const segments = store.segments(req.meetingId).filter((s) => s.text);
      const call = (system: string, user: string, opts: { quick?: boolean; maxTokens: number; onText?: (t: string) => void }) =>
        withRetry(
          () => chat(provider, model, { system, user, ...opts, signal: ctrl.signal }),
          (msg) => send('', false, { progress: msg }),
          ctrl.signal,
        );

      if (req.kind === 'catchup') {
        const minutes = req.minutes ?? 5;
        const now = segments.length ? segments[segments.length - 1].t1 : 0;
        const recent = segments.filter((s) => s.t1 >= now - minutes * 60_000);
        if (!recent.length) throw new Error('Rien n’a encore été dit sur cette période.');
        const text = await call(
          context(meta),
          `${header(meta)}\n\nVoici les ${minutes} dernières minutes :\n${transcriptForAi(meta, recent)}\n\nL’utilisateur a décroché un instant. Fais-lui un rattrapage express en 3 à 5 puces très courtes. Si on lui a posé une question, si on attend quelque chose de lui ou si une décision vient d’être prise, commence par cette ligne en **gras** avec ⚠️.`,
          { quick: true, maxTokens: 900, onText: (t) => send(t) },
        );
        send(text, true);
        return;
      }

      const full = transcriptForAi(meta, segments);
      const budget = inputBudget(provider);
      let material = full;
      let materialLabel = 'Transcription';

      // Réunion trop longue pour le modèle : notes détaillées par parties, puis synthèse.
      if (req.kind !== 'followup' && estimateTokens(full) > budget) {
        const chunks = chunkTranscript(full, Math.floor(budget * 0.85));
        const notes: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          send('', false, { progress: `Lecture de la réunion… partie ${i + 1}/${chunks.length}` });
          notes.push(
            await call(
              context(meta),
              `${header(meta)}\n\nPartie ${i + 1}/${chunks.length} de la transcription :\n${chunks[i]}\n\nExtrais des notes détaillées et fidèles de cette partie, en puces horodatées [mm:ss] : faits, chiffres, noms, décisions, actions (qui / quoi / quand), questions. Pas d’introduction.`,
              { quick: true, maxTokens: 1500 },
            ),
          );
        }
        material = notes.map((n, i) => `### Partie ${i + 1}\n${n}`).join('\n\n');
        materialLabel = 'Notes détaillées de la réunion (issues de la transcription)';
        send('', false, { progress: 'Rédaction du compte-rendu…' });
      }

      if (req.kind === 'summary') {
        const ex = extras(meta, segments);
        const text = await call(
          context(meta),
          `${header(meta)}\n\n${ex ? ex + '\n\n' : ''}${materialLabel} :\n${material}\n\n${SUMMARY_FORMAT}`,
          { maxTokens: 3500, onText: (t) => send(t) },
        );
        const { title, body } = splitTitle(text);
        const patch: Partial<MeetingMeta> = {
          summary: { markdown: body, generatedAt: Date.now(), provider: PROVIDER_LABEL[provider], model },
        };
        if (title && meta.titleIsAuto) {
          patch.title = title;
          patch.titleIsAuto = false;
        }
        store.update(meta.id, patch);
        send(body, true, { progress: title });
        return;
      }

      if (req.kind === 'ask') {
        const text = await call(
          context(meta),
          `${header(meta)}\n\n${materialLabel} :\n${material}\n\nQuestion : ${req.question}\n\nRéponds uniquement à partir de la réunion, en citant les moments utiles sous la forme [mm:ss]. Si l’information n’y est pas, dis-le simplement.`,
          { quick: true, maxTokens: 1500, onText: (t) => send(t) },
        );
        send(text, true);
        return;
      }

      if (req.kind === 'followup') {
        const base = meta.summary?.markdown
          ? `Compte-rendu :\n${meta.summary.markdown}`
          : `Transcription :\n${estimateTokens(full) > budget ? full.slice(-budget * 3) : full}`;
        const text = await call(
          context(meta),
          `${header(meta)}\n\n${base}\n\n${meta.notes ? `Notes : ${meta.notes}\n\n` : ''}Rédige l’e-mail de suivi que l’utilisateur enverra aux participants. Format :\nObjet : <objet>\n\n<corps : remerciement bref, récapitulatif des décisions, actions avec responsables et échéances, prochaine étape. Chaleureux, professionnel, concis. Signe avec [Prénom].>`,
          { quick: true, maxTokens: 1500, onText: (t) => send(t) },
        );
        store.update(meta.id, { followUp: text });
        send(text, true);
        return;
      }
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e as Error).name === 'AbortError';
      send('', true, { error: aborted ? 'Annulé' : (e as Error).message });
    } finally {
      running.delete(requestId);
    }
  })();

  return requestId;
}

function splitTitle(md: string): { title: string; body: string } {
  const m = /^\s*#\s+(.+?)\s*\n/.exec(md);
  if (!m) return { title: '', body: md.trim() };
  const title = m[1].replace(/[*_#]/g, '').trim().slice(0, 90);
  return { title, body: md.slice(m[0].length).trim() };
}
