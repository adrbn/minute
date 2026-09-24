// Tout ce que l'IA fait pour l'utilisateur : compte-rendu, rattrapage,
// questions sur la réunion, e-mail de suivi.
import { langName, t } from '../shared/i18n';
import { clock, dateLabel, durationLabel, speakerName, transcriptForAi } from '../shared/transcript';
import type { AiEvent, AiRequest, MeetingMeta, Segment } from '../shared/types';
import { activeProvider, chat, chatLocal, estimateTokens, findLocalLlm, inputBudget, LlmError, PROVIDER_LABEL } from './llm';
import { retrieve } from './retrieval';
import { settings } from './settings';
import { newId, store } from './store';

type Emit = (e: AiEvent) => void;

const running = new Map<string, AbortController>();

function context(meta: MeetingMeta) {
  // mêmes étiquettes que dans la transcription envoyée (elles suivent la langue de l'interface)
  const me = speakerName(meta, 'me');
  return `Tu assistes ${me === t('Moi') ? 'l’utilisateur' : me} dans ses réunions de travail. La transcription est automatique (Whisper) :
- « ${me} » = la personne qui utilise l’app (son micro) ; « ${speakerName(meta, 'them')} » = les autres participants, quand leurs voix ne sont pas distinguées.
- Les voix distinguées apparaissent sous leur nom ou « ${voiceLabels()} » (séparation automatique, qui peut parfois se tromper). Si la conversation montre clairement qui est un « Participant X » (on l'appelle par son prénom et c'est lui qui répond), désigne-le par ce prénom — sans jamais compter deux fois la même personne.
- Elle peut contenir des erreurs de reconnaissance : corrige silencieusement les mots manifestement mal transcrits grâce au contexte, sans jamais inventer de faits.
- Réponds en ${langName()}, avec un ton professionnel, clair et direct.`;
}

/** « Participant A, B, C… » dans la langue de l'interface. */
const voiceLabels = () => `${t('Participant {letter}', { letter: 'A' })}, B, C…`;

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

const summaryFormat = () => `Rédige le compte-rendu en Markdown et en ${langName()}, exactement dans ce format, avec ces titres de sections tels quels (omets une section qui serait vide) :

# <titre court et précis de la réunion, 3 à 8 mots, sans date>

## ${t('En bref')}
<2 à 4 phrases : de quoi il s’agissait et ce qui en ressort>

## ${t('Décisions')}
- <décision prise>

## ${t('Actions')}
- [ ] **<Qui>** — <quoi> (<échéance si mentionnée>)

## ${t('Points clés')}
### <Thème>
- <information utile : chiffres, noms, dates, arguments>

## ${t('Questions ouvertes')}
- <question restée sans réponse ou point à clarifier>

Règles : sois fidèle et concret (chiffres, noms, dates exacts) ; pas de remplissage ; n’invente aucune action ni décision ; n’ajoute aucun détail qui n’a pas été dit (pas de comparaison, de période ou de justification supposées) ; les moments marqués et les notes de l’utilisateur doivent apparaître.`;

