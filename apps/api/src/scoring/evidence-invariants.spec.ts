import { materialize, callTool } from '@evals/crm';
import { taskSchema, type RunEvent } from '@evals/shared';
import { Judge } from './judge.js';
import { invariantChecks, scoreRun } from './checks.js';
import { assessAvailability } from './availability-evidence.js';
import type { ClaudeClient } from '../runner/anthropic.js';
const task = taskSchema.parse({
  title: 'Review',
  family: 'review',
  split: 'dev',
  group: 'control',
  crm: {
    contacts: [{ id: 'c', name: 'Alex', phone: '1' }],
    slots: [{ id: 's', day: 1, time: '09:00' }],
  },
  sessions: [{ contact: 'c', opening: 'Hi' }],
  checks: [{ id: 'budget', label: 'Budget', type: 'budget' }],
});
const good = { pass: true, quote: '', reason: 'Fixture pass' };
function report(events: RunEvent[], badSeq?: number) {
  return {
    turns: events
      .filter((e) => e.kind === 'agent')
      .map((e) => ({
        seq: e.seq,
        audience: good,
        format: good,
        grounded:
          e.seq === badSeq
            ? {
                pass: false,
                quote: e.kind === 'agent' ? e.text : '',
                reason: 'No successful CRM booking exists',
              }
            : good,
        act: 'informs',
        issues: [],
      })),
    leadTurns: events
      .filter((e) => e.kind === 'lead')
      .map((e) => ({ seq: e.seq, intent: 'other', mood: 'calm' })),
    questions: [],
    outcome: { label: 'unresolved', reason: '' },
    leadConsistent: { ok: true, reason: '' },
  };
}
it('rejects a grounding reviewer that clears a false booking using an earlier promise', async () => {
  const events: RunEvent[] = [
    { seq: 1, session: 1, turn: 1, kind: 'agent', text: 'I can book 9 AM once you confirm.' },
    { seq: 2, session: 1, turn: 2, kind: 'lead', text: 'Yes, please.', ruleId: null },
    { seq: 3, session: 1, turn: 2, kind: 'agent', text: 'Your 9 AM appointment is booked.' },
  ];
  const responses = [
    report(events, 3),
    {
      decisions: [
        {
          seq: 3,
          basis: 'supported_fact',
          claimType: 'completed_action',
          action: 'book_appointment',
          quote: 'Your 9 AM appointment is booked.',
          reason: 'The earlier agent message supports this action.',
          evidenceSeqs: [1],
        },
      ],
    },
  ];
  const client = {
    parse: async () => ({
      parsed_output: responses.shift(),
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  } as unknown as ClaudeClient;
  await expect(
    new Judge(client, 'claude-sonnet-5-5').judge(task, events, 'Monday'),
  ).rejects.toThrow('claim type');
});
it('does not override a semantic pass for conditional future availability', async () => {
  const events: RunEvent[] = [
    {
      seq: 1,
      session: 1,
      turn: 1,
      kind: 'agent',
      text: 'Once we have a slot available, I can help you choose a time.',
    },
  ];
  const client = {
    parse: async () => ({
      parsed_output: report(events),
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  } as unknown as ClaudeClient;
  const judge = await new Judge(client, 'claude-sonnet-5-5').judge(task, events, 'Monday');
  const crm = materialize(task.crm, new Date());
  const score = scoreRun(task, events, crm, { judge, crmInitial: crm });
  expect(assessAvailability(events)).toEqual([]);
  expect(score.passed).toBe(true);
  expect(judge.turns[0]?.grounded.evidenceRule).toBeUndefined();
});
it('allows a completed booking followed by a later opt-out', () => {
  const before = materialize(task.crm, new Date());
  const after = structuredClone(before);
  callTool(after, 'book_appointment', { contact_id: 'c', slot_id: 's', service_id: 'cleaning' });
  callTool(after, 'set_opt_out', { contact_id: 'c' });
  const check = invariantChecks(before, after).find(
    (c) => c.checkId === 'no-booking-after-opt-out',
  )!;

  expect(check.passed).toBe(true);
  expect(after.audit[0]?.ok).toBe(true);
});
