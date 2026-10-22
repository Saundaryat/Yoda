// Minimal CRM MCP server for the spike. State lives in CRM_STATE_FILE so it survives
// across Hermes processes (one process per lead turn) and can be diffed afterwards.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const stateFile = process.env.CRM_STATE_FILE;
if (!stateFile) throw new Error('CRM_STATE_FILE is required');

const initial = {
  contacts: { c1: { id: 'c1', name: 'Priya Shah', phone: '+15550100', stage: 'new' } },
  slots: [
    { id: 's1', start: '2026-11-03T09:00:00Z', free: true },
    { id: 's2', start: '2026-11-03T14:00:00Z', free: true },
  ],
  appointments: [],
  audit: [],
};

const load = () =>
  existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : structuredClone(initial);
const save = (state) => writeFileSync(stateFile, JSON.stringify(state, null, 2));

function audited(name, handler) {
  return async (args) => {
    const state = load();
    let result;
    try {
      result = handler(state, args);
    } catch (error) {
      result = { error: error.message };
    }
    state.audit.push({ at: new Date().toISOString(), tool: name, args, result });
    save(state);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  };
}

const server = new McpServer({ name: 'crm', version: '0.0.1' });

server.registerTool(
  'get_contact',
  { description: 'Look up a lead by contact id.', inputSchema: { contact_id: z.string() } },
  audited('get_contact', (state, { contact_id }) => {
    const contact = state.contacts[contact_id];
    if (!contact) throw new Error(`No contact ${contact_id}`);
    return contact;
  }),
);

server.registerTool(
  'search_slots',
  { description: 'List free appointment slots.', inputSchema: {} },
  audited('search_slots', (state) => state.slots.filter((slot) => slot.free)),
);

server.registerTool(
  'book_appointment',
  {
    description:
      'Book a free slot for a contact. Only call after the lead explicitly agrees to that slot.',
    inputSchema: { contact_id: z.string(), slot_id: z.string() },
  },
  audited('book_appointment', (state, { contact_id, slot_id }) => {
    const slot = state.slots.find((s) => s.id === slot_id);
    if (!slot || !slot.free) throw new Error(`Slot ${slot_id} is not available`);
    if (!state.contacts[contact_id]) throw new Error(`No contact ${contact_id}`);
    slot.free = false;
    const appointment = { id: `a${state.appointments.length + 1}`, contact_id, slot_id };
    state.appointments.push(appointment);
    return appointment;
  }),
);

if (!existsSync(stateFile)) save(load());
await server.connect(new StdioServerTransport());
