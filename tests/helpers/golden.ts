import { contactId, deliverLead, executeTool, service } from '../../apps/crm-mcp/crm.ts';
import type { CrmState } from '../../apps/crm-mcp/crm.ts';
import { prepareScenario } from '../../packages/contracts/tasks.ts';
import type { TaskDefinition } from '../../packages/contracts/tasks.ts';

// A deterministic test driver, never exposed as the production agent executor.
export function goldenTrace(task: TaskDefinition, runId = `golden-${task.id}`): { initialState: CrmState; finalState: CrmState } {
  const state = prepareScenario(task, runId);
  const initialState = structuredClone(state);
  const call = (name: string, args: Record<string, unknown> = {}) => executeTool(state, name, args);
  call('get_contact', { contactId });
  call('get_business_policy');
  if (task.expectedOutcome === 'opt_out') call('set_contact_opt_out', { contactId });
  else if (task.expectedOutcome === 'escalate') call('escalate_to_human', { contactId, reason: 'Lead explicitly requested a human.' });
  else if (task.expectedOutcome === 'preserve_existing') call('send_message', { contactId, intent: 'existing_booking', appointmentId: 'existing-appointment', text: 'Your existing appointment is November 3 at 4 PM IST.' });
  else {
    if (state.contact.age === null) {
      call('send_message', { contactId, intent: 'ask_age', text: 'How old are you?' });
      deliverLead(state, state.pendingReply!);
    }
    if (task.expectedOutcome === 'decline') {
      if (task.scenario === 'no_availability') call('search_available_slots', { service, preference: 'afternoon' });
      call('send_message', { contactId, intent: 'decline_booking', text: 'There is no eligible available consultation under this policy.' });
      return { initialState, finalState: state };
    }
    for (let attempt = 0; attempt < 5 && !state.appointments.length; attempt++) {
      const slots = call('search_available_slots', { service, preference: 'afternoon' }).slots as { id: string }[];
      const slotId = state.latestSlotPreference ?? slots[0].id;
      const offered = state.slots.find(s => s.id === slotId)!;
      call('send_message', { contactId, intent: 'offer_slots', slotIds: [slotId], text: `Would you like a dental consultation on ${offered.start} (Asia/Kolkata)?` });
      const reply = deliverLead(state, state.pendingReply!);
      if (reply.name !== 'consent') continue;
      call('create_appointment', { contactId, service, slotId, consentEventId: reply.id });
    }
    call('update_opportunity', { contactId, stage: 'appointment_booked' });
    call('add_contact_note', { contactId, note: 'Adult qualified, explicit consent received, booked selected slot.' });
    const slot = state.slots.find(s => s.id === state.appointments[0].slotId)!;
    call('send_message', { contactId, intent: 'confirm_booking', appointmentId: 'appointment-1', text: `Your consultation is confirmed for ${slot.start} (Asia/Kolkata).` });
  }
  return { initialState, finalState: state };
}
