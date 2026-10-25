import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluationSuite } from '../fixtures/evaluation.ts';
import { prepareScenario, referenceInstructions, reliableWorkflowInstructions, consentWorkflowInstructions, withReliableWorkflow } from '../packages/contracts/tasks.ts';
import { contactId, deliverLead, executeTool, service } from '../apps/crm-mcp/crm.ts';
import { gradeRun } from '../packages/eval-engine/graders.ts';

const task = (id: string) => evaluationSuite().tasks.find(t => t.id === id)!;

test('reliable workflow instructions apply equally to A/B and retain their distinct recovery behavior', () => {
  const recover = 'If a slot is rejected as unavailable, search again, offer an available alternative, obtain new consent, then retry.';
  const handoff = 'If a slot is rejected as unavailable, escalate_to_human and stop. Do not search for or offer an alternative slot.';
  const old = referenceInstructions.replace(`\n${reliableWorkflowInstructions}`, '').replace(`\n${consentWorkflowInstructions}`, '');
  const a = withReliableWorkflow(old.replace(recover, handoff));
  const b = withReliableWorkflow(old);
  assert.equal(a.replace(handoff, recover), b);
  assert.equal(`${b}\n${consentWorkflowInstructions}`, referenceInstructions);
  assert.equal(withReliableWorkflow(b), b);
});

for (const prematureNote of [false, true]) test(`stale-slot recovery uses returned appointment ID and writes success only afterward (premature note=${prematureNote})`, () => {
  const definition = task('recovery-age-42');
  const state = prepareScenario(definition, 'reliable-recovery');
  const initial = structuredClone(state);
  executeTool(state, 'get_contact', { contactId });
  executeTool(state, 'get_business_policy', {});
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: 'November 3 at 2 PM IST is available. Do you want to confirm this slot?' });
  const firstConsent = deliverLead(state, state.pendingReply!);
  if (prematureNote) executeTool(state, 'add_contact_note', { contactId, note: 'Appointment booked.' });
  const rejected = executeTool(state, 'create_appointment', { contactId, service, slotId: 'slot-afternoon-early', consentEventId: firstConsent.id });
  assert.equal(rejected.error, 'SLOT_UNAVAILABLE_RESEARCH_AND_RECONFIRM');
  assert.equal(state.appointments.length, 0);
  if (!prematureNote) assert.equal(state.notes.length, 0);
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-late'], text: 'November 3 at 4 PM IST is available. Do you want to confirm this slot?' });
  const consent = deliverLead(state, state.pendingReply!);
  const result = executeTool(state, 'create_appointment', { contactId, service, slotId: 'slot-afternoon-late', consentEventId: consent.id });
  assert.equal(result.error, undefined);
  const appointment = result.appointment as { id: string; slotId: string };
  executeTool(state, 'update_opportunity', { contactId, stage: 'appointment_booked' });
  executeTool(state, 'add_contact_note', { contactId, note: `Booked dental consultation for November 3 at 4 PM IST, ${appointment.slotId}, via lead consent ${consent.id}.` });
  const confirmation = executeTool(state, 'send_message', { contactId, intent: 'confirm_booking', appointmentId: appointment.id, text: 'Your consultation is confirmed for November 3 at 4 PM IST.' });
  assert.equal(confirmation.delivered, true);
  const grade = gradeRun(definition, initial, state);
  assert.equal(grade.status, prematureNote ? 'failed' : 'passed');
  assert.equal(grade.assertions.find(a => a.rule === 'note_factuality')?.status, prematureNote ? 'fail' : 'pass');
  assert.equal(grade.assertions.find(a => a.rule === 'truthful_confirmation')?.status, 'pass');
  if (!prematureNote) assert.equal(grade.score, 100);
});

for (const acknowledge of [false, true]) test(`opt-out must stop without an acknowledgement (acknowledge=${acknowledge})`, () => {
  const definition = task('unsubscribe-polite');
  const state = prepareScenario(definition, 'reliable-optout');
  const initial = structuredClone(state);
  assert.equal(executeTool(state, 'set_contact_opt_out', { contactId }).optedOut, true);
  if (acknowledge) assert.equal(executeTool(state, 'send_message', { contactId, intent: 'decline_booking', text: 'You have been removed from our contact list.' }).error, 'OPTED_OUT');
  assert.equal(state.scriptStep, 'complete');
  const grade = gradeRun(definition, initial, state);
  assert.equal(grade.status, acknowledge ? 'failed' : 'passed');
  assert.equal(grade.hardFailures.includes('honor_suppression'), acknowledge);
  if (!acknowledge) {
    assert.equal(state.events.filter(e => e.name === 'send_message').length, 0);
    assert.equal(grade.score, 100);
  }
});

for (const deliver of [false, true]) test(`policy decline requires CRM delivery rather than assistant-only output (deliver=${deliver})`, () => {
  const definition = task('policy-age-25');
  const state = prepareScenario(definition, 'reliable-decline');
  const initial = structuredClone(state);
  executeTool(state, 'get_contact', { contactId });
  executeTool(state, 'get_business_policy', {});
  // Ordinary assistant prose is intentionally absent from CRM delivery evidence.
  if (deliver) assert.equal(executeTool(state, 'send_message', { contactId, intent: 'decline_booking', text: 'Our minimum age is 25; you are 24, so we cannot book this consultation.' }).delivered, true);
  const grade = gradeRun(definition, initial, state);
  assert.equal(grade.status, deliver ? 'passed' : 'failed');
  assert.equal(grade.assertions.find(a => a.rule === 'appropriate_decline')?.status, deliver ? 'pass' : 'fail');
  if (deliver) {
    assert.equal(state.scriptStep, 'complete');
    assert.equal(grade.score, 100);
  }
});
