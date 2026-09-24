// Chef d'orchestre d'une réunion : reçoit les extraits audio découpés par le
// moteur, les fait transcrire par Groq (file d'attente persistante, reprise
// hors-ligne, respect des limites), nettoie, dédoublonne, enregistre et diffuse.
import { Notification, systemPreferences } from 'electron';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type {
  CalendarEvent,
  Channel,
  EngineSegment,
  EngineStartOptions,
  Levels,
  LiveEvent,
  LiveState,
  MeetingMeta,
  Segment,
} from '../shared/types';
import { cleanResult, buildPrompt, isEcho, overlapping } from './filters';
import { Budget, SttError, transcribe } from './groq';
import { transcribeLocal } from './localStt';
import { diagLog } from './diag';
import { Voices } from './voices';
import { settings } from './settings';
import { newId, store } from './store';
import { applyCorrections, mentions } from './vocabulary';
import { pcm16ToWav } from './wav';

export interface RecorderHooks {
  live(e: LiveEvent): void;
  state(s: LiveState): void;
  levels(l: Levels): void;
  meetingsChanged(): void;
  toast(text: string, kind?: 'info' | 'success' | 'warn' | 'error'): void;
  engineStart(o: EngineStartOptions): Promise<void>;
  engineSend(channel: string, payload?: unknown): void;
  systemAudio: null | {
    start(onPcm: (pcm: Buffer) => void, onError: (msg: string) => void): Promise<void>;
    stop(): void;
  };
  /** Réunion terminée et entièrement transcrite. */
  finished(meetingId: string): void;
  /** Réunion arrêtée (la transcription peut encore se finaliser). */
  ended(meetingId: string): void;
  /** quelqu'un a prononcé le prénom de l'utilisateur */
  mention(meetingId: string, text: string): void;
  showMain(meetingId?: string): void;
}

interface Job {
  meetingId: string;
  segId: string;
  ch: Channel;
  file: string;
  tries: number;
}

const idleState = (): LiveState => ({
  meetingId: null,
  status: 'idle',
  startedAt: 0,
  pausedMs: 0,
  channels: { me: { enabled: true, ok: true }, them: { enabled: true, ok: true } },
  queue: 0,
});

const voices = new Voices({
  dir: (id) => store.dir(id),
  meta: (id) => store.meta(id),
  segments: (id) => store.segments(id),
  setVoices: (id, v) => void store.update(id, { voices: v }),
  putSegment: (id, seg) => store.putSegment(id, seg),
});

export class Recorder {
  state: LiveState = idleState();
  readonly budget = new Budget();
  private queue: Job[] = [];
  private inflight = 0;
  private busy = new Set<string>();
  private inflightSegs = new Set<string>();
  private wakeTimer: NodeJS.Timeout | null = null;
  private holdUntil = 0;
  private authBlocked = false;
  private failures = 0;
  private recent = new Map<string, Record<Channel, string>>();
  private interimBusy: Record<Channel, boolean> = { me: false, them: false };
  private lastInterim: Record<Channel, { t0: number; text: string } | null> = { me: null, them: null };
  private lastFinalT0: Record<Channel, number> = { me: -1, them: -1 };
  private echoCount = 0;
  private lastSpeechAt = 0;
  private autoStopWarned = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private stoppedResolve: (() => void) | null = null;
  private finishedPending = new Set<string>();

  constructor(private hooks: RecorderHooks) {}

  // ---------------------------------------------------------------- état
  private emitState() {
    this.state = { ...this.state, queue: this.queue.length + this.inflight };
    this.hooks.state(this.state);
  }

  /** Message d'état affiché dans l'app et la Dynamic Island (null : l'effacer). */
  notice(kind: 'info' | 'warn' | 'error', text: string | null) {
    if (text && text !== this.state.notice?.text) diagLog(`état ${kind}`, text);
    this.state = { ...this.state, notice: text ? { kind, text } : undefined };
    this.emitState();
  }

