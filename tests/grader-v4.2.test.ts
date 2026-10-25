import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gradeRun, graderVersion } from '../packages/eval-engine/graders.ts';
import { evaluationSuite } from '../fixtures/evaluation.ts';
import { prepareScenario } from '../packages/contracts/tasks.ts';
import { contactId, executeTool, service } from '../apps/crm-mcp/crm.ts';
import { goldenTrace } from './helpers/golden.ts';
import type { CrmState } from '../apps/crm-mcp/crm.ts';
import type { TaskDefinition } from '../packages/contracts/tasks.ts';

const corpus: { records: { id: string; task_snapshot: TaskDefinition; initial_state: CrmState; final_state: CrmState; assessment: string }[] } =
  JSON.parse(readFileSync(new URL('../fixtures/regressions/full-suite-v4.1-failures.json', import.meta.url), 'utf8'));

for (const saved of corpus.records) test(`v4.2 replays saved failure ${saved.id}: ${saved.assessment}`, () => {
  const before = JSON.stringify(saved);
  const grade = gradeRun(saved.task_snapshot, saved.initial_state, saved.final_state);
  assert.equal(graderVersion, 'clinic-deterministic-v4.5');
  assert.equal(JSON.stringify(saved), before, 'Regrading must not mutate historical evidence');
  const assertion = (rule: string) => grade.assertions.find(a => a.rule === rule)!;
  if (saved.assessment === 'grader_false_positive') {
    assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
    assert.equal(grade.score, 100);
  } else {
    assert.equal(grade.status, 'failed', 'Genuine errors and baseline outcome failures must remain failed');
    if (saved.assessment === 'confirmed_agent_errors') {
      assert.equal(assertion('note_factuality').status, 'fail');
      assert.deepEqual(assertion('note_factuality').evidence.eventIds, ['event-8']);
      assert.ok(grade.hardFailures.includes('truthful_confirmation'));
      assert.ok(assertion('truthful_confirmation').evidence.eventIds.includes('event-16'));
    }
    if (saved.assessment === 'confirmed_agent_policy_error') {
      assert.ok(grade.hardFailures.includes('honor_suppression'));
      assert.deepEqual(assertion('honor_suppression').evidence.eventIds, ['event-3']);
    }
    if (saved.assessment === 'confirmed_agent_workflow_error') assert.equal(assertion('appropriate_decline').status, 'fail');
    if (saved.assessment.includes('additional_grader_false_positives')) {
      assert.equal(assertion('message_content_consistent').status, 'pass');
      assert.equal(assertion('note_factuality').status, 'pass');
      assert.equal(assertion('correct_booking').status, 'fail');
    }
  }
});

const task = evaluationSuite().tasks.find(t => t.id === 'age-boundary-18')!;
for (const request of ['Do you want to confirm this slot?', 'Do you wish to accept this slot?']) test(`new acceptance wording is supported by driver and grader: ${request}`, () => {
  const state = prepareScenario(task, 'new-acceptance-wording');
  const initial = structuredClone(state);
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  assert.equal(executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: `November 3 at 2 PM IST is available. ${request}` }).error, undefined);
  assert.equal(state.pendingReply?.kind, 'consent');
  assert.equal(gradeRun(task, initial, state).assertions.find(a => a.rule === 'message_content_consistent')?.status, 'pass');
});

for (const request of ['Do you not want to confirm this slot?', 'Do you want to not confirm this slot?', 'Do you want to cancel this slot?']) test(`new acceptance wording cannot manufacture consent from negation: ${request}`, () => {
  const state = prepareScenario(task, 'negative-acceptance-wording');
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  assert.equal(executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: `November 3 at 2 PM IST is available. ${request}` }).error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.pendingReply, null);
});

test('new acceptance wording still requires every listed slot to appear accurately', () => {
  const state = prepareScenario(task, 'new-wording-mismatched-offer');
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  assert.equal(executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early', 'slot-afternoon-late'], text: 'November 3 at 2 PM IST is available. Do you want to confirm this slot?' }).error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.pendingReply, null);
});

for (const text of ['You already have a booked appointment.', 'Your existing booking remains in place.']) test(`new affirmation wording remains a false claim before booking: ${text}`, () => {
  const missingAge = evaluationSuite().tasks.find(t => t.initialAge === null && t.expectedOutcome === 'book')!;
  const { initialState, finalState } = goldenTrace(missingAge);
  const event = finalState.events.find(e => e.arguments.intent === 'ask_age')!;
  event.arguments.text = `${text} How old are you?`;
  event.result.text = event.arguments.text;
  const grade = gradeRun(missingAge, initialState, finalState);
  assert.ok(grade.hardFailures.includes('truthful_confirmation'));
});

for (const suffix of ['The customer has cancer.', 'Payment received.', 'Lead consented to book via event-999.']) test(`allowing book and via cannot launder false notes: ${suffix}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  const note = finalState.events.find(e => e.name === 'add_contact_note')!;
  note.arguments.note = `Lead consented to book. ${suffix}`;
  finalState.notes[finalState.notes.length - 1] = String(note.arguments.note);
  const grade = gradeRun(task, initialState, finalState);
  assert.equal(grade.assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});
