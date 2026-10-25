import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gradeRun } from '../packages/eval-engine/graders.ts';
import type { CrmState } from '../apps/crm-mcp/crm.ts';
import type { TaskDefinition } from '../packages/contracts/tasks.ts';

const pilot: { task: TaskDefinition; initialState: CrmState; finalState: CrmState } = JSON.parse(readFileSync(new URL('../fixtures/regressions/anthropic-pilot-v4.2.json', import.meta.url), 'utf8'));
const note = pilot.finalState.events.find(event => event.name === 'add_contact_note')!;
const text = String(note.arguments.note);
function withNote(value: string) {
  const state = structuredClone(pilot.finalState);
  state.events.find(event => event.id === note.id)!.arguments.note = value;
  state.notes[state.notes.length - 1] = value;
  return gradeRun(pilot.task, pilot.initialState, state);
}

test('the real Anthropic pilot note with a qualification reference and accurate weekday passes v4.3', () => {
  const grade = withNote(text);
  assert.equal(grade.version, 'clinic-deterministic-v4.5');
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  assert.equal(grade.score, 100);
});

for (const [reason, value] of [
  ['wrong weekday', text.replace('Tuesday', 'Wednesday')],
  ['consent event used as age evidence', text.replace('age 25 (event-5)', 'age 25 (event-8)')],
  ['qualification event used as consent evidence', text.replace('Consent given via event-8', 'Consent given via event-5')],
  ['invented qualification reference', text.replace('event-5', 'event-999')],
  ['wrong customer age', text.replace('age 25', 'age 8')],
  ['unsupported payment', `${text} Payment received.`],
  ['unsupported diagnosis', `${text} The customer has cancer.`],
] as const) test(`qualification/weekday acceptance cannot launder ${reason}`, () => {
  const grade = withNote(value);
  assert.equal(grade.status, 'failed');
  assert.ok(grade.score! < 100);
  const assertion = grade.assertions.find(a => a.rule === 'note_factuality')!;
  assert.equal(assertion.status, 'fail');
  assert.ok(assertion.evidence.eventIds.includes(note.id));
});

test('an age-only note before booking or consent does not falsely claim booking consent', () => {
  const state = structuredClone(pilot.finalState);
  const [ageNote] = state.events.splice(state.events.findIndex(event => event.id === note.id), 1);
  ageNote.arguments.note = 'Lead confirmed age 25 (event-5).';
  state.notes[state.notes.length - 1] = String(ageNote.arguments.note);
  state.events.splice(state.events.findIndex(event => event.id === 'event-5') + 1, 0, ageNote);
  state.events.forEach((event, index) => event.sequence = index + 1);
  const grade = gradeRun(pilot.task, pilot.initialState, state);
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
});

test('weekday assertions in customer messages are checked against the appointment date too', () => {
  const state = structuredClone(pilot.finalState);
  const confirmation = state.events.find(event => event.arguments.intent === 'confirm_booking')!;
  confirmation.arguments.text = String(confirmation.arguments.text).replace('Tuesday', 'Wednesday');
  confirmation.result.text = confirmation.arguments.text;
  const grade = gradeRun(pilot.task, pilot.initialState, state);
  assert.equal(grade.assertions.find(a => a.rule === 'message_content_consistent')?.status, 'fail');
});
