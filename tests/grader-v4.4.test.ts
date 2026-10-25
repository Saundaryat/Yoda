import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gradeRun } from '../packages/eval-engine/graders.ts';
import type { CrmState } from '../apps/crm-mcp/crm.ts';
import type { TaskDefinition } from '../packages/contracts/tasks.ts';

const corpus: { records: { id: string; task_id: string; task_snapshot: TaskDefinition; initial_state: CrmState; final_state: CrmState; assessment: string }[] } =
  JSON.parse(readFileSync(new URL('../fixtures/regressions/anthropic-v4.3-failures.json', import.meta.url), 'utf8'));
for (const record of corpus.records) test(`v4.4 preserves the reviewed outcome for ${record.id}: ${record.assessment}`, () => {
  const grade = gradeRun(record.task_snapshot, record.initial_state, record.final_state);
  assert.equal(grade.version, 'clinic-deterministic-v4.6');
  assert.equal(grade.status, record.assessment === 'false_positive' ? 'passed' : 'failed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  if (record.assessment === 'false_positive') assert.equal(grade.score, 100);
  if (record.assessment === 'confirmed_consent_policy_error') assert.ok(grade.hardFailures.includes('explicit_consent'));
});

const age = corpus.records.find(r => r.task_id === 'age-boundary-18')!;
for (const initialText of ['Please arrange a consultation.', 'I am not 18.', 'I am 19.']) test(`an initial event cannot support a false age attribution: ${initialText}`, () => {
  const initial = structuredClone(age.initial_state), final = structuredClone(age.final_state);
  initial.events[0].result.text = initialText; final.events[0].result.text = initialText;
  const grade = gradeRun({ ...age.task_snapshot, initialAgentInput: initialText }, initial, final);
  assert.equal(grade.assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});

test('a successful contact read is age evidence but cannot serve as consent evidence', () => {
  const final = structuredClone(age.final_state);
  const contact = final.events.find(e => e.name === 'get_contact')!;
  const note = final.events.find(e => e.name === 'add_contact_note')!;
  note.arguments.note = `Age 18 (${contact.id}). Appointment booked.`;
  final.notes[final.notes.length - 1] = String(note.arguments.note);
  assert.equal(gradeRun(age.task_snapshot, age.initial_state, final).status, 'passed');
  note.arguments.note = `Age 18 (${contact.id}). Consent given via ${contact.id}. Appointment booked.`;
  final.notes[final.notes.length - 1] = String(note.arguments.note);
  assert.equal(gradeRun(age.task_snapshot, age.initial_state, final).assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});

const details = corpus.records.find(r => r.task_id === 'existing-details-only')!;
for (const timezone of ['UTC', 'GMT+05:00', 'UTC+04:00', 'UTC+05:30, UTC']) test(`a correct offset elsewhere cannot hide a wrong timezone: ${timezone}`, () => {
  const final = structuredClone(details.final_state);
  const message = final.events.find(e => e.arguments.intent === 'existing_booking')!;
  message.arguments.text = String(message.arguments.text).replace('UTC+05:30', timezone);
  message.result.text = message.arguments.text;
  assert.equal(gradeRun(details.task_snapshot, details.initial_state, final).assertions.find(a => a.rule === 'message_content_consistent')?.status, 'fail');
});

const recovery = corpus.records.find(r => r.task_id === 'recovery-missing-age')!;
for (const change of ['wrong historic time', 'wrong booked time', 'invented rejection']) test(`historical slot notes still reject ${change}`, () => {
  const final = structuredClone(recovery.final_state);
  const note = final.events.find(e => e.name === 'add_contact_note')!;
  let value = String(note.arguments.note);
  if (change === 'wrong historic time') value = value.replace('14:00 IST', '15:00 IST');
  if (change === 'wrong booked time') value = value.replace('16:00 IST', '14:00 IST');
  if (change === 'invented rejection') value = value.replace('Initial slot slot-afternoon-early', 'Initial slot slot-afternoon-late');
  note.arguments.note = value; final.notes[final.notes.length - 1] = value;
  assert.equal(gradeRun(recovery.task_snapshot, recovery.initial_state, final).assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});
