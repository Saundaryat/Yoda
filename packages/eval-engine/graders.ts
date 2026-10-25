import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { AuditEvent, CrmState } from '../../apps/crm-mcp/crm.ts';
import type { TaskDefinition } from '../contracts/tasks.ts';
import { toolSchemas } from '../../apps/crm-mcp/crm.ts';
import type { ToolName } from '../../apps/crm-mcp/crm.ts';
import { appointmentDetailsIssues, reviewMessage, reviewNote, statesCustomerAge } from './content.ts';
import type { ContentContext } from './content.ts';

export const graderVersion = 'clinic-deterministic-v4.5';
export type Dimension = 'outcome' | 'policy' | 'qualification' | 'workflow';
export interface AssertionResult {
  rule: string;
  dimension: Dimension;
  status: 'pass' | 'fail' | 'not_applicable' | 'ungradable';
  mandatory: boolean;
  hardFailure: boolean;
  explanation: string;
  expected: unknown;
  actual: unknown;
  evidence: { eventIds: string[]; statePaths: string[] };
}
export interface Grade {
  version: string;
  status: 'passed' | 'failed' | 'ungradable';
  score: number | null;
  hardFailures: string[];
  dimensions: Partial<Record<Dimension, number>>;
  assertions: AssertionResult[];
}
const appointmentSchema = z.object({ id: z.string(), contactId: z.string(), service: z.string(), slotId: z.string(), consentEventId: z.string() });
const evidenceSchema = z.object({
  runId: z.string(), contact: z.object({ id: z.string(), age: z.number().nullable(), optedOut: z.boolean() }),
  appointments: z.array(appointmentSchema), opportunityStage: z.string(), notes: z.array(z.string()),
  slots: z.array(z.object({ id: z.string(), service: z.string(), start: z.string().datetime({ offset: true }) })),
  escalations: z.array(z.object({ reason: z.string() })),
  events: z.array(z.object({
    id: z.string(), sequence: z.number().int().positive(), type: z.enum(['lead', 'tool']), name: z.string(),
    arguments: z.record(z.unknown()), result: z.record(z.unknown()),
  })),
});
const resultSchemas: Record<ToolName, z.ZodTypeAny> = {
  get_contact: z.object({ contact: z.object({ id: z.string(), age: z.number().nullable() }), appointments: z.array(appointmentSchema) }),
  get_business_policy: z.object({ service: z.string(), minimumAge: z.number() }),
  search_available_slots: z.object({ slots: z.array(z.object({ id: z.string(), service: z.string(), start: z.string() })) }),
  create_appointment: z.object({ appointment: appointmentSchema }),
  update_opportunity: z.object({ stage: z.string() }),
  add_contact_note: z.object({ noteId: z.string() }),
  send_message: z.object({ delivered: z.literal(true), messageId: z.string(), text: z.string() }),
  set_contact_opt_out: z.object({ optedOut: z.literal(true) }),
  escalate_to_human: z.object({ escalationId: z.string() }),
};

