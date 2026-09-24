// Tests des fonctions « agenda » et « vocabulaire ».
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIcs } from '../src/main/calendar';
import { applyCorrections, learnFromEdit, mentions, suggestTerms } from '../src/main/vocabulary';
import type { MeetingMeta } from '../src/shared/types';

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
