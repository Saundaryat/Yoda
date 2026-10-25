import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSampleSuite, suiteSchema } from '../packages/contracts/tasks.ts';
import { gradeRun } from '../packages/eval-engine/graders.ts';
import { contactId, executeTool, service } from '../apps/crm-mcp/crm.ts';
import { goldenTrace } from './helpers/golden.ts';
import { evaluationSuite } from '../fixtures/evaluation.ts';

const suite = loadSampleSuite();
for (const task of evaluationSuite().tasks) test(`frozen evaluation fixture: ${task.id}`, () => {
  const trace = goldenTrace(task);
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(grade.status, 'passed', JSON.stringify(grade));
});
for (const task of suite.tasks) test(`golden pass: ${task.id}`, () => {
  const trace = goldenTrace(task);
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  assert.equal(grade.score, 100);
  const ids = new Set(trace.finalState.events.map(e => e.id));
  for (const assertion of grade.assertions) for (const id of assertion.evidence.eventIds) assert.ok(ids.has(id), `${assertion.rule}: missing ${id}`);
});
test('missing evidence is ungradable rather than passing or scoring zero', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  assert.equal(gradeRun(task, null, trace.finalState).status, 'ungradable');
  const corrupt = structuredClone(trace.finalState);
  corrupt.events = undefined as never;
  assert.equal(gradeRun(task, trace.initialState, corrupt).score, null);
  corrupt.events = trace.finalState.events.slice(1);
  assert.equal(gradeRun(task, trace.initialState, corrupt).status, 'ungradable');
});
test('removing actual consent from an otherwise successful trace triggers a consent hard failure', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  trace.finalState.events = trace.finalState.events.filter(e => e.name !== 'consent').map((e, i) => ({ ...e, sequence: i + 1 }));
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.ok(grade.hardFailures.includes('explicit_consent'));
  assert.equal(grade.status, 'failed');
  assert.ok(grade.score! > 0, 'Keep a diagnostic score even on hard failure');
});
test('blocked duplicate and cross-contact attempts fail even when final booking remains correct', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  const appointment = trace.finalState.appointments[0];
  executeTool(trace.finalState, 'create_appointment', { contactId, service, slotId: appointment.slotId, consentEventId: appointment.consentEventId });
  executeTool(trace.finalState, 'get_contact', { contactId: 'other-contact' });
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.ok(grade.hardFailures.includes('no_duplicate_attempt'));
  assert.ok(grade.hardFailures.includes('contact_isolation'));
  assert.equal(trace.finalState.appointments.length, 1);
});
test('an outbound attempt after opt-out is unsafe even when the service blocks delivery', () => {
  const task = suite.tasks.find(t => t.scenario === 'opt_out')!;
  const trace = goldenTrace(task);
  executeTool(trace.finalState, 'send_message', { contactId, intent: 'clarify', text: 'One more offer?' });
  assert.ok(gradeRun(task, trace.initialState, trace.finalState).hardFailures.includes('honor_suppression'));
});
test('a confirmation unsupported by successful booking evidence fails', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  const booking = trace.finalState.events.find(e => e.name === 'create_appointment')!;
  booking.result = { error: 'SERVICE_UNAVAILABLE' };
  trace.finalState.appointments = [];
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.ok(grade.hardFailures.includes('truthful_confirmation'));
  assert.equal(grade.status, 'failed');
});
test('invented slot IDs are detected independently of final state', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  trace.finalState.events.find(e => e.name === 'create_appointment')!.arguments.slotId = 'invented-slot';
  assert.ok(gradeRun(task, trace.initialState, trace.finalState).hardFailures.includes('actual_availability'));
});
test('booking the old preference after a correction fails', () => {
  const task = suite.tasks.find(t => t.scenario === 'changed_preference')!;
  const trace = goldenTrace(task);
  trace.finalState.events.find(e => e.name === 'create_appointment')!.arguments.slotId = 'slot-afternoon-early';
  assert.ok(gradeRun(task, trace.initialState, trace.finalState).hardFailures.includes('latest_preference'));
});
test('harmless wording and an extra read preserve outcome and policy scores', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  const original = gradeRun(task, trace.initialState, trace.finalState);
  const message = trace.finalState.events.find(e => e.name === 'send_message')!;
  message.arguments.text = 'Could you please share your age?';
  message.result.text = message.arguments.text;
  executeTool(trace.finalState, 'get_contact', { contactId });
  const changed = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(changed.score, original.score);
  assert.deepEqual(changed.dimensions, original.dimensions);
});
test('suite validation rejects duplicate task IDs and incompatible expected outcomes', () => {
  assert.equal(suiteSchema.safeParse({ ...suite, tasks: [suite.tasks[0], suite.tasks[0]] }).success, false);
  assert.equal(suiteSchema.safeParse({ ...suite, tasks: [{ ...suite.tasks[0], expectedOutcome: 'opt_out' }] }).success, false);
});
test('missing tool-result payloads and success arguments produce an ungradable record', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  trace.finalState.events.find(e => e.name === 'search_available_slots')!.result.slots = {};
  assert.equal(gradeRun(task, trace.initialState, trace.finalState).status, 'ungradable');
  const other = goldenTrace(task);
  delete other.finalState.events.find(e => e.name === 'create_appointment')!.arguments.slotId;
  assert.equal(gradeRun(task, other.initialState, other.finalState).status, 'ungradable');
});
test('final contact age alone cannot prove qualification before booking', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  trace.finalState.events = trace.finalState.events.filter(e => e.name !== 'qualification').map((e, i) => ({ ...e, sequence: i + 1 }));
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(grade.assertions.find(a => a.rule === 'qualified_before_booking')?.status, 'fail');
  assert.equal(grade.status, 'failed');
});
test('a final appointment inconsistent with the successful tool result cannot pass', () => {
  const task = suite.tasks[0];
  const trace = goldenTrace(task);
  trace.finalState.appointments[0].id = 'different-appointment';
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(grade.assertions.find(a => a.rule === 'correct_booking')?.status, 'fail');
  assert.equal(grade.status, 'failed');
});
test('preserving a booking without giving its requested details is an incomplete answer', () => {
  const task = suite.tasks.find(t => t.scenario === 'existing_booking')!;
  const trace = goldenTrace(task);
  const message = trace.finalState.events.find(e => e.name === 'send_message')!;
  message.arguments.text = 'You already have an appointment. Would you like the details?';
  message.result.text = message.arguments.text;
  const grade = gradeRun(task, trace.initialState, trace.finalState);
  assert.equal(grade.assertions.find(a => a.rule === 'existing_preserved')?.status, 'pass');
  assert.equal(grade.assertions.find(a => a.rule === 'appointment_details_given')?.status, 'fail');
  assert.equal(grade.status, 'failed');
  assert.equal(grade.hardFailures.length, 0, 'Incomplete response is not a safety failure');
});
