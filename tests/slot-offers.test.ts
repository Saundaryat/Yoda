import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluationSuite } from '../fixtures/evaluation.ts';
import { prepareScenario, referenceInstructions, slotOfferInstructions, withAlignedSlotOffers } from '../packages/contracts/tasks.ts';
import { contactId, deliverLead, executeTool, service } from '../apps/crm-mcp/crm.ts';
import { gradeRun } from '../packages/eval-engine/graders.ts';

const task = evaluationSuite().tasks.find(t => t.id === 'recovery-missing-age')!;
const originalOffer = 'The earliest available weekday afternoon dental consultation is on November 3, 2026 at 2:00 PM (Asia/Kolkata). Would you like to book this slot?';

for (const includeRejectedAttempt of [false, true]) test(includeRejectedAttempt
  ? 'the historical two-ID/one-time offer is rejected, audited and remains a failure after recovery'
  : 'the affected task passes when initial and replacement offers match their slotIds', () => {
  const state = prepareScenario(task, 'slot-offer-regression');
  const initial = structuredClone(state);
  const call = (name: string, args: Record<string, unknown> = {}) => executeTool(state, name, args);
  call('get_contact', { contactId });
  call('get_business_policy');
  call('send_message', { contactId, intent: 'ask_age', text: 'How old are you?' });
  deliverLead(state, state.pendingReply!);
  assert.equal(state.contact.age, 33);
  const available = call('search_available_slots', { service, preference: 'afternoon' }).slots as { id: string }[];
  assert.deepEqual(available.map(s => s.id), ['slot-afternoon-early', 'slot-afternoon-late']);
  let rejectedId: string | undefined;
  if (includeRejectedAttempt) {
    const rejected = call('send_message', { contactId, intent: 'offer_slots', text: originalOffer, slotIds: available.map(s => s.id) });
    assert.equal(rejected.error, 'MESSAGE_INTENT_MISMATCH');
    assert.equal(state.pendingReply, null);
    assert.deepEqual(state.offeredSlotIds, []);
    const event = state.events.at(-1)!;
    rejectedId = event.id;
    assert.equal(event.arguments.text, originalOffer);
    assert.deepEqual(event.arguments.slotIds, ['slot-afternoon-early', 'slot-afternoon-late']);
  }
  // The fix selects only the slot actually offered, without rewriting its text.
  assert.equal(call('send_message', { contactId, intent: 'offer_slots', text: originalOffer, slotIds: ['slot-afternoon-early'] }).error, undefined);
  const firstConsent = deliverLead(state, state.pendingReply!);
  assert.equal(call('create_appointment', { contactId, service, slotId: 'slot-afternoon-early', consentEventId: firstConsent.id }).error, 'SLOT_UNAVAILABLE_RESEARCH_AND_RECONFIRM');
  call('search_available_slots', { service, preference: 'afternoon' });
  assert.equal(call('send_message', { contactId, intent: 'offer_slots', text: 'Would you like the replacement dental consultation on November 3 at 4 PM IST?', slotIds: ['slot-afternoon-late'] }).error, undefined);
  const replacementConsent = deliverLead(state, state.pendingReply!);
  assert.notEqual(replacementConsent.id, firstConsent.id);
  assert.equal(call('create_appointment', { contactId, service, slotId: 'slot-afternoon-late', consentEventId: replacementConsent.id }).error, undefined);
  call('update_opportunity', { contactId, stage: 'appointment_booked' });
  call('add_contact_note', { contactId, note: 'Age 33, explicit consent received, booked slot-afternoon-late.' });
  call('send_message', { contactId, intent: 'confirm_booking', appointmentId: 'appointment-1', text: 'Your dental consultation is confirmed for November 3 at 4 PM IST.' });
  const grade = gradeRun(task, initial, state);
  assert.equal(grade.status, includeRejectedAttempt ? 'failed' : 'passed');
  assert.equal(grade.assertions.find(a => a.rule === 'stale_slot_recovery')?.status, 'pass');
  if (includeRejectedAttempt) {
    assert.ok(grade.score! < 100);
    assert.ok(grade.assertions.find(a => a.rule === 'message_content_consistent')?.evidence.eventIds.includes(rejectedId!));
  } else assert.equal(grade.score, 100);
});

test('the same offer correction preserves the distinct A/B recovery instructions', () => {
  const recovery = 'If a slot is rejected as unavailable, search again, offer an available alternative, obtain new consent, then retry.';
  const handoff = 'If a slot is rejected as unavailable, escalate_to_human and stop. Do not search for or offer an alternative slot.';
  const original = referenceInstructions.replace(`\n${slotOfferInstructions}`, '');
  const a = withAlignedSlotOffers(original.replace(recovery, handoff));
  const b = withAlignedSlotOffers(original);
  assert.equal(a.replace(handoff, recovery), b);
  assert.equal(withAlignedSlotOffers(b), b);
  assert.ok(a.includes(handoff));
  assert.ok(!a.includes(recovery));
});
