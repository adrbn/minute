// Tests des fonctions « agenda » et « vocabulaire ».
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIcs } from '../src/main/calendar';
import { planMerge, planSplit } from '../src/main/merge';
import { isLocalUrl, participantNotice } from '../src/main/privacy';
import { sanitize } from '../src/main/diag';
import { homedir } from 'node:os';
import { retrieve } from '../src/main/retrieval';
import { Voices, type VoiceStore } from '../src/main/voices';
import { toTurns, voiceLabel } from '../src/shared/transcript';
import { applyCorrections, learnFromEdit, mentions, suggestTerms } from '../src/main/vocabulary';
import { migrateShortcuts } from '../src/main/settings';
import type { MeetingMeta, Segment, Voice } from '../src/shared/types';

const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VTIMEZONE
TZID:Europe/Rome
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly-1@google.com
DTSTART;TZID=Europe/Rome:20260907T100000
DTEND;TZID=Europe/Rome:20260907T110000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Rome:20260921T100000
SUMMARY:Point hebdo marketing
ORGANIZER;CN=Adrien Robino:mailto:adrien@example.org
ATTENDEE;CN=Giulia Rossi;PARTSTAT=ACCEPTED:mailto:giulia@example.org
ATTENDEE;CN=Salle Milano:mailto:c_188@resource.calendar.google.com
DESCRIPTION:Rejoindre : https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:weekly-1@google.com
RECURRENCE-ID;TZID=Europe/Rome:20260928T100000
DTSTART;TZID=Europe/Rome:20260928T143000
DTEND;TZID=Europe/Rome:20260928T153000
SUMMARY:Point hebdo marketing (déplacé)
END:VEVENT
BEGIN:VEVENT
UID:allday@google.com
DTSTART;VALUE=DATE:20260928
DTEND;VALUE=DATE:20260929
SUMMARY:Congés
END:VEVENT
BEGIN:VEVENT
UID:cancel@google.com
DTSTART:20260929T080000Z
DTEND:20260929T090000Z
STATUS:CANCELLED
SUMMARY:Annulé
END:VEVENT
END:VCALENDAR`;

test('agenda : récurrence hebdomadaire, fuseau, exception déplacée, annulation, journée entière', () => {
  const now = Date.UTC(2026, 8, 24, 12, 0); // jeudi 24 septembre 2026
  const evs = parseIcs(ics, 'Google', now);
  const inWindow = evs.filter((e) => e.end > now - 12 * 3600_000);
  // prochaine occurrence : lundi 28/09, déplacée à 14h30 (Rome, UTC+2) = 12h30 UTC
  const moved = inWindow.find((e) => e.title.includes('déplacé'));
  assert.ok(moved, 'occurrence déplacée présente');
  assert.equal(new Date(moved!.start).toISOString(), '2026-09-28T12:30:00.000Z');
  assert.ok(!evs.some((e) => e.title === 'Congés'), 'journée entière ignorée');
  assert.ok(!evs.some((e) => e.title === 'Annulé'), 'annulation ignorée');
  // participants : personnes seulement (pas la salle), organisateur inclus
  const early = parseIcs(ics, 'Google', Date.UTC(2026, 8, 10, 12, 0));
  const weekly = early.find((e) => e.title === 'Point hebdo marketing');
  assert.equal(new Date(weekly!.start).toISOString(), '2026-09-14T08:00:00.000Z', 'lundi 10 h à Rome = 8 h UTC');
  assert.deepEqual(weekly?.attendees.sort(), ['Adrien Robino', 'Giulia Rossi']);
  assert.equal(weekly?.link, 'https://meet.google.com/abc-defg-hij');
  // l'occurrence exclue (21/09) n'apparaît pas
  const around = parseIcs(ics, 'Google', Date.UTC(2026, 8, 18, 12, 0));
  assert.ok(!around.some((e) => new Date(e.start).toISOString().startsWith('2026-09-21')));
});

test('vocabulaire : une correction de nom propre est apprise et réappliquée', () => {
  const learned = learnFromEdit('On a lancé la campagne delphe hier avec campus france.', 'On a lancé la campagne DELF hier avec Campus France.');
  assert.deepEqual(
    learned.map((l) => [l.from, l.to]),
    [
      ['delphe', 'DELF'],
      ['campus france', 'Campus France'],
    ],
  );
  assert.equal(applyCorrections('Les inscriptions au Delphe sont ouvertes.', learned), 'Les inscriptions au DELF sont ouvertes.');
});

test('vocabulaire : une correction de grammaire n’est pas apprise', () => {
  assert.deepEqual(learnFromEdit('Il et parti à midi.', 'Il est parti à midi.'), []);
});

test('vocabulaire : suggestions de noms propres et sigles récurrents', () => {
  const meta = (id: string) => ({ id }) as MeetingMeta;
  const seg = (text: string) => ({ id: 'x', ch: 'them' as const, t0: 0, t1: 1, text });
  const sugg = suggestTerms(
    [
      { meta: meta('a'), segments: [seg('On parle du DALF avec Giulia et du DALF encore.'), seg('Et le DALF.')] },
      { meta: meta('b'), segments: [seg('Le DALF revient, Giulia confirme.')] },
    ],
    'DELF',
    [],
  );
  assert.ok(sugg.some((s) => s.term === 'DALF'));
});

test('alerte prénom : détecte « Adrien » sans tenir compte des accents ni de la casse', () => {
  assert.equal(mentions('adrien, tu peux valider les visuels ?', 'Adrien Robino'), true);
  assert.equal(mentions('On en reparle demain.', 'Adrien'), false);
  assert.equal(mentions('Moi je pense que…', 'Moi'), false);
});

test('raccourcis Mac : les anciens ⌃⌥⌘ par défaut deviennent ⌃⌥, les personnalisés restent', () => {
  const saved = { toggleRecord: 'Control+Alt+Command+R', copy: 'Command+Shift+C', mini: 'Control+Alt+Command+T' };
  const out = migrateShortcuts(saved);
  if (process.platform === 'darwin') {
    assert.deepEqual(out, { toggleRecord: 'Control+Alt+R', copy: 'Command+Shift+C', mini: 'Control+Alt+T' });
  } else {
    assert.deepEqual(out, saved);
  }
  assert.equal(saved.toggleRecord, 'Control+Alt+Command+R'); // l'original n'est pas modifié
});

test('raccourcis Mac : pas de migration si les nouvelles touches sont déjà prises par une autre action', () => {
  const saved = { toggleRecord: 'Control+Alt+Command+R', bookmark: 'Control+Alt+R' }; // ⌃⌥R déjà pris par le signet
  assert.deepEqual(migrateShortcuts(saved), saved);
  // ⌃⌥M est le défaut du signet
  const swapped = { toggleRecord: 'Control+Alt+Command+M' };
  assert.deepEqual(migrateShortcuts(swapped), swapped);
});

test('question sur une longue réunion : retrouve les bons passages, même écrits autrement', () => {
  const meta = { speakers: { me: 'Moi', them: 'Eux' } } as MeetingMeta;
  const filler = 'On fait le point sur le planning de la rentrée et les salles disponibles pour les ateliers.';
  const segments = Array.from({ length: 120 }, (_, i) => ({
    id: `s${i}`,
    ch: (i % 2 ? 'me' : 'them') as 'me' | 'them',
    t0: i * 120_000,
    t1: i * 120_000 + 8_000,
    text: filler,
  }));
  segments[40].text = 'Pour Studio Nova, c’est Camille qui reprend l’activation des comptes.';
  segments[90].text = 'Le budget des inscriptions baisse de 12 % par rapport à l’an dernier.';
  // mot collé dans la question, séparé dans la transcription
  const a = retrieve(meta, segments, 'on parle de studionova ou pas ?', 2_000);
  assert.ok(a && a.text.includes('Studio Nova') && a.text.includes('[1:20:00]'));
  assert.ok(!a.text.includes('Le budget'));
  // flexion : « inscrit » ≈ « inscriptions » ne compte pas, « inscription » oui
  const b = retrieve(meta, segments, 'qu’a-t-on dit sur l’inscription ?', 2_000);
  assert.ok(b && b.text.includes('12 %'));
  // faute de frappe sur un nom propre
  const c = retrieve(meta, segments, 'que fait Camillle ?', 2_000);
  assert.ok(c && c.text.includes('Camille'));
  // rien à voir avec la réunion
  assert.equal(retrieve(meta, segments, 'et la météo à Tokyo ?', 2_000), null);
  // budget respecté
  assert.ok(retrieve(meta, segments, 'planning des salles', 1_000)!.text.length <= 1_000);
});

test('voix : trois intervenants qui alternent sont séparés, nommés et gardés en fin de réunion', () => {
  // empreintes simulées : une direction par personne, plus du bruit (comme d'une phrase à l'autre)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const base = [0, 1, 2].map(() => Array.from({ length: 64 }, rnd));
  const print = (who: number, noise = 0.55) => base[who].map((x) => x + noise * rnd());
  const meta = { id: 'm', speakers: { me: 'Adrien', them: 'Eux' }, voices: {} as Record<string, Voice> } as MeetingMeta;
  const segs: Segment[] = [];
  const io: VoiceStore = {
    dir: () => null,
    meta: () => meta,
    segments: () => segs,
    setVoices: (_id, v) => (meta.voices = v),
    putSegment: (_id, seg) => {
      const i = segs.findIndex((x) => x.id === seg.id);
      if (i >= 0) segs[i] = seg;
    },
  };
  const v = new Voices(io);
  const truth = [0, 1, 0, 2, 1, 1, 0, 2, 2, 0, 1, 2, 0, 1];
  truth.forEach((who, i) => {
    const seg: Segment = { id: `s${i}`, ch: 'them', t0: i * 10_000, t1: i * 10_000 + 4_000, text: `phrase ${i}` };
    seg.spk = v.assign('m', seg, print(who));
    segs.push(seg);
  });
  // même personne ⇔ même intervenant
  for (let i = 0; i < truth.length; i++)
    for (let j = 0; j < truth.length; j++) assert.equal(segs[i].spk === segs[j].spk, truth[i] === truth[j], `${i}/${j}`);
  assert.equal(Object.keys(meta.voices!).length, 3);
  assert.equal(voiceLabel(meta, 'them', segs[0].spk), 'Participant A');
  // un nom donné s'applique à toute la réunion, et les tours changent à chaque changement de voix
  meta.voices![segs[1].spk!].name = 'Camille';
  assert.equal(voiceLabel(meta, 'them', segs[4].spk), 'Camille');
  assert.equal(toTurns(segs).length, 12);
  // extrait trop court pour une empreinte, juste après : même personne qui continue
  const short: Segment = { id: 'x', ch: 'them', t0: 134_500, t1: 135_200, text: 'oui' };
  assert.equal(v.assign('m', short, undefined), segs[13].spk);
  // fin de réunion : rien ne bouge, le nom est conservé
  v.refine('m');
  assert.equal(Object.values(meta.voices!).filter((x) => x.name === 'Camille').length, 1);
  assert.equal(new Set(segs.map((s) => s.spk)).size, 3);
});

test('voix : une même personne découpée en deux groupes est réunie en fin de réunion', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const a = Array.from({ length: 64 }, rnd);
  const meta = { id: 'm', speakers: { me: 'Moi', them: 'Eux' }, voices: {} as Record<string, Voice> } as MeetingMeta;
  const segs: Segment[] = [];
  const v = new Voices({
    dir: () => null,
    meta: () => meta,
    segments: () => segs,
    setVoices: (_id, x) => (meta.voices = x),
    putSegment: (_id, seg) => {
      const i = segs.findIndex((x) => x.id === seg.id);
      if (i >= 0) segs[i] = seg;
    },
  });
  // la voix « dérive » (autre micro, autre pièce) : au début, deux groupes se forment
  for (let i = 0; i < 12; i++) {
    const drift = i < 6 ? 0 : 0.9;
    const e = a.map((x, k) => x + drift * Math.sin(k) + 0.25 * rnd());
    const seg: Segment = { id: `s${i}`, ch: 'them', t0: i * 10_000, t1: i * 10_000 + 5_000, text: 't' };
    seg.spk = v.assign('m', seg, e);
    segs.push(seg);
  }
  v.refine('m');
  assert.equal(new Set(segs.map((s) => s.spk)).size, 1);
  assert.equal(Object.keys(meta.voices!).length, 1);
  assert.equal(voiceLabel(meta, 'them', segs[0].spk), 'Participant A');
});

test('fusion : un enregistrement coupé puis relancé redevient une seule réunion', () => {
  const base = { speakers: { me: 'Moi', them: 'Participants' }, bookmarks: [], notes: '', hasAudio: true } as unknown as MeetingMeta;
  const a = { ...base, id: 'a', title: 'Point DELF', startedAt: 1_000_000, durationMs: 60_000, notes: 'relancer Camille',
    voices: { them1: { n: 1, name: 'Camille' }, me1: { n: 0, owner: true } } } as MeetingMeta;
  const b = { ...base, id: 'b', title: 'Réunion', startedAt: 1_000_000 + 90_000, durationMs: 30_000,
    bookmarks: [{ id: 'x', t: 5_000, label: 'budget' }],
    voices: { them1: { n: 1 }, me1: { n: 0, owner: true } } } as MeetingMeta;
  const seg = (id: string, t0: number, spk?: string): Segment => ({ id, ch: spk?.startsWith('me') ? 'me' : 'them', t0, t1: t0 + 3000, text: id, spk });
  const plan = planMerge(a, [seg('a1', 0, 'them1'), seg('a2', 10_000, 'me1')], b, [seg('b1', 2_000, 'them1'), seg('b2', 8_000, 'me1')]);
  // la suite est placée 90 s plus loin, dans l'ordre
  assert.deepEqual(plan.segments.map((s) => [s.id, s.t0]), [['a1', 0], ['a2', 10_000], ['b1', 92_000], ['b2', 98_000]]);
  // la voix « them1 » de b n'est pas Camille : elle devient une nouvelle lettre ; l'utilisateur reste une seule voix
  assert.equal(plan.segments[2].spk, 'them2');
  assert.equal(plan.segments[3].spk, 'me1');
  assert.equal(plan.patch.voices!.them2.n, 2);
  assert.equal(plan.patch.durationMs, 120_000);
  assert.equal(plan.patch.bookmarks![0].t, 95_000);
  assert.equal(plan.patch.notes, 'relancer Camille');
  assert.ok('summary' in plan.patch && plan.patch.summary === undefined);
});

test('séparation : la phrase choisie ouvre une nouvelle réunion, horodatée depuis zéro', () => {
  const meta = { id: 'm', title: 'Comité', startedAt: 5_000_000, durationMs: 100_000, notes: 'n', hasAudio: true,
    speakers: { me: 'Moi', them: 'Participants' },
    bookmarks: [{ id: 'k1', t: 10_000, label: 'a' }, { id: 'k2', t: 70_000, label: 'b' }],
    voices: { them1: { n: 1, name: 'Camille' }, them2: { n: 2 } } } as unknown as MeetingMeta;
  const segs: Segment[] = [
    { id: 's1', ch: 'them', t0: 0, t1: 4_000, text: 'un', spk: 'them1' },
    { id: 's2', ch: 'them', t0: 50_000, t1: 55_000, text: 'deux', spk: 'them2' },
    { id: 's3', ch: 'them', t0: 60_000, t1: 64_000, text: 'trois', spk: 'them2' },
  ];
  const p = planSplit(meta, segs, 's2', 'new');
  assert.deepEqual(p.keep.map((s) => s.id), ['s1']);
  assert.deepEqual(p.move.map((s) => [s.id, s.t0]), [['s2', 0], ['s3', 10_000]]);
  assert.equal(p.newMeta.startedAt, 5_050_000);
  assert.equal(p.newMeta.title, 'Comité (suite)');
  assert.deepEqual(Object.keys(p.newMeta.voices!), ['them2']);
  assert.deepEqual(p.newMeta.bookmarks.map((b) => b.t), [20_000]);
  assert.equal(p.keepPatch.durationMs, 4_000);
  assert.throws(() => planSplit(meta, segs, 's1', 'x'));
});

test('mode confidentiel : seul l’ordinateur lui-même reste joignable', () => {
  for (const ok of ['http://127.0.0.1:8123/inference', 'http://localhost:11434/v1/models', 'app://minute/index.html', 'minute-audio://m/a.wav', 'blob:app://minute/x', 'data:text/plain,a'])
    assert.equal(isLocalUrl(ok), true, ok);
  for (const ko of ['https://api.groq.com/openai/v1/audio/transcriptions', 'https://www.googleapis.com/calendar/v3', 'http://192.168.1.10:8080/', 'https://127.0.0.1.evil.com/', 'pas une url'])
    assert.equal(isLocalUrl(ko), false, ko);
  // le message aux participants ne promet que ce que l'app garantit
  assert.match(participantNotice(true, 'Camille'), /Camille utilise Minute.*sur son ordinateur.*aucun son ni aucun texte/);
  assert.match(participantNotice(false, 'Moi'), /^Pour information : J’utilise Minute.*service en ligne.*mon ordinateur/);
  assert.doesNotMatch(participantNotice(false, 'Camille'), /audio/);
});

test('rapport de problème : dossiers, clés et e-mails sont masqués', () => {
  const raw = `${homedir()}\Documents\Minute a échoué ; clé gsk_abcdefghijklmnopqrstu1234 ; sk-ant-api03-XYZxyz0123456789abc ; écrire à jean.dupont@exemple.fr ; Bearer abcdefghijklmnopqrs`;
  const out = sanitize(raw);
  assert.ok(out.startsWith('~'));
  assert.doesNotMatch(out, /gsk_|sk-ant|jean\.dupont|abcdefghijklmnopqrs/);
  assert.match(out, /<clé masquée>.*<clé masquée>.*<e-mail>.*Bearer <masqué>/);
});
