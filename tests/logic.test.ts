// Tests de la logique pure : node scripts/test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, cleanResult, isEcho, stripHallucinations } from '../src/main/filters';
import { Segmenter, FRAME, FRAME_MS, type SegmentOut } from '../src/renderer/engine/segmenter';
import { toTurns, transcriptToText, normalize } from '../src/shared/transcript';
import type { MeetingMeta, Segment } from '../src/shared/types';

const r = (text: string, noSpeech = 0.02, avgLogprob = -0.2, compression = 1.2) => ({ text, noSpeech, avgLogprob, compression });

test('filtre : hallucinations Whisper classiques supprimées', () => {
  assert.equal(cleanResult(r('Sous-titres réalisés para la communauté d\'Amara.org')), '');
  assert.equal(cleanResult(r('Sous-titrage Société Radio-Canada')), '');
  assert.equal(cleanResult(r('Merci d\'avoir regardé cette vidéo !')), '');
  assert.equal(cleanResult(r('...')), '');
});

test('filtre : un vrai « Merci. » prononcé est conservé, un faux sur silence non', () => {
  assert.equal(cleanResult(r('Merci.')), 'Merci.');
  assert.equal(cleanResult(r('Merci.', 0.6, -0.9)), '');
});

test('filtre : les répétitions en boucle sont réduites', () => {
  const out = cleanResult(r('oui oui oui oui oui oui oui oui', 0.01, -0.2, 3));
  assert.equal(out, 'oui oui oui');
});

test('import : hallucinations collées dans un texte plus long retirées', () => {
  assert.equal(stripHallucinations('Merci. Sous-titrage Société Radio-Canada Merci.'), 'Merci.');
  assert.equal(stripHallucinations('Bonjour à tous. On commence.'), 'Bonjour à tous. On commence.');
});

const seg = (id: string, ch: 'me' | 'them', t0: number, t1: number, text: string): Segment => ({ id, ch, t0, t1, text });

test('écho : la phrase des autres réentendue par le micro est détectée', () => {
  const theirs = [seg('a', 'them', 1000, 6000, 'Il faudrait relancer les partenaires de Milan avant vendredi.')];
  assert.equal(isEcho(seg('b', 'me', 1200, 6100, 'il faudrait relancer les partenaires de Milan avant vendredi'), theirs), true);
  assert.equal(isEcho(seg('c', 'me', 7000, 9000, 'Oui, je m\'en occupe dès demain matin.'), theirs), false);
});

test('prompt Whisper : vocabulaire + contexte, borné', () => {
  const p = buildPrompt('DELF, DALF\nCampus France', 'x'.repeat(2000));
  assert.ok(p.startsWith('DELF, DALF, Campus France. '));
  assert.ok(p.length <= 800);
});

test('transcription : tours de parole regroupés et coupés toutes les ~90 s', () => {
  const segs = [seg('1', 'them', 0, 5000, 'A.'), seg('2', 'them', 6000, 9000, 'B.'), seg('3', 'me', 9500, 12000, 'C.'), seg('4', 'me', 100_000, 104_000, 'D.')];
  const turns = toTurns(segs);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].segments.length, 2);
  const long = Array.from({ length: 30 }, (_, i) => seg(String(i), 'them', i * 5000, i * 5000 + 4500, `P${i}.`));
  assert.ok(toTurns(long).length >= 2);
});

test('copie : texte propre avec en-tête et voix', () => {
  const meta = { title: 'Point DELF', startedAt: Date.UTC(2026, 8, 24, 8, 0), durationMs: 600_000, speakers: { me: 'Adrien', them: 'Eux' } } as MeetingMeta;
  const txt = transcriptToText(meta, [seg('1', 'them', 0, 4000, 'Bonjour.'), seg('2', 'me', 4500, 6000, 'Salut !')], { timestamps: true });
  assert.match(txt, /^Point DELF — /);
  assert.match(txt, /\[00:00\] Eux : Bonjour\./);
  assert.match(txt, /\[00:04\] Adrien : Salut !/);
});

test('recherche : insensible aux accents et à la casse', () => {
  assert.equal(normalize('Réunion ÉTÉ'), 'reunion ete');
});

// ------------------------------------------------------------------ découpage
function run(probs: number[], livePreview = false): SegmentOut[] {
  const out: SegmentOut[] = [];
  const s = new Segmenter((x) => out.push(x), livePreview);
  probs.forEach((p, i) => s.push(new Float32Array(FRAME).fill(p), p, i * FRAME_MS));
  s.flush();
  return out;
}
const frames = (ms: number, p: number) => Array(Math.round(ms / FRAME_MS)).fill(p);

test('découpage : une phrase entourée de silence donne un extrait', () => {
  const out = run([...frames(1000, 0.02), ...frames(3000, 0.9), ...frames(1500, 0.02)]);
  assert.equal(out.length, 1);
  const d = out[0].t1 - out[0].t0;
  assert.ok(d > 3000 && d < 4000, `durée ${d}`);
  assert.ok(out[0].t0 < 1000 && out[0].t0 > 500, 'pré-roulement conservé');
});

test('découpage : un bruit bref (clic) est ignoré', () => {
  assert.equal(run([...frames(500, 0.02), ...frames(96, 0.9), ...frames(1500, 0.02)]).length, 0);
});

test('découpage : un monologue de 40 s est coupé en extraits ≤ 16 s', () => {
  const probs: number[] = [];
  for (let i = 0; i < 40; i++) probs.push(...frames(900, 0.9), ...frames(100, 0.4));
  const out = run(probs);
  assert.ok(out.length >= 3, `${out.length} extraits`);
  for (const o of out) assert.ok(o.t1 - o.t0 <= 16_100, `extrait de ${o.t1 - o.t0} ms`);
});

test('découpage : les aperçus en direct arrivent pendant la parole', () => {
  const out = run([...frames(300, 0.02), ...frames(8000, 0.9), ...frames(1500, 0.02)], true);
  assert.ok(out.filter((o) => o.interim).length >= 1);
  assert.equal(out.filter((o) => !o.interim).length, 1);
});
