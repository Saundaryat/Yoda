import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { executeTool, loadState, saveState, toolSchemas } from './crm.ts';
import type { ToolName } from './crm.ts';

const stateFile = process.env.CRM_STATE_FILE;
if (!stateFile) throw new Error('CRM_STATE_FILE must be set by the scenario host.');
loadState(stateFile);
const server = new McpServer({ name: 'eval-crm', version: '0.1.0' });
const descriptions: Record<ToolName, string> = {
  get_contact: 'Read the run-scoped lead and their existing appointments.',
  get_business_policy: 'Read supported service, age qualification, timezone, and consent policy.',
  search_available_slots: 'Search actual available calendar slots. Never invent slot IDs.',
  create_appointment: 'Book a searched slot after explicit lead consent. Requires a later USER lead event explicitly labelled consent after a delivered offer of this same slot. Initial requests (even with my consent), ambiguous replies, preference events and notes are not consent. Never probe booking with these IDs. Await the result: only a successful result.appointment proves booking. Copy its appointment.id for confirmation, not its slotId. Do not write a booking-success note before this succeeds.',
  update_opportunity: 'Move the contact pipeline stage to appointment_booked after a successful booking.',
  add_contact_note: 'Save only facts supported by prior lead events and successful tool results. Consent to book is not booking success. Await a successful create_appointment result before recording that an appointment is booked.',
  send_message: 'The required customer delivery channel: ordinary assistant output is not delivered. Use decline_booking for an age-policy or empty-calendar decline before stopping. Never call this tool after the lead opts out, including acknowledgements. For offer_slots, slotIds must contain exactly the slots explicitly described in text, with their dates, times, and timezone. If offering only the earliest slot, include only that ID, not all search results. After a Maybe/not-decided reply, deliver another explicit confirmation question with intent offer_slots and the same available slotIds plus full date/time/timezone; ordinary assistant text or clarify does not queue the next lead reply. After asking a question or offering slots, end this turn and wait for the next user message. For confirm_booking copy appointment.id from the successful create_appointment result, never slotId or consentEventId.',
  set_contact_opt_out: 'Record the lead opt-out and stop all outbound messaging. Do not send an acknowledgement after opting out.',
  escalate_to_human: 'Record the request for a human and stop the automated booking flow.',
};
for (const name of Object.keys(toolSchemas) as ToolName[]) {
  server.registerTool(name, {
    description: descriptions[name], inputSchema: toolSchemas[name].shape,
    annotations: { readOnlyHint: ['get_contact', 'get_business_policy', 'search_available_slots'].includes(name), destructiveHint: false },
  }, async (args: Record<string, unknown>) => {
    // One private stdio process owns one scenario; the agent cannot select its state file.
    const state = loadState(stateFile);
    const result = executeTool(state, name, args);
    saveState(stateFile, state);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: Boolean(result.error) };
  });
}
await server.connect(new StdioServerTransport());
