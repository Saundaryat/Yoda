import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeRun, graderVersion } from '../packages/eval-engine/graders.ts';
import { evaluationSuite } from '../fixtures/evaluation.ts';
import { loadSampleSuite, prepareScenario } from '../packages/contracts/tasks.ts';
import { contactId, deliverLead, executeTool, service } from '../apps/crm-mcp/crm.ts';
import type { AuditEvent } from '../apps/crm-mcp/crm.ts';
import { goldenTrace } from './helpers/golden.ts';

const task = loadSampleSuite().tasks[0];
const timestamp = '2026-11-03T14:00:00+05:30';
function replaceMessage(event: AuditEvent, text: string) {
  event.arguments.text = text;
  event.result.text = text;
}
function assertCaught(grade: ReturnType<typeof gradeRun>, rule: string, eventId: string) {
  assert.equal(grade.version, 'clinic-deterministic-v4.5');
  assert.equal(grade.status, 'failed');
  assert.ok(grade.score !== null && grade.score < 100);
  const assertion = grade.assertions.find(a => a.rule === rule)!;
  assert.equal(assertion.status, 'fail', JSON.stringify(assertion));
  assert.ok(assertion.evidence.eventIds.includes(eventId), 'Failure must identify the offending event');
}

for (const text of [
  `Your appointment is CANCELLED. Do not attend. The cancelled appointment was ${timestamp}.`,
  `Your appointment is not confirmed. Reference time: ${timestamp}.`,
  `No appointment has been booked. Reference: ${timestamp}.`,
  `Your consultation is confirmed for November 4 at 2 PM IST. Reference: ${timestamp}.`,
  `Your consultation is confirmed for November 3 at 4 PM IST. Reference: ${timestamp}.`,
  `Your consultation is confirmed for November 3 at 2 PM UTC. Reference: ${timestamp}.`,
  `An unrelated promotional message. Reference: ${timestamp}.`,
  `Your consultation is confirmed for ${timestamp}. Appointment ID: appointment-999.`,
]) test(`confirmation text cannot hide behind its intent or a correct timestamp: ${text}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  const event = finalState.events.find(e => e.arguments.intent === 'confirm_booking')!;
  replaceMessage(event, text);
  assertCaught(gradeRun(task, initialState, finalState), 'message_content_consistent', event.id);
});

for (const [intent, text] of [
  ['ask_age', 'Your appointment is already confirmed. How old are you?'],
  ['ask_age', "You're booked. How old are you?"],
  ['offer_slots', 'Your booking is confirmed for November 3 at 2 PM IST. Would you like this slot?'],
  ['offer_slots', 'We have charged your card. Would you like November 3 at 2 PM IST?'],
] as const) test(`unsupported claims under ${intent} remain failures after later booking succeeds`, () => {
  const { initialState, finalState } = goldenTrace(task);
  const event = finalState.events.find(e => e.arguments.intent === intent)!;
  replaceMessage(event, text);
  const grade = gradeRun(task, initialState, finalState);
  assertCaught(grade, 'truthful_confirmation', event.id);
  assert.ok(grade.hardFailures.includes('truthful_confirmation'));
});

for (const text of ['A promotional message.', 'We do not need your age. How old are you?']) test(`age intent requires an actual, consistent age request: ${text}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  const event = finalState.events.find(e => e.arguments.intent === 'ask_age')!;
  replaceMessage(event, text);
  assertCaught(gradeRun(task, initialState, finalState), 'message_content_consistent', event.id);
});

test('every structured offered slot must be described in the message', () => {
  const { initialState, finalState } = goldenTrace(task);
  const event = finalState.events.find(e => e.arguments.intent === 'offer_slots')!;
  event.arguments.slotIds = ['slot-afternoon-early', 'slot-afternoon-late'];
  assertCaught(gradeRun(task, initialState, finalState), 'message_content_consistent', event.id);
});