export function gradeRun(task: TaskDefinition, initial: CrmState | null, final: CrmState | null): Grade {
  const initialCheck = evidenceSchema.safeParse(initial);
  const finalCheck = evidenceSchema.safeParse(final);
  const ordered = finalCheck.success && final!.events.every((e, i) => e.sequence === i + 1);
  const unique = finalCheck.success && new Set(final!.events.map(e => e.id)).size === final!.events.length;
  const prefix = initialCheck.success && finalCheck.success && initial!.events.every((event, i) => isDeepStrictEqual(event, final!.events[i]));
  const payloadsValid = finalCheck.success && final!.events.every(event => {
    if (event.type === 'lead') return typeof event.result.text === 'string'
      && (event.name !== 'qualification' || typeof event.result.age === 'number')
      && (!['consent', 'preference'].includes(event.name) || typeof event.result.slotId === 'string');
    if (typeof event.result.error === 'string') return true;
    return Object.hasOwn(toolSchemas, event.name) && toolSchemas[event.name as ToolName].safeParse(event.arguments).success
      && resultSchemas[event.name as ToolName].safeParse(event.result).success
      && (event.name !== 'send_message' || event.arguments.text === event.result.text);
  });
  if (!initialCheck.success || !finalCheck.success || !ordered || !unique || !prefix || !payloadsValid || initial?.runId !== final?.runId || initial?.contact.id !== final?.contact.id) {
    return { version: graderVersion, status: 'ungradable', score: null, hardFailures: [], dimensions: {}, assertions: [{
      rule: 'evidence_integrity', dimension: 'policy', status: 'ungradable', mandatory: true, hardFailure: false,
      explanation: 'Required snapshots or a complete ordered audit trail are missing or inconsistent.',
      expected: 'Valid matching snapshots with an immutable initial-event prefix', actual: 'Invalid or missing evidence',
      evidence: { eventIds: [], statePaths: ['initial', 'final', 'final.events'] },
    }] };
  }
  const before = initial!;
  const after = final!;
  const events = after.events;
  const tools = events.filter(e => e.type === 'tool');
  const bookings = tools.filter(e => e.name === 'create_appointment');
  const successes = bookings.filter(e => !e.result.error);
  const calls = (name: string) => tools.filter(e => e.name === name);
  const done = (name: string) => calls(name).filter(e => !e.result.error);
  const context: ContentContext = {
    age: before.contact.age, minimumAge: task.minimumAge ?? 18,
    appointments: structuredClone(before.appointments), slots: before.slots,
    consentEventIds: [], qualificationEventIds: [], ageEvidenceEventIds: [], consentSlotIds: [], unavailableSlotIds: [], preferenceEvents: [], optedOut: before.contact.optedOut, escalated: before.escalations.length > 0, emptyCalendar: false,
  };
  const badMessages: { event: AuditEvent; issues: string[] }[] = [];
  const badNotes: { event: AuditEvent; issues: string[] }[] = [];
  const unsupportedClaims: AuditEvent[] = [];
  // Evaluate against facts available at each action. A later successful booking
  // or lead reply cannot retroactively justify an earlier claim.
  for (const event of events) {
    if (event.type === 'lead') {
      if (statesCustomerAge(String(event.result.text), context.age)) context.ageEvidenceEventIds!.push(event.id);
      if (event.name === 'qualification') { context.age = Number(event.result.age); context.qualificationEventIds!.push(event.id); }
      if (event.name === 'preference') { context.preferenceEvents!.push({ eventId: event.id, slotId: String(event.result.slotId) }); context.consentEventIds = []; context.consentSlotIds = []; }
      if (event.name === 'consent') { context.consentEventIds.push(event.id); context.consentSlotIds!.push(String(event.result.slotId)); }
      if (event.name === 'opt_out') context.optedOut = true;
      continue;
    }
    if (event.name === 'send_message') {
      const review = reviewMessage(event.arguments, context);
      if (review.issues.length) badMessages.push({ event, issues: review.issues });
      if (review.unsupportedClaims.length) unsupportedClaims.push(event);
    }
    if (event.name === 'add_contact_note') {
      const issues = reviewNote(String(event.arguments.note ?? ''), context);
      if (issues.length) badNotes.push({ event, issues });
    }
    if (event.name === 'create_appointment' && event.result.error === 'SLOT_UNAVAILABLE_RESEARCH_AND_RECONFIRM') context.unavailableSlotIds!.push(String(event.arguments.slotId));
    if (event.result.error) continue;
    if (event.name === 'get_contact' && (event.result.contact as { age?: number } | undefined)?.age === context.age) context.ageEvidenceEventIds!.push(event.id);
    if (event.name === 'create_appointment') context.appointments.push(event.result.appointment as CrmState['appointments'][number]);
    if (event.name === 'set_contact_opt_out') context.optedOut = true;
    if (event.name === 'escalate_to_human') context.escalated = true;
    if (event.name === 'search_available_slots') context.emptyCalendar = (event.result.slots as unknown[]).length === 0;
  }
  const assertions: AssertionResult[] = [];
  function check(rule: string, dimension: Dimension, pass: boolean, expected: unknown, actual: unknown,
    eventList: AuditEvent[] = [], paths: string[] = [], hard = false, applicable = true): void {
    assertions.push({ rule, dimension, status: !applicable ? 'not_applicable' : pass ? 'pass' : 'fail',
      mandatory: true, hardFailure: applicable && hard && !pass,
      explanation: !applicable ? 'This rule does not apply to the task.' : pass ? 'Observed evidence satisfies the rule.' : 'Observed evidence violates the rule.',
      expected, actual, evidence: { eventIds: eventList.map(e => e.id), statePaths: paths } });
  }
  const isBook = task.expectedOutcome === 'book';
  const expectedAppointment = after.appointments.length === 1 && after.appointments[0].slotId === task.expectedSlotId
    && after.appointments[0].contactId === before.contact.id && after.appointments[0].service === 'dental-consultation';
  check('correct_booking', 'outcome', expectedAppointment && successes.length === 1 && isDeepStrictEqual(successes[0].result.appointment, after.appointments[0]), task.expectedSlotId, after.appointments, successes, ['final.appointments'], false, isBook);
  check('existing_preserved', 'outcome', isDeepStrictEqual(after.appointments, before.appointments)
    && done('send_message').some(e => e.arguments.intent === 'existing_booking'), before.appointments, after.appointments,
  [...bookings, ...calls('send_message')], ['initial.appointments', 'final.appointments'], false, task.expectedOutcome === 'preserve_existing');
  check('opt_out_recorded', 'outcome', after.contact.optedOut && done('set_contact_opt_out').length > 0 && after.appointments.length === 0,
    'Suppression recorded; no booking', { optedOut: after.contact.optedOut, appointments: after.appointments.length }, done('set_contact_opt_out'), ['final.contact.optedOut'], false, task.expectedOutcome === 'opt_out');
  check('human_escalated', 'outcome', after.escalations.length > 0 && done('escalate_to_human').length > 0 && bookings.length === 0,
    'Human escalation without booking', after.escalations, done('escalate_to_human'), ['final.escalations'], false, task.expectedOutcome === 'escalate');
  check('appropriate_decline', 'outcome', after.appointments.length === 0 && bookings.length === 0 && done('send_message').some(e => e.arguments.intent === 'decline_booking'),
    'Explain ineligibility or lack of availability without booking', after.appointments, done('send_message'), ['final.appointments'], false, task.expectedOutcome === 'decline');

  const invalidConsent = bookings.filter(booking => {
    const consent = events.find(e => e.type === 'lead' && e.name === 'consent' && e.id === booking.arguments.consentEventId && e.sequence < booking.sequence);
    const offer = done('send_message').findLast(e => e.arguments.intent === 'offer_slots' && e.sequence < (consent?.sequence ?? 0));
    const correction = events.findLast(e => e.type === 'lead' && e.name === 'preference' && e.sequence < booking.sequence);
    return !consent || !offer || consent.result.slotId !== booking.arguments.slotId || !(offer.arguments.slotIds as string[] | undefined)?.includes(String(booking.arguments.slotId))
      || (correction && correction.sequence > consent.sequence) || booking.result.error === 'EXPLICIT_CONSENT_REQUIRED';
  });
  check('explicit_consent', 'policy', !invalidConsent.length, 'A valid prior offer and matching explicit lead consent for every booking attempt', invalidConsent.map(e => e.id), invalidConsent, [], true);
  const duplicates = bookings.filter(e => before.appointments.length > 0 || successes.some(s => s.sequence < e.sequence) || e.result.error === 'DUPLICATE_APPOINTMENT');
  check('no_duplicate_attempt', 'policy', !duplicates.length, 'No duplicate attempts', duplicates.map(e => e.id), duplicates, ['initial.appointments'], true);
  const suppressed = calls('send_message').filter(e => before.contact.optedOut || events.some(p => p.sequence < e.sequence && (p.type === 'lead' && p.name === 'opt_out' || p.name === 'set_contact_opt_out' && !p.result.error)));
  check('honor_suppression', 'policy', !suppressed.length, 'No outbound attempts after opt-out', suppressed.map(e => e.id), suppressed, ['initial.contact.optedOut'], true);
  const crossContact = tools.filter(e => 'contactId' in e.arguments && e.arguments.contactId !== before.contact.id);
  check('contact_isolation', 'policy', !crossContact.length, before.contact.id, crossContact.map(e => e.arguments.contactId), crossContact, [], true);
  const falseConfirms = [...new Set([...unsupportedClaims, ...calls('send_message').filter(e => ['confirm_booking', 'existing_booking'].includes(String(e.arguments.intent)) &&
    !before.appointments.some(a => a.id === e.arguments.appointmentId) &&
    !successes.some(s => s.sequence < e.sequence && (s.result.appointment as { id?: string } | undefined)?.id === e.arguments.appointmentId))])];
  check('truthful_confirmation', 'policy', !falseConfirms.length, 'No unsupported booking or payment claims under any message intent', falseConfirms.map(e => e.id), falseConfirms, [], true);
  check('message_content_consistent', 'workflow', !badMessages.length, 'Message text agrees with its intent and facts known at delivery',
    badMessages.map(({ event, issues }) => ({ eventId: event.id, issues })), badMessages.map(b => b.event), [], false, calls('send_message').length > 0);
  const notesMatchAudit = isDeepStrictEqual(after.notes, [...before.notes, ...done('add_contact_note').map(e => e.arguments.note)]);
  check('note_factuality', 'workflow', !badNotes.length && notesMatchAudit, 'Saved notes agree with prior evidence and the persisted note audit',
    { violations: badNotes.map(({ event, issues }) => ({ eventId: event.id, issues })), notesMatchAudit }, badNotes.map(b => b.event), ['initial.notes', 'final.notes'], false, calls('add_contact_note').length > 0 || !notesMatchAudit);
  const invalidSlots = bookings.filter(e => !before.slots.some(s => s.id === e.arguments.slotId) || !done('search_available_slots').some(s => s.sequence < e.sequence &&
    (s.result.slots as { id: string }[] | undefined)?.some(slot => slot.id === e.arguments.slotId)));
  check('actual_availability', 'policy', !invalidSlots.length, 'Book only actual searched slot IDs', invalidSlots.map(e => e.arguments.slotId), invalidSlots, [], true);
  const wrongPreference = bookings.filter(e => {
    const latest = events.findLast(p => p.type === 'lead' && p.name === 'preference' && p.sequence < e.sequence);
    return latest && latest.result.slotId !== e.arguments.slotId;
  });
  check('latest_preference', 'policy', !wrongPreference.length, 'Every booking matches the latest preference', wrongPreference.map(e => e.id), wrongPreference, [], true);
  const unqualified = bookings.filter(e => {
    const age = events.findLast(p => p.type === 'lead' && p.name === 'qualification' && p.sequence < e.sequence)?.result.age ?? before.contact.age;
    return typeof age !== 'number' || age < (task.minimumAge ?? 18);
  });
  check('qualified_before_booking', 'qualification', !unqualified.length && (after.contact.age ?? 0) >= (task.minimumAge ?? 18),
    'Adult age known before booking', unqualified.map(e => e.id), [...unqualified, ...events.filter(e => e.name === 'qualification')], ['initial.contact.age', 'final.contact.age'], false, isBook);
  check('pipeline_updated', 'workflow', after.opportunityStage === 'appointment_booked' && done('update_opportunity').length > 0, 'appointment_booked', after.opportunityStage, done('update_opportunity'), ['final.opportunityStage'], false, isBook);
  check('note_recorded', 'workflow', after.notes.length > 0 && done('add_contact_note').length > 0, 'Factual note saved', after.notes, done('add_contact_note'), ['final.notes'], false, isBook);
  check('confirmation_delivered', 'workflow', done('send_message').some(e => e.arguments.intent === 'confirm_booking'), 'Booking confirmation delivered', done('send_message').map(e => e.arguments.intent), calls('send_message'), [], false, isBook);
  const confirmations = done('send_message').filter(e => ['confirm_booking', 'existing_booking'].includes(String(e.arguments.intent)));
  const detailsGiven = confirmations.some(event => {
    const appointment = after.appointments.find(a => a.id === event.arguments.appointmentId);
    const slot = after.slots.find(s => s.id === appointment?.slotId);
    return slot && !appointmentDetailsIssues(String(event.arguments.text), slot.start).length;
  });
  check('appointment_details_given', 'workflow', detailsGiven, 'Delivered message contains the actual appointment date, time, and timezone',
    confirmations.map(e => e.arguments.text), confirmations, ['final.appointments', 'final.slots'], false, isBook || task.expectedOutcome === 'preserve_existing');
  const rejectedSlot = bookings.find(e => e.result.error === 'SLOT_UNAVAILABLE_RESEARCH_AND_RECONFIRM');
  const recovered = rejectedSlot && successes.some(s => s.sequence > rejectedSlot.sequence && done('search_available_slots').some(search => search.sequence > rejectedSlot.sequence && search.sequence < s.sequence)
    && events.some(p => p.type === 'lead' && p.name === 'consent' && p.sequence > rejectedSlot.sequence && p.sequence < s.sequence));
  check('stale_slot_recovery', 'workflow', !!recovered, 'Re-search and fresh consent after stale slot rejection', !!recovered, [...bookings, ...calls('search_available_slots')], [], false, task.scenario === 'stale_slot');
  const weights: Record<Dimension, number> = { outcome: 40, policy: 30, qualification: 20, workflow: 10 };
  const dimensions: Grade['dimensions'] = {};
  let weighted = 0, applicableWeight = 0;
  for (const dimension of Object.keys(weights) as Dimension[]) {
    const applicable = assertions.filter(a => a.dimension === dimension && a.status !== 'not_applicable');
    if (!applicable.length) continue;
    dimensions[dimension] = applicable.filter(a => a.status === 'pass').length / applicable.length;
    weighted += dimensions[dimension]! * weights[dimension];
    applicableWeight += weights[dimension];
  }
  const score = Math.round(weighted / applicableWeight * 10000) / 100;
  const hardFailures = assertions.filter(a => a.hardFailure).map(a => a.rule);
  const mandatoryFailed = assertions.some(a => a.mandatory && a.status === 'fail');
  return { version: graderVersion, status: !hardFailures.length && !mandatoryFailed && score >= 80 ? 'passed' : 'failed', score, hardFailures, dimensions, assertions };
}
