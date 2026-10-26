// Fin de réunion sur un ordinateur lent : le moteur audio analyse le son en retard sur la parole, et ses
// derniers extraits arrivent bien après « Terminer ». Ils doivent être transcrits, et le compte-rendu
// automatique attendre qu'ils soient là (avant : tout ce qui arrivait après 3,5 s était ignoré, la
// transcription s'arrêtait là où le moteur en était, par exemple à 56 min d'une réunion d'1 h 30).
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Recorder, type RecorderHooks } from '../src/main/recorder';
import { settings } from '../src/main/settings';
import { store } from '../src/main/store';
import type { EngineSegment } from '../src/shared/types';

const root = mkdtempSync(join(tmpdir(), 'minute-recorder-'));
process.env.MINUTE_USERDATA = root;

/** Serveur de transcription personnel factice (format OpenAI, verbose_json). */
async function fakeStt(): Promise<{ server: Server; url: string; calls: () => number }> {
  let n = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      n++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          text: `On reprend le point numéro ${n} sur le budget de la rentrée.`,
          language: 'fr',
          segments: [{ start: 0, end: 2, text: 'x', no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1.2 }],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls: () => n };
}

/** 2 s de « parole » (bruit) en PCM 16 bits 16 kHz. */
function speech(): ArrayBuffer {
  const pcm = new Int16Array(32_000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 7) * 8000);
  return pcm.buffer;
}

test('fin de réunion : les extraits que le moteur envoie après « Terminer » sont gardés et transcrits', { timeout: 30_000 }, async (t) => {
  const stt = await fakeStt();
  t.after(() => stt.server.close());
  settings().set({
    sttMode: 'server',
    sttServerUrl: stt.url,
    privacyMode: false,
    voices: false,
    livePreview: false,
    captureSystem: false,
    autoStopMinutes: 0,
    language: 'fr',
    storageDir: join(root, 'reunions'),
  });
  store.load(join(root, 'reunions'));

  const sent: string[] = [];
  let finished: (id: string) => void = () => undefined;
  const done = new Promise<string>((r) => (finished = r));
  const hooks: RecorderHooks = {
    live: () => undefined,
    state: () => undefined,
    levels: () => undefined,
    meetingsChanged: () => undefined,
    toast: () => undefined,
    engineStart: async () => undefined,
    // moteur en retard : il ne confirme pas son arrêt dans les 3,5 s
    engineSend: (channel) => void sent.push(channel),
    systemAudio: null,
    finished: (id) => finished(id),
    ended: () => undefined,
    mention: () => undefined,
    showMain: () => undefined,
  };
  const rec = new Recorder(hooks);
  const started = await rec.start({ title: 'Réunion longue' });
  assert.equal(started.ok, true, started.error);
  const id = rec.state.meetingId!;
  const seg = (t0: number, session: string | undefined = id): EngineSegment => ({
    ch: 'me',
    t0,
    t1: t0 + 2000,
    pcm: speech(),
    interim: false,
    session,
  });

  rec.onEngineSegment(seg(60_000));
  await rec.stop();
  assert.ok(sent.includes('engine:stop'));
  assert.equal(rec.state.meetingId, null);

  // la fin de la réunion arrive après « Terminer »
  rec.onEngineSegment(seg(56 * 60_000));
  rec.onEngineSegment(seg(88 * 60_000));
  let engineDone = false;
  let early = false;
  void done.then(() => (early = !engineDone));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(early, false, 'réunion déclarée terminée (compte-rendu) avant la fin de l’analyse du son');

  engineDone = true;
  rec.engineStopped(id);
  assert.equal(await done, id);
  const segs = store.segments(id);
  assert.deepEqual(
    segs.map((s) => s.t0),
    [60_000, 56 * 60_000, 88 * 60_000],
  );
  assert.ok(segs.every((s) => !s.pending && s.text.includes('budget')));
  assert.equal(stt.calls(), 3);

  // un extrait d'une réunion déjà close ne s'égare pas dans une autre
  rec.onEngineSegment(seg(90 * 60_000));
  assert.equal(store.segments(id).length, 3);
});