async function withRetry<T>(fn: () => Promise<T>, onWait: (s: string) => void, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmError && e.kind === 'rate' && attempt < 4 && !signal.aborted) {
        const wait = Math.min(65_000, e.retryAfterMs || 30_000);
        onWait(t('Limite atteinte, reprise dans {s} s…', { s: Math.ceil(wait / 1000) }));
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
      if (!meta) throw new Error(t('Réunion introuvable.'));
      // mode confidentiel : seulement une IA installée sur cet ordinateur (le texte ne sort pas)
      const local = settings().get().privacyMode ? await findLocalLlm() : null;
      if (settings().get().privacyMode && !local) {
        throw new Error(t('Mode confidentiel : aucune IA locale détectée (Ollama ou LM Studio). La transcription, elle, fonctionne.'));
      }
      const active = local ? { provider: 'openai' as const, model: local.model } : activeProvider();
      // une IA locale peut mettre un moment à répondre : on le dit tout de suite
      if (local) send('', false, { progress: t('IA locale ({model}) : réponse en cours…', { model: local.model }) });
      if (!active) throw new Error(t('Ajoutez une clé d’IA (Groq suffit) dans les Réglages.'));
      const { provider, model } = active;
      const segments = store.segments(req.meetingId).filter((s) => s.text);
      const call = (system: string, user: string, opts: { quick?: boolean; maxTokens: number; onText?: (t: string) => void }) =>
        withRetry(
          () =>
            local
              ? chatLocal(local.base, local.model, { system, user, ...opts, signal: ctrl.signal })
              : chat(provider, model, { system, user, ...opts, signal: ctrl.signal }),
          (msg) => send('', false, { progress: msg }),
          ctrl.signal,
        );

      if (req.kind === 'catchup') {
        const minutes = req.minutes ?? 5;
        const now = segments.length ? segments[segments.length - 1].t1 : 0;
        const recent = segments.filter((s) => s.t1 >= now - minutes * 60_000);
        if (!recent.length) throw new Error(t('Rien n’a encore été dit sur cette période.'));
        const text = await call(
          context(meta),
          `${header(meta)}\n\nVoici les ${minutes} dernières minutes :\n${transcriptForAi(meta, recent)}\n\nL’utilisateur a décroché un instant. Fais-lui un rattrapage express en 3 à 5 puces très courtes. Si on lui a posé une question, si on attend quelque chose de lui ou si une décision vient d’être prise, commence par cette ligne en **gras** avec ⚠️.`,
          { quick: true, maxTokens: 900, onText: (t) => send(t) },
        );
        send(text, true);
        return;
      }

      const full = transcriptForAi(meta, segments);
      const budget = local ? 12_000 : inputBudget(provider, model);
      let material = full;
      let materialLabel = 'Transcription';

      // Question sur une longue réunion : une seule requête avec les passages utiles
      // (et le compte-rendu s'il existe), plutôt que de tout relire par morceaux.
      if (req.kind === 'ask' && estimateTokens(full) > budget) {
        const summary = meta.summary?.markdown ?? '';
        const room = Math.max(1_500, budget - estimateTokens(summary) - 400);
        const found = retrieve(meta, segments, req.question ?? '', Math.floor(room * 3.2));
        if (found || summary) {
          const parts = [
            summary && `Compte-rendu déjà rédigé :\n${summary}`,
            found &&
              `Extraits de la transcription qui concernent la question (horodatés ; « … » sépare des passages éloignés) :\n${found.text}`,
          ].filter(Boolean);
          const text = await call(
            context(meta),
            `${header(meta)}\n\n${parts.join('\n\n')}\n\nQuestion : ${req.question}\n\nRéponds uniquement à partir de ces éléments, en citant les moments utiles sous la forme [mm:ss]. Tu ne vois que des extraits de la réunion : si la réponse n’y figure pas, dis que tu ne la trouves pas dans ces passages, sans affirmer que le sujet n’a pas été abordé.`,
            { quick: true, maxTokens: 1200, onText: (t) => send(t) },
          );
          send(text, true);
          return;
        }
      }

      // Réunion trop longue pour le modèle : notes détaillées par parties, puis synthèse.
      if (req.kind !== 'followup' && estimateTokens(full) > budget) {
        const chunks = chunkTranscript(full, Math.floor(budget * 0.85));
        const notes: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          send('', false, { progress: t('Lecture de la réunion… partie {i}/{n}', { i: i + 1, n: chunks.length }) });
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
        send('', false, { progress: t('Rédaction du compte-rendu…') });
      }

      if (req.kind === 'summary') {
        const ex = extras(meta, segments);
        const text = await call(
          context(meta),
          `${header(meta)}\n\n${ex ? ex + '\n\n' : ''}${materialLabel} :\n${material}\n\n${summaryFormat()}`,
          { maxTokens: 3500, onText: (t) => send(t) },
        );
        const { title, body } = splitTitle(text);
        const patch: Partial<MeetingMeta> = {
          summary: { markdown: body, generatedAt: Date.now(), provider: PROVIDER_LABEL[provider], model },
        };
        // relu maintenant : l'utilisateur a pu renommer la réunion pendant la rédaction
        if (title && store.meta(meta.id)?.titleIsAuto) {
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

      if (req.kind === 'names') {
        const unnamed = Object.values(meta.voices ?? {}).filter((v) => !v.name && !v.owner);
        if (!unnamed.length) throw new Error(t('Toutes les voix ont déjà un nom.'));
        const who = meta.attendees?.length ? `Participants invités : ${meta.attendees.join(', ')}\n\n` : '';
        const text = await call(
          context(meta),
          `${header(meta)}\n${who}Transcription :\n${full.slice(0, Math.floor(budget * 3.2))}\n\nLes voix notées « ${voiceLabels()} » ont été distinguées automatiquement, sans connaître les noms. Pour chacune, donne son prénom UNIQUEMENT si la transcription le montre clairement : on s’adresse à elle par son prénom et c’est elle qui répond, elle se présente, on la remercie nommément… Si ce n’est pas clair, n’invente pas : omets-la.\nRéponds seulement par du JSON, sans texte autour, de la forme {"B": {"name": "<prénom>", "why": "<en une phrase courte, ce qui le montre, avec une citation>"}}.`,
          { quick: true, maxTokens: 700 },
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
      send('', true, { error: aborted ? t('Annulé') : (e as Error).message });
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