test('mentioning an offered slot only as unavailable cannot manufacture acceptance', () => {
  const knownAge = { ...task, initialAge: 25 };
  const state = prepareScenario(knownAge, 'unavailable-offer'), initialState = structuredClone(state);
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  const result = executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: 'The November 3 at 2 PM IST slot is no longer available. Would you like that slot?' });
  assert.equal(result.error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.pendingReply, null);
  assertCaught(gradeRun(knownAge, initialState, state), 'message_content_consistent', state.events.at(-1)!.id);
});

test('valid multi-slot offers and recovery descriptions still queue genuine consent', () => {
  for (const [slotIds, text] of [
    [['slot-afternoon-early', 'slot-afternoon-late'], 'Would you like November 3 at 2 PM or 4 PM IST?'],
    [['slot-afternoon-late'], 'The 2 PM slot is no longer available. Would you like November 3 at 4 PM IST?'],
  ] as [string[], string][]) {
    const state = prepareScenario({ ...task, initialAge: 25 }, 'valid-slot-offer');
    executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
    const result = executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds, text });
    assert.equal(result.error, undefined);
    assert.equal(state.pendingReply?.kind, 'consent');
    assert.equal(state.pendingReply?.slotId, slotIds[0]);
  }
});

const replyYesOffers = [
  'The earliest available weekday afternoon dental consultation is:\n- 3 Nov 2026, 2:00 PM Asia/Kolkata\nReply YES to confirm this slot, or let me know if you’d like a different time.',
  'You requested 4:00 PM on November 3. This slot is available:\n- 3 Nov 2026, 4:00 PM Asia/Kolkata\nReply YES to confirm this time, or let me know if you’d like another option.',
];

test('the real Reply YES offers pass grading and the live driver', () => {
  const correctedTask = evaluationSuite().tasks.find(t => t.id === 'correct-time-after-age')!;
  const { initialState, finalState } = goldenTrace(correctedTask);
  const offers = finalState.events.filter(e => e.arguments.intent === 'offer_slots');
  assert.equal(offers.length, 2);
  offers.forEach((event, index) => replaceMessage(event, replyYesOffers[index]));
  const grade = gradeRun(correctedTask, initialState, finalState);
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  assert.equal(grade.score, 100);
  for (const [index, text] of replyYesOffers.entries()) {
    const state = prepareScenario({ ...task, initialAge: 25 }, `reply-yes-${index}`);
    executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
    const slotId = index === 0 ? 'slot-afternoon-early' : 'slot-afternoon-late';
    const result = executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: [slotId], text });
    assert.equal(result.error, undefined);
    assert.equal(state.pendingReply?.kind, 'consent');
    assert.equal(state.pendingReply?.slotId, slotId);
  }
});

