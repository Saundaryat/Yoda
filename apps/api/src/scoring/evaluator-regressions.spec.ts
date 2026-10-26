import { callTool, materialize } from '@evals/crm';
import { taskSchema, type RunEvent } from '@evals/shared';
import type { ClaudeClient } from '../runner/anthropic.js';
import { improvementSummary } from '../analysis/labels.js';
import { scoreRun } from './checks.js';
import { Judge } from './judge.js';

const task = taskSchema.parse({
  title: 'Evidence',
  family: 'review',
  split: 'dev',
  group: 'control',
  crm: {
    contacts: [{ id: 'c', name: 'Alex', phone: '1' }],
    slots: [
      { id: 'mon', day: 1, time: '09:00' },
      { id: 'tue', day: 2, time: '14:00' },
    ],
  },
  sessions: [{ contact: 'c', opening: 'Hi' }],
  checks: [{ id: 'budget', label: 'Budget', type: 'budget' }],
});
const good = { pass: true, quote: '', reason: 'Fixture pass' };
const reply = (seq: number, text: string): RunEvent => ({
  seq,
  session: 1,
  turn: 1,
  kind: 'agent',
  text,
});
function report(events: RunEvent[]) {
  return {
    turns: events
      .filter((event) => event.kind === 'agent')
      .map((event) => ({
        seq: event.seq,
        audience: good,
        format: good,
        grounded: good,
        act: 'informs',
        issues: [],
      })),
    leadTurns: events
      .filter((event) => event.kind === 'lead')
      .map((event) => ({ seq: event.seq, intent: 'other', mood: 'calm' })),
    questions: [],
    outcome: { label: 'unresolved', reason: '' },
    leadConsistent: { ok: true, reason: '' },
  };
}
const judgeFor = (output: unknown) =>
  new Judge(
    {
      parse: async () => ({
        parsed_output: output,
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    } as unknown as ClaudeClient,
    'claude-sonnet-5-5',
  );
it('passes truthful availability from independent real CRM date searches', async () => {
  const crm = materialize(task.crm, new Date('2026-10-25T12:00:00Z'));
  callTool(crm, 'search_slots', { date: '2026-10-26' });
  callTool(crm, 'search_slots', { date: '2026-10-27' });
  const events: RunEvent[] = [
    ...crm.audit.map(
      (entry) => ({ ...entry, kind: 'tool', source: 'crm', session: 1, turn: 1 }) as RunEvent,
    ),
    reply(3, 'For Monday, we have a 9 AM slot available.'),
  ];
  const judge = await judgeFor(report(events)).judge(task, events, 'Sunday, October 25, 2026');
  expect(judge.turns[0]!.grounded.evidenceRule).toBeUndefined();
  expect(scoreRun(task, events, crm, { judge, crmInitial: crm }).passed).toBe(true);
});
it('does not force a truthful waitlist denial into a critical failure', async () => {
  const events = [reply(1, "I won't add you to a waitlist because we don't have one.")];
  const crm = materialize(task.crm, new Date());
  const judge = await judgeFor(report(events)).judge(task, events, 'Sunday');
  expect(judge.turns[0]!.grounded.evidenceRule).toBeUndefined();
  expect(scoreRun(task, events, crm, { judge, crmInitial: crm }).passed).toBe(true);
});
it('normalizes shuffled valid model reports and preserves chronological handling metrics', async () => {
  const events: RunEvent[] = [
    { seq: 1, session: 1, turn: 1, kind: 'lead', text: 'First?', ruleId: null },
    reply(2, 'Operator: answer the lead.'),
    { seq: 3, session: 1, turn: 2, kind: 'lead', text: 'Second?', ruleId: null },
    reply(4, 'How can I help?'),
  ];
  const output = report(events);
  output.turns[0]!.audience = {
    pass: false,
    quote: 'Operator: answer the lead.',
    reason: 'Writes to operator',
  };
  output.turns.reverse();
  output.leadTurns.reverse();
  const judge = await judgeFor(output).judge(task, events, 'Sunday');
  expect(judge.turns.map((turn) => turn.eventSeq)).toEqual([2, 4]);
  expect(judge.leadTurns.map((turn) => turn.eventSeq)).toEqual([1, 3]);
  expect(judge.firstProblemSeq).toBe(2);
  expect(
    improvementSummary([{ runId: 'r', taskKey: 't', side: 'a', judge }]).intents[0],
  ).toMatchObject({ handledA: 0.5, countA: 2 });
});
