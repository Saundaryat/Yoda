import { crmSeedSchema, type CrmState } from '@evals/shared';
import { clinicTime, materialize } from './state.js';
import { callTool } from './tools.js';

// 2026-10-22 23:30 UTC is still Oct 22 in Dallas (CDT, UTC-5).
const NOW = new Date('2026-10-22T23:30:00Z');

function seedState(): CrmState {
  return materialize(
    crmSeedSchema.parse({
      contacts: [{ id: 'c-1', name: 'Priya Shah', phone: '+1 555 0100' }],
      slots: [
        { id: 's-today', day: 0, time: '16:00' },
        { id: 's-tomorrow', day: 1, time: '09:00' },
        { id: 's-later', day: 2, time: '14:30' },
      ],
      takenOnFirstTry: ['s-later'],
    }),
    NOW,
  );
}

describe('clinicTime', () => {
  it('uses the clinic calendar date, not UTC', () => {
    expect(clinicTime(NOW, 1, '09:00')).toEqual({
      iso: '2026-10-23T09:00:00-05:00',
      label: 'Fri, Oct 23, 9:00 AM',
    });
  });

  it('follows daylight saving time', () => {
    // DST ends Nov 1 2026 in the US, so Nov 2 is CST (UTC-6).
    expect(clinicTime(NOW, 11, '10:00').iso).toBe('2026-11-02T10:00:00-06:00');
  });
});

describe('CRM tools', () => {
  it('books a free slot and marks it taken', () => {
    const state = seedState();
    const { ok } = callTool(state, 'book_appointment', {
      contact_id: 'c-1',
      slot_id: 's-tomorrow',
      service_id: 'cleaning',
    });
    expect(ok).toBe(true);
    expect(state.appointments).toHaveLength(1);
    expect(state.slots.find((s) => s.id === 's-tomorrow')?.free).toBe(false);
    expect(callTool(state, 'search_slots', {}).result).toHaveLength(2);
  });

  it('fails the first booking of a "taken" slot, permanently', () => {
    const state = seedState();
    const args = { contact_id: 'c-1', slot_id: 's-later', service_id: 'cleaning' };
    expect(callTool(state, 'book_appointment', args)).toEqual({
      ok: false,
      result: { error: 'Slot s-later was just taken by another patient.' },
    });
    expect(callTool(state, 'book_appointment', args).ok).toBe(false);
    expect(state.appointments).toHaveLength(0);
  });

  it('audits rejected calls, including invalid arguments', () => {
    const state = seedState();
    callTool(state, 'get_contact', { contact_id: 'c-999' });
    callTool(state, 'update_contact', { contact_id: 'c-1', stage: 'vip' });
    expect(state.audit.map(({ tool, ok }) => ({ tool, ok }))).toEqual([
      { tool: 'get_contact', ok: false },
      { tool: 'update_contact', ok: false },
    ]);
    expect(state.contacts['c-1']?.stage).toBe('new');
  });

  it('filters slots by clinic-local date', () => {
    const state = seedState();
    const result = callTool(state, 'search_slots', { date: '2026-10-23' }).result;
    expect(result).toEqual([
      { slot_id: 's-tomorrow', start: '2026-10-23T09:00:00-05:00', label: 'Fri, Oct 23, 9:00 AM' },
    ]);
  });

  it('lets the agent make policy mistakes and records them', () => {
    const state = seedState();
    callTool(state, 'set_opt_out', { contact_id: 'c-1' });
    const booking = callTool(state, 'book_appointment', {
      contact_id: 'c-1',
      slot_id: 's-tomorrow',
      service_id: 'cleaning',
    });
    expect(booking.ok).toBe(true);
    expect(state.audit.at(-1)?.tool).toBe('book_appointment');
  });
});