for (const request of ['reply yes to confirm', 'Please respond with “YES” to accept', "Reply 'YES' to reserve"]) test(`affirmative reply request is accepted: ${request}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  replaceMessage(finalState.events.find(e => e.arguments.intent === 'offer_slots')!, `November 3 at 2 PM IST is available. ${request} this slot.`);
  assert.equal(gradeRun(task, initialState, finalState).status, 'passed');
});

for (const request of ['Do not reply YES to confirm', "Don't reply YES to confirm", 'Never reply YES to confirm', 'No need to reply YES to confirm', 'Reply NO to confirm']) test(`non-affirmative reply wording cannot manufacture consent: ${request}`, () => {
  const state = prepareScenario({ ...task, initialAge: 25 }, 'non-affirmative-reply');
  const initialState = structuredClone(state);
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  const result = executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: `November 3 at 2 PM IST is available. ${request} this slot.` });
  assert.equal(result.error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.pendingReply, null);
  assertCaught(gradeRun(task, initialState, state), 'message_content_consistent', state.events.at(-1)!.id);
});

test('Reply YES does not hide a mismatched slot payload', () => {
  const { initialState, finalState } = goldenTrace(task);
  const offer = finalState.events.find(e => e.arguments.intent === 'offer_slots')!;
  replaceMessage(offer, replyYesOffers[0]);
  offer.arguments.slotIds = ['slot-afternoon-early', 'slot-afternoon-late'];
  assertCaught(gradeRun(task, initialState, finalState), 'message_content_consistent', offer.id);
});

for (const text of ['Your appointment is confirmed for tomorrow. You are eligible; please attend.', 'Thank you for your interest.']) test(`decline text must actually explain a decline: ${text}`, () => {
  const decline = evaluationSuite().tasks.find(t => t.scenario === 'ineligible')!;
  const { initialState, finalState } = goldenTrace(decline);
  const event = finalState.events.find(e => e.arguments.intent === 'decline_booking')!;
  replaceMessage(event, text);
  assertCaught(gradeRun(decline, initialState, finalState), 'message_content_consistent', event.id);
});

for (const note of [
  'The customer is 8 years old and never consented to a booking.',
  'Lead aged 72 qualified and booked a dental consultation.',
  'The customer is not 25 years old. Appointment booked.',
  'No consent was received. Appointment booked.',
  'Consent was never received. Appointment booked.',
  'The customer is not an adult. Appointment booked.',
  'The appointment is cancelled. Do not attend.',
  'Booked November 4 at 2 PM IST.',
  'Booked November 3 at 4 PM IST.',
  'Booked November 3 at 2 PM UTC.',
  'Booked slot-afternoon-late, appointment-1.',
  'Booked appointment-999 after consent event-999.',
  'Payment received. Appointment booked.',
  'Adult qualified. Paid in full.',
  'Appointment booked. The customer has cancer.',
  'Have a nice day!',
  'Appointment.',
]) test(`false or unsupported saved note fails: ${note}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  const event = finalState.events.find(e => e.name === 'add_contact_note')!;
  event.arguments.note = note;
  finalState.notes[finalState.notes.length - 1] = note;
  assertCaught(gradeRun(task, initialState, finalState), 'note_factuality', event.id);
});

test('later booking cannot justify an earlier factual note', () => {
  const { initialState, finalState } = goldenTrace(task);
  const index = finalState.events.findIndex(e => e.name === 'add_contact_note');
  const [note] = finalState.events.splice(index, 1);
  const bookingIndex = finalState.events.findIndex(e => e.name === 'create_appointment');
  finalState.events.splice(bookingIndex, 0, note);
  finalState.events.forEach((e, i) => { e.sequence = i + 1; });
  assertCaught(gradeRun(task, initialState, finalState), 'note_factuality', note.id);
});

test('changing stored notes without matching the audit cannot pass', () => {
  const { initialState, finalState } = goldenTrace(task);
  finalState.notes[0] = 'An invented customer fact.';
  const grade = gradeRun(task, initialState, finalState);
  assert.equal(grade.status, 'failed');
  assert.equal(grade.assertions.find(a => a.rule === 'note_factuality')?.status, 'fail');
});

test('mismatching delivered text and message arguments is ungradable', () => {
  const { initialState, finalState } = goldenTrace(task);
  finalState.events.find(e => e.arguments.intent === 'confirm_booking')!.result.text = 'Your appointment is cancelled.';
  const grade = gradeRun(task, initialState, finalState);
  assert.equal(grade.status, 'ungradable');
  assert.equal(grade.score, null);
});

for (const [confirmation, note] of [
  ['Your dental consultation is confirmed for November 3 at 2 PM IST.', 'Age 25, consented and booked November 3 at 2 PM IST.'],
  [`Your consultation has been booked for ${timestamp} (Asia/Kolkata).`, 'Adult qualified, explicit consent received, booked selected slot.'],
  ['Your consultation is confirmed for 3 Nov 2026 at 14:00 Asia/Kolkata. If you need to cancel, please contact us.', 'Lead is 25 years old. Appointment booked after consent.'],
]) test(`valid factual paraphrase retains 100: ${confirmation}`, () => {
  const { initialState, finalState } = goldenTrace(task);
  replaceMessage(finalState.events.find(e => e.arguments.intent === 'confirm_booking')!, confirmation);
  finalState.events.find(e => e.name === 'add_contact_note')!.arguments.note = note;
  finalState.notes[finalState.notes.length - 1] = note;
  const grade = gradeRun(task, initialState, finalState);
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  assert.equal(grade.score, 100);
});

