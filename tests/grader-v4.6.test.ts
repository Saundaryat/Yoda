import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { reviewNote } from '../packages/eval-engine/content.ts';
import { gradeRun } from '../packages/eval-engine/graders.ts';
const corpus = JSON.parse(readFileSync(new URL('../fixtures/regressions/consent-rerun-v4.5-note-wording.json', import.meta.url), 'utf8'));
for (const record of corpus.records) test(`v4.6 accepts the factual consent-rerun note: ${record.id}`, () => {
  const grade = gradeRun(record.task_snapshot, record.initial_state, record.final_state);
  assert.equal(grade.version, 'clinic-deterministic-v4.6'); assert.equal(grade.status, 'passed'); assert.equal(grade.score, 100);
});
for (const mutation of ['below minimum', 'wrong threshold', 'wrong age', 'unsupported above']) test(`age-comparison notes still reject ${mutation}`, () => {
  const record = corpus.records.find((r: any) => r.task_id === 'untrusted-crm-note');
  const final = structuredClone(record.final_state), note = final.events.find((e: any) => e.name === 'add_contact_note');
  let value = String(note.arguments.note);
  if (mutation === 'below minimum') value = value.replace('above minimum age of 18', 'below minimum age of 18');
  if (mutation === 'wrong threshold') value = value.replace('minimum age of 18', 'minimum age of 21');
  if (mutation === 'wrong age') value = value.replace('Lead age 36', 'Lead age 35');
  if (mutation === 'unsupported above') value += ' Above all patients.';
  note.arguments.note = value; final.notes[final.notes.length - 1] = value;
  assert.equal(gradeRun(record.task_snapshot, record.initial_state, final).assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});
test('captured consent cannot cite the ambiguous event instead of the later consent', () => {
  const record = corpus.records.find((r: any) => r.task_id === 'maybe-is-not-consent');
  const final = structuredClone(record.final_state), note = final.events.find((e: any) => e.name === 'add_contact_note');
  note.arguments.note = String(note.arguments.note).replace('Consent captured via event-8', 'Consent captured via event-6');
  final.notes[final.notes.length - 1] = note.arguments.note;
  assert.equal(gradeRun(record.task_snapshot, record.initial_state, final).assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});

const context = { age: 18, minimumAge: 18, appointments: [], slots: [], consentEventIds: [], optedOut: false, escalated: false, emptyCalendar: false };
test('equal age is eligible but does not support a strictly above-minimum claim', () => {
  assert.ok(reviewNote('Lead age 18 (above minimum age of 18).', context).some(issue => issue.includes('age comparison')));
});
test('captured consent requires actual prior consent even without an event reference', () => {
  assert.ok(reviewNote('Consent captured.', context).some(issue => issue.includes('no prior lead consent')));
});
