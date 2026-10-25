import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gradeRun } from '../packages/eval-engine/graders.ts';
const source = JSON.parse(readFileSync(new URL('../fixtures/regressions/anthropic-preference-note-v4.4.json', import.meta.url), 'utf8'));
test('v4.5 accepts a factual note citing the lead preference separately from explicit consent', () => {
  const grade = gradeRun(source.task, source.initial, source.final);
  assert.equal(grade.version, 'clinic-deterministic-v4.5');
  assert.equal(grade.status, 'passed');
  assert.equal(grade.score, 100);
});
for (const mutation of ['wrong preference time', 'invented preference', 'preference as consent', 'preference as age', 'invented diagnosis']) test(`preference notes still reject ${mutation}`, () => {
  const final = structuredClone(source.final);
  const event = final.events.find((e: any) => e.name === 'add_contact_note');
  let note = String(event.arguments.note);
  if (mutation === 'wrong preference time') note = note.replace('Changed preference to 4:00 PM', 'Changed preference to 2:00 PM');
  if (mutation === 'invented preference') note = note.replace('(event-8)', '(event-3)');
  if (mutation === 'preference as consent') note = note.replace('consent (event-10)', 'consent (event-8)');
  if (mutation === 'preference as age') note = note.replace('28 (event-5)', '28 (event-8)');
  if (mutation === 'invented diagnosis') note += ' Patient has gingivitis.';
  event.arguments.note = note; final.notes[final.notes.length - 1] = note;
  assert.equal(gradeRun(source.task, source.initial, final).assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});