  elapsed(): number {
    const s = this.state;
    if (!s.meetingId) return 0;
    const paused = s.pausedMs + (s.pausedAt ? Date.now() - s.pausedAt : 0);
    return Date.now() - s.startedAt - paused;
  }

  // ---------------------------------------------------------------- cycle de vie
  private startPromise: Promise<{ ok: boolean; error?: string }> | null = null;

  start(opts: { title?: string; event?: CalendarEvent | null } = {}): Promise<{ ok: boolean; error?: string }> {
    if (this.state.status !== 'idle' || this.startPromise) {
      return Promise.resolve({ ok: false, error: 'Un enregistrement est déjà en cours.' });
    }
    this.startPromise = this.doStart(opts).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private systemMode(): EngineStartOptions['systemMode'] {
    if (!settings().get().captureSystem) return 'off';
    return process.platform === 'darwin' ? 'pcm' : 'display';
  }

  private async doStart(opts: { title?: string; event?: CalendarEvent | null }): Promise<{ ok: boolean; error?: string }> {
    const cfg = settings().get();
    if (!settings().secret('groq')) {
      return { ok: false, error: 'Ajoutez votre clé Groq dans les Réglages pour transcrire.' };
    }
    if (process.platform === 'darwin') {
      const st = systemPreferences.getMediaAccessStatus('microphone');
      if (st !== 'granted') {
        const ok = await systemPreferences.askForMediaAccess('microphone');
        if (!ok) return { ok: false, error: 'Minute n’a pas accès au micro (Réglages Système › Confidentialité › Micro).' };
      }
    }
    const now = Date.now();
    const meta: MeetingMeta = {
      id: newId(),
      // titre : celui saisi, sinon celui de l'agenda, sinon provisoire (l'IA en proposera un)
      title: opts.title?.trim() || opts.event?.title || defaultTitle(now),
      titleIsAuto: !opts.title?.trim() && !opts.event,
      attendees: opts.event?.attendees.length ? opts.event.attendees : undefined,
      eventId: opts.event?.id,
      startedAt: now,
      durationMs: 0,
      status: 'recording',
      source: 'minute',
      speakers: { me: cfg.meName || 'Moi', them: cfg.themName || 'Participants' },
      ...(cfg.voices ? { voices: {} } : {}),
      notes: '',
      bookmarks: [],
      wordCount: 0,
      preview: '',
      hasAudio: true,
      language: cfg.language,
    };
    store.create(meta);
    this.recent.set(meta.id, { me: '', them: '' });
    this.echoCount = 0;
    this.autoStopWarned = false;
    this.lastSpeechAt = now;
    this.lastInterim = { me: null, them: null };
    this.lastFinalT0 = { me: -1, them: -1 };
    const systemMode = this.systemMode();
    this.state = {
      ...idleState(),
      meetingId: meta.id,
      status: 'starting',
      startedAt: now,
      channels: { me: { enabled: true, ok: true }, them: { enabled: systemMode !== 'off', ok: true } },
    };
    this.emitState();
    this.hooks.meetingsChanged();
    try {
      await this.captureStart(meta.id);
    } catch (e) {
      this.channelStatus('me', false, (e as Error).message);
    }
    if (this.state.meetingId !== meta.id) return { ok: false, error: 'Enregistrement annulé.' };
    this.state = { ...this.state, status: 'recording' };
    this.emitState();
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.silenceTimer = setInterval(() => this.checkSilence(), 15_000);
    return { ok: true };
  }

  /** (Re)lance la capture audio de la réunion en cours — au démarrage ou après un crash du moteur. */
  private async captureStart(meetingId: string) {
    const cfg = settings().get();
    const s = this.state;
    const systemMode = this.systemMode();
    await this.hooks.engineStart({
      startedAt: s.startedAt,
      pausedMs: s.pausedMs + (s.pausedAt ? Date.now() - s.pausedAt : 0),
      micDeviceId: cfg.micDeviceId,
      captureSystem: systemMode !== 'off',
      systemMode,
      livePreview: cfg.livePreview,
      voices: cfg.voices,
    });
    if (this.state.meetingId !== meetingId) return;
    if (systemMode === 'pcm' && this.hooks.systemAudio) {
      await this.hooks.systemAudio.start(
        (pcm) => this.hooks.engineSend('engine:sys-pcm', pcm),
        (msg) => this.channelStatus('them', false, msg),
      );
    }
  }

  /** Le moteur audio (fenêtre cachée) a planté : on le relance sans perdre la réunion. */
  async onEngineCrash() {
    const id = this.state.meetingId;
    if (!id || this.state.status === 'stopping' || this.state.status === 'idle') return;
    this.hooks.systemAudio?.stop();
    this.channelStatus('me', false, 'Le moteur audio a redémarré…');
    try {
      await this.captureStart(id);
      if (this.state.status === 'paused') this.hooks.engineSend('engine:pause');
      this.notice('warn', 'Le moteur audio a redémarré : quelques secondes ont pu manquer.');
    } catch (e) {
      this.channelStatus('me', false, `Capture interrompue : ${(e as Error).message}`);
    }
  }

  pause() {
    const id = this.state.meetingId;
    if (this.state.status !== 'recording' || !id) return;
    this.hooks.engineSend('engine:pause');
    this.state = { ...this.state, status: 'paused', pausedAt: Date.now() };
    store.update(id, { status: 'paused' });
    this.emitState();
  }

  resume() {
    const id = this.state.meetingId;
    if (this.state.status !== 'paused' || !id) return;
    this.hooks.engineSend('engine:resume');
    const pausedMs = this.state.pausedMs + (this.state.pausedAt ? Date.now() - this.state.pausedAt : 0);
    this.state = { ...this.state, status: 'recording', pausedMs, pausedAt: undefined };
    store.update(id, { status: 'recording' });
    this.lastSpeechAt = Date.now();
    this.emitState();
  }

  async stop() {
    // « Terminer » pendant le démarrage : on laisse le démarrage aboutir, puis on arrête proprement.
    if (this.startPromise) await this.startPromise;
    const id = this.state.meetingId;
    if (!id || this.state.status === 'stopping' || this.state.status === 'idle') return;
    const duration = this.elapsed();
    this.state = { ...this.state, status: 'stopping' };
    this.emitState();
    // le moteur envoie ses derniers extraits puis confirme
    await new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
      this.hooks.engineSend('engine:stop');
      setTimeout(resolve, 3500);
    });
    this.stoppedResolve = null;
    this.hooks.systemAudio?.stop();
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.silenceTimer = null;
    this.clearInterims(id);
    // intervenants : on regroupe au mieux maintenant que toute la réunion est connue
    try {
      for (const seg of voices.refine(id)) this.hooks.live({ type: 'segment', meetingId: id, segment: seg });
    } catch (e) {
      console.error('voix', e);
    }
    store.update(id, { status: 'done', endedAt: Date.now(), durationMs: duration });
    store.refreshStats(id);
    this.state = idleState();
    this.emitState();
    this.hooks.meetingsChanged();
    this.hooks.ended(id);
    this.finishedPending.add(id);
    this.maybeFinished(id);
  }

  engineStopped() {
    this.stoppedResolve?.();
  }

  bookmark(label?: string) {
    const id = this.state.meetingId;
    if (!id) return;
    const meta = store.meta(id);
    if (!meta) return;
    const bm = { id: newId(), t: Math.max(0, this.elapsed() - 4000), label: label?.trim() || 'Moment important' };
    store.update(id, { bookmarks: [...meta.bookmarks, bm] });
    this.hooks.live({ type: 'bookmark', meetingId: id, bookmark: bm });
    this.hooks.toast('★ Moment marqué', 'success');
  }

  channelStatus(ch: Channel, ok: boolean, error?: string) {
    this.state = {
      ...this.state,
      channels: { ...this.state.channels, [ch]: { ...this.state.channels[ch], ok, error } },
    };
    this.emitState();
  }

  levels(l: Levels) {
    if (l.meSpeaking || l.themSpeaking) {
      this.lastSpeechAt = Date.now();
      if (this.autoStopWarned) {
        this.autoStopWarned = false;
        if (this.state.notice?.text.startsWith('Plus personne')) this.notice('info', null);
      }
    }
    this.hooks.levels(l);
  }

  private checkSilence() {
    const mins = settings().get().autoStopMinutes;
    if (!mins || this.state.status !== 'recording' || this.autoStopWarned) return;
    if (Date.now() - this.lastSpeechAt < mins * 60_000) return;
    this.autoStopWarned = true;
    this.notice('info', `Plus personne ne parle depuis ${mins} min — la réunion est peut-être terminée.`);
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'La réunion semble terminée',
        body: `Aucune parole depuis ${mins} minutes. Cliquez pour arrêter ou continuer.`,
        silent: true,
      });
      n.on('click', () => this.hooks.showMain(this.state.meetingId ?? undefined));
      n.show();
    }
  }

  // ---------------------------------------------------------------- extraits audio
  onEngineSegment(s: EngineSegment) {
    const id = this.state.meetingId;
    if (!id) return;
    if (s.interim) {
      void this.onInterim(id, s);
      return;
    }
    const segId = newId();
    const file = `${segId}.wav`;
    const path = store.audioFile(id, file);
    if (!path) return;
    writeFileSync(path, pcm16ToWav(Buffer.from(s.pcm)));
    const draft = this.lastInterim[s.ch]?.t0 === s.t0 ? this.lastInterim[s.ch]!.text : '';
    this.lastInterim[s.ch] = null;
    this.lastFinalT0[s.ch] = s.t0;
    this.hooks.live({ type: 'interim', meetingId: id, ch: s.ch, t0: s.t0, text: '' });
    const seg: Segment = { id: segId, ch: s.ch, t0: Math.round(s.t0), t1: Math.round(s.t1), text: draft, audio: file, pending: true };
    if (settings().get().voices) {
      const known = Object.keys(store.meta(id)?.voices ?? {}).length;
      const spk = voices.assign(id, seg, s.voice);
      if (spk) seg.spk = spk;
      // nouvelle voix : les fenêtres doivent connaître son nom (« Participant C »)
      if (Object.keys(store.meta(id)?.voices ?? {}).length !== known) this.hooks.meetingsChanged();
    }
    store.putSegment(id, seg);
    this.hooks.live({ type: 'segment', meetingId: id, segment: seg });
    this.queue.push({ meetingId: id, segId, ch: s.ch, file: path, tries: 0 });
    this.pump();
  }

  private async onInterim(meetingId: string, s: EngineSegment) {
    const key = settings().secret('groq');
    if (settings().get().privacyMode || !key || this.interimBusy[s.ch] || this.authBlocked) return;
    const dur = s.pcm.byteLength / 32000;
    // les aperçus passent après les vraies transcriptions et ne s'accumulent jamais
    if (this.queue.length > 1 || this.budget.delayFor(dur, 'interim') > 0) return;
    this.interimBusy[s.ch] = true;
    this.budget.record(dur);
    const cfg = settings().get();
    try {
      const r = await transcribe(
        key,
        pcm16ToWav(Buffer.from(s.pcm)),
        { model: cfg.sttModel, language: cfg.language, prompt: buildPrompt(this.vocabFor(meetingId), this.recent.get(meetingId)?.[s.ch] ?? ''), timeoutMs: 15_000 },
        this.budget,
      );
      const expected = cfg.languages?.length ? cfg.languages : ['fr', 'en', 'it'];
      if (cfg.language === 'auto' && r.language && !expected.includes(r.language)) return; // aperçu douteux : on attend la version définitive
      const text = applyCorrections(cleanResult(r), cfg.learned);
      if (this.state.meetingId !== meetingId || this.lastFinalT0[s.ch] >= s.t0 || !text) return;
      this.lastInterim[s.ch] = { t0: s.t0, text };
      this.hooks.live({ type: 'interim', meetingId, ch: s.ch, t0: s.t0, text });
    } catch (e) {
      if (e instanceof SttError && e.kind === 'rate') this.budget.block(e.retryAfterMs);
    } finally {
      this.interimBusy[s.ch] = false;
    }
  }

  private clearInterims(meetingId: string) {
    for (const ch of ['me', 'them'] as Channel[]) {
      this.lastInterim[ch] = null;
      this.hooks.live({ type: 'interim', meetingId, ch, t0: 0, text: '' });
    }
  }

  // ---------------------------------------------------------------- file de transcription
  /** Au démarrage : reprend les extraits jamais transcrits (crash, hors-ligne…). */
  recover() {
    for (const meta of store.list()) {
      if (meta.status === 'recording' || meta.status === 'paused') {
        const segs = store.segments(meta.id);
        const last = segs[segs.length - 1];
        store.update(meta.id, {
          status: 'interrupted',
          endedAt: meta.startedAt + (last?.t1 ?? 0),
          durationMs: last?.t1 ?? 0,
        });
        store.refreshStats(meta.id);
        this.finishedPending.add(meta.id);
      }
      for (const s of store.segments(meta.id)) {
        if (!s.pending || !s.audio) continue;
        const file = store.audioFile(meta.id, s.audio);
        if (file && existsSync(file)) {
          this.queue.push({ meetingId: meta.id, segId: s.id, ch: s.ch, file, tries: 0 });
          this.finishedPending.add(meta.id);
        } else {
          store.removeSegment(meta.id, s.id);
        }
      }
    }
    if (this.queue.length) this.pump();
    // réunions interrompues déjà complètes : compactage + compte-rendu automatique
    for (const id of [...this.finishedPending]) this.maybeFinished(id);
  }

  get busyTranscribing(): boolean {
    return this.queue.length + this.inflight > 0;
  }

  retryMeeting(meetingId: string): number {
    this.authBlocked = false;
    this.holdUntil = 0;
    let n = 0;
    for (const s of store.segments(meetingId)) {
      if (!s.pending || !s.audio) continue;
      if (this.queue.some((j) => j.segId === s.id) || this.inflightSegs.has(s.id)) continue;
      const file = store.audioFile(meetingId, s.audio);
      if (file && existsSync(file)) {
        this.queue.push({ meetingId, segId: s.id, ch: s.ch, file, tries: 0 });
        n++;
      }
    }
    this.pump();
    return n;
  }

  /** À appeler quand la clé Groq change. */
  unblock() {
    this.authBlocked = false;
    this.holdUntil = 0;
    if (this.state.notice?.kind === 'error') this.notice('info', null);
    this.pump();
  }

  private schedule(ms: number) {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.pump();
    }, Math.max(50, Math.min(ms, 120_000)));
  }

  private pump() {
    if (this.authBlocked) return this.emitState();
    const now = Date.now();
    if (now < this.holdUntil) {
      this.schedule(this.holdUntil - now);
      return this.emitState();
    }
    // en local, une phrase à la fois : le processeur n'en traite pas deux plus vite
    const parallel = settings().get().privacyMode ? 1 : 2;
    // mode confidentiel : sur un processeur modeste, le moteur local peut prendre du retard sur la parole
    if (settings().get().privacyMode && this.state.meetingId) {
      const n = this.queue.length + this.inflight;
      if (n >= 4) this.notice('warn', `Transcription locale plus lente que la parole sur cet ordinateur : ${n} phrases en attente — rien n’est perdu.`);
      else if (n === 0 && this.state.notice?.text.startsWith('Transcription locale')) this.notice('info', null);
    }
    while (this.inflight < parallel && this.queue.length) {
      const idx = this.queue.findIndex((j) => !this.busy.has(j.meetingId + j.ch));
      if (idx < 0) break;
      const job = this.queue[idx];
      const dur = fileDuration(job.file);
      const wait = settings().get().privacyMode ? 0 : this.budget.delayFor(dur, 'final');
      if (wait > 0) {
        if (wait > 6000) this.notice('warn', 'Limite gratuite Groq atteinte : les phrases arrivent avec un peu de retard, rien n’est perdu.');
        this.schedule(wait);
        break;
      }
      this.queue.splice(idx, 1);
      void this.run(job, dur);
    }
    this.emitState();
  }

  /** La réunion a encore de l'audio en attente ou en cours de transcription. */
  busyWith(meetingId: string): boolean {
    return (
      this.state.meetingId === meetingId ||
      this.queue.some((j) => j.meetingId === meetingId) ||
      [...this.busy].some((k) => k.startsWith(meetingId))
    );
  }

  /** Abandonne ce qui reste à transcrire pour une réunion supprimée. */
  forget(meetingId: string) {
    this.queue = this.queue.filter((j) => j.meetingId !== meetingId);
  }

  private async run(job: Job, dur: number) {
    const key = settings().secret('groq');
    const busyKey = job.meetingId + job.ch;
    this.inflight++;
    this.busy.add(busyKey);
    this.inflightSegs.add(job.segId);
    try {
      const cfg = settings().get();
      if (!key && !cfg.privacyMode) throw new SttError('Clé Groq manquante', 'auth');
      if (!existsSync(job.file)) {
        this.finalize(job, '');
        return;
      }
      const prompt = buildPrompt(this.vocabFor(job.meetingId), this.recentText(job.meetingId, job.ch));
      const wav = readFileSync(job.file);
      let r;
      if (cfg.privacyMode) {
        // mode confidentiel : l'audio ne quitte pas l'ordinateur
        r = await transcribeLocal(wav, { model: cfg.localModel, language: cfg.language, prompt });
      } else {
        this.budget.record(dur);
        r = await transcribe(key!, wav, { model: cfg.sttModel, language: cfg.language, prompt }, this.budget);
        // détection libre : une langue que personne ne parle (coréen sur un bruit de fond…) est une
        // hallucination de Whisper ; on retranscrit dans la langue principale, le filtre fait le reste
        const expected = cfg.languages?.length ? cfg.languages : ['fr', 'en', 'it'];
        if (cfg.language === 'auto' && r.language && !expected.includes(r.language)) {
          diagLog('langue', `« ${r.language} » inattendue : nouvelle transcription en « ${expected[0]} »`);
          this.budget.record(dur);
          r = await transcribe(key!, wav, { model: cfg.sttModel, language: expected[0], prompt }, this.budget);
        }
      }
      this.failures = 0;
      if (this.state.notice && this.state.notice.kind !== 'error' && !this.state.notice.text.startsWith('Plus personne')) {
        this.notice('info', null);
      }
      this.finalize(job, applyCorrections(cleanResult(r), cfg.learned));
    } catch (e) {
      const err = e instanceof SttError ? e : new SttError((e as Error).message, 'network');
      this.queue.unshift(job);
      if (err.kind === 'auth') {
        this.authBlocked = true;
        this.notice('error', 'Clé Groq manquante ou refusée — ouvrez les Réglages. Vos phrases sont gardées en attente.');
      } else if (err.kind === 'rate') {
        this.budget.block(err.retryAfterMs);
      } else if (err.kind === 'bad') {
        job.tries++;
        if (job.tries >= 3) {
          this.queue.shift();
          this.finalize(job, '');
        }
      } else {
        job.tries++;
        this.failures++;
        this.holdUntil = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(job.tries, 6));
        if (this.failures >= 2) {
          this.notice('warn', 'Connexion perdue : l’audio est gardé et sera transcrit dès le retour du réseau.');
        }
      }
    } finally {
      this.inflight--;
      this.busy.delete(busyKey);
      this.inflightSegs.delete(job.segId);
      this.pump();
    }
  }

  /** Vocabulaire personnel + participants de l'agenda pour cette réunion. */
  private vocabFor(meetingId: string): string {
    const attendees = store.meta(meetingId)?.attendees ?? [];
    return [settings().get().vocabulary, ...attendees].filter(Boolean).join(', ');
  }

  private recentText(meetingId: string, ch: Channel): string {
    let r = this.recent.get(meetingId);
    if (!r) {
      const segs = store.segments(meetingId).filter((s) => !s.pending && s.text);
      r = {
        me: segs.filter((s) => s.ch === 'me').slice(-4).map((s) => s.text).join(' '),
        them: segs.filter((s) => s.ch === 'them').slice(-4).map((s) => s.text).join(' '),
      };
      this.recent.set(meetingId, r);
    }
    return r[ch];
  }

  private finalize(job: Job, text: string) {
    const { meetingId } = job;
    // réunion introuvable (dossier changé, supprimée) : on ne touche à rien sur le disque
    if (!store.has(meetingId)) return;
    const segs = store.segments(meetingId);
    const seg = segs.find((s) => s.id === job.segId);
    // mode confidentiel : l'audio n'est jamais conservé une fois transcrit
    const keepAudio = settings().get().keepAudioDays !== 0 && !settings().get().privacyMode;
    if (seg && !seg.pending) return this.maybeFinished(meetingId); // déjà transcrit (doublon)
    if (!seg) {
      rmSync(job.file, { force: true });
      return this.maybeFinished(meetingId);
    }
    if (!text) {
      store.removeSegment(meetingId, seg.id);
      rmSync(job.file, { force: true });
      this.hooks.live({ type: 'remove', meetingId, id: seg.id });
      return this.maybeFinished(meetingId);
    }
    const done: Segment = { ...seg, text, pending: undefined };
    if (!keepAudio) {
      rmSync(job.file, { force: true });
      done.audio = undefined;
    }
    const settled = segs.filter((s) => !s.pending && s.text);
    // Écho : la même phrase captée par le micro ET par le son de l'ordinateur.
    if (done.ch === 'me' && isEcho(done, overlapping(settled.filter((s) => s.ch === 'them'), done))) {
      store.removeSegment(meetingId, done.id);
      this.hooks.live({ type: 'remove', meetingId, id: done.id });
      this.onEcho();
      return this.maybeFinished(meetingId);
    }
    if (done.ch === 'them') {
      for (const mine of overlapping(settled.filter((s) => s.ch === 'me'), done)) {
        if (isEcho(mine, [done])) {
          store.removeSegment(meetingId, mine.id);
          this.hooks.live({ type: 'remove', meetingId, id: mine.id });
          this.onEcho();
        }
      }
    }
    store.putSegment(meetingId, done);
    this.hooks.live({ type: 'segment', meetingId, segment: done });
    if (done.ch === 'them' && this.state.meetingId === meetingId && settings().get().nameAlerts && mentions(text, settings().get().meName)) {
      this.hooks.mention(meetingId, text);
    }
    const r = this.recent.get(meetingId);
    if (r) r[done.ch] = (r[done.ch] + ' ' + text).slice(-600);
    this.maybeFinished(meetingId);
  }

  private onEcho() {
    this.echoCount++;
    if (this.echoCount === 3) {
      this.hooks.toast('Écho détecté : sans casque, votre micro réentend les autres. Minute retire les doublons automatiquement.', 'info');
    }
  }

  private maybeFinished(meetingId: string) {
    if (!this.finishedPending.has(meetingId)) return;
    if (this.state.meetingId === meetingId) return;
    const stillQueued = this.queue.some((j) => j.meetingId === meetingId);
    const stillPending = store.segments(meetingId).some((s) => s.pending);
    if (stillQueued || stillPending) return;
    this.finishedPending.delete(meetingId);
    store.compact(meetingId);
    this.hooks.meetingsChanged();
    this.hooks.finished(meetingId);
  }
}

function fileDuration(file: string): number {
  try {
    return Math.max(0, statSync(file).size - 44) / 32000;
  } catch {
    return 10;
  }
}

function defaultTitle(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const moment = h < 12 ? 'du matin' : h < 18 ? 'de l’après-midi' : 'du soir';
  return `Réunion ${moment} — ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}