test('conditional eligibility and consent requests are not mistaken for asserted customer facts', () => {
  const { initialState, finalState } = goldenTrace(task);
  replaceMessage(finalState.events.find(e => e.arguments.intent === 'ask_age')!, 'May I know your age to check whether you are eligible?');
  replaceMessage(finalState.events.find(e => e.arguments.intent === 'offer_slots')!, 'We need your consent before booking. Would you like November 3 at 2 PM IST?');
  const grade = gradeRun(task, initialState, finalState);
  assert.equal(grade.status, 'passed', JSON.stringify(grade.assertions.filter(a => a.status === 'fail')));
  assert.equal(grade.score, 100);
});

test('a policy age threshold is checked against policy rather than an unknown customer age', () => {
  const policyTask = { ...task, minimumAge: 21 };
  const { initialState, finalState } = goldenTrace(policyTask);
  const event = finalState.events.find(e => e.arguments.intent === 'ask_age')!;
  replaceMessage(event, 'May I know your age? Our clinic accepts bookings for patients aged 21 or older.');
  assert.equal(gradeRun(policyTask, initialState, finalState).status, 'passed');
  replaceMessage(event, 'May I know your age? Our clinic accepts bookings for patients aged 18 or older.');
  assertCaught(gradeRun(policyTask, initialState, finalState), 'message_content_consistent', event.id);
});

test('the live driver does not manufacture qualification from an unrelated message', () => {
  const state = prepareScenario(task, 'bad-age-request');
  const result = executeTool(state, 'send_message', { contactId, intent: 'ask_age', text: 'We do not need your age. Here is an unrelated promotional message.' });
  assert.equal(result.error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.contact.age, null);
  assert.equal(state.pendingReply, null);
  assert.equal(state.scriptStep, 'qualification');
  assert.equal(state.events.at(-1)?.arguments.text, 'We do not need your age. Here is an unrelated promotional message.');
});

test('the live driver does not manufacture consent from a misleading offer and preserves the failed attempt', () => {
  const knownAge = { ...task, initialAge: 25 };
  const state = prepareScenario(knownAge, 'bad-slot-offer'), initialState = structuredClone(state);
  executeTool(state, 'search_available_slots', { service, preference: 'afternoon' });
  const result = executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: 'Your booking is already confirmed. Payment has been taken.' });
  assert.equal(result.error, 'MESSAGE_INTENT_MISMATCH');
  assert.equal(state.pendingReply, null);
  assert.deepEqual(state.offeredSlotIds, []);
  const failedEvent = state.events.at(-1)!;
  // Even after recovery, the unsafe attempted claim must not disappear.
  executeTool(state, 'send_message', { contactId, intent: 'offer_slots', slotIds: ['slot-afternoon-early'], text: 'Would you like November 3 at 2 PM IST?' });
  const consent = deliverLead(state, state.pendingReply!);
  executeTool(state, 'create_appointment', { contactId, service, slotId: 'slot-afternoon-early', consentEventId: consent.id });
  executeTool(state, 'update_opportunity', { contactId, stage: 'appointment_booked' });
  executeTool(state, 'add_contact_note', { contactId, note: 'Adult qualified, explicit consent received, booked selected slot.' });
  executeTool(state, 'send_message', { contactId, intent: 'confirm_booking', appointmentId: 'appointment-1', text: `Your consultation is confirmed for ${timestamp}.` });
  assertCaught(gradeRun(knownAge, initialState, state), 'truthful_confirmation', failedEvent.id);
});

test('v4.2 changes are explicitly versioned rather than silently changing historical grades', () => {
  assert.notEqual(graderVersion, 'clinic-deterministic-v3');
  assert.notEqual(graderVersion, 'clinic-deterministic-v4');
  assert.notEqual(graderVersion, 'clinic-deterministic-v4.1');
});
