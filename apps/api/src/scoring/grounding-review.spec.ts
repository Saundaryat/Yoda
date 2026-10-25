import { taskSchema, type RunEvent } from '@evals/shared';
import type { ClaudeClient } from '../runner/anthropic.js';
import { reviewGrounding } from './grounding-review.js';
const task = taskSchema.parse({
  title: 't',
  family: 'f',
  split: 'dev',
  group: 'control',
  crm: { contacts: [{ id: 'c', name: 'Alex', phone: '1' }], slots: [] },
  sessions: [{ contact: 'c', opening: 'hi' }],
  checks: [{ id: 'b', label: 'b', type: 'budget' }],
});
const trace: RunEvent[] = [
  {
    seq: 1,
    session: 1,
    turn: 1,
    kind: 'tool',
    source: 'crm',
    tool: 'search_slots',
    args: {},
    ok: true,
    result: [],
  },
  { seq: 3, session: 1, turn: 1, kind: 'agent', text: "Once she confirms, I'll book it." },
];
const turn = {
  eventSeq: 3,
  grounded: { pass: false, quote: "I'll book it", reason: 'Implied hold', verified: true },
} as Parameters<typeof reviewGrounding>[4][number];
const client = (basis: string, evidenceSeqs: number[], quote = '', claimType = 'availability') =>
  ({
    parse: async () => ({
      parsed_output: {
        decisions: [
          {
            seq: 3,
            basis,
            claimType,
            quote,
            reason: 'Reviewed facts.',
            evidenceSeqs,
          },
        ],
      },
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  }) as unknown as ClaudeClient;
it('can clear a false completed-action accusation for a future intent while retaining the original proposal', async () => {
  const before = structuredClone(turn);
  const review = await reviewGrounding(
    client('future_intent', []),
    'claude-sonnet-5-5',
    task,
    trace,
    [turn],
    'frozen rules',
  );
  expect(review.decisions.get(3)?.basis).toBe('future_intent');
  expect(turn).toEqual(before);
});
it.each([{ evidence: [] }, { evidence: [4] }, { evidence: [99] }])(
  'rejects unsupported evidence for a factual pass: %j',
  async ({ evidence }) => {
    await expect(
      reviewGrounding(client('supported_fact', evidence), 'm', task, trace, [turn], 'rules'),
    ).rejects.toThrow();
  },
);
it('rejects failed, other-contact and other-session supporting tools', async () => {
  for (const tool of [
    { ...trace[0]!, ok: false },
    { ...trace[0]!, session: 2 },
    { ...trace[0]!, args: { contact_id: 'someone-else' } },
  ])
    await expect(
      reviewGrounding(
        client('supported_fact', [1]),
        'm',
        task,
        [tool as RunEvent, trace[1]!],
        [turn],
        'rules',
      ),
    ).rejects.toThrow();
});
it('rejects fabricated failing quotes instead of silently grading them', async () => {
  await expect(
    reviewGrounding(client('unsupported', [], 'already booked'), 'm', task, trace, [turn], 'rules'),
  ).rejects.toThrow('verbatim');
});
it('accepts concrete earlier successful evidence', async () => {
  expect(
    (
      await reviewGrounding(client('supported_fact', [1]), 'm', task, trace, [turn], 'rules')
    ).decisions.get(3)?.evidenceSeqs,
  ).toEqual([1]);
});

it('accepts an earlier successful policy view only in the same session', async () => {
  const viewed = {
    ...trace[0]!,
    source: 'hermes',
    tool: 'skill_view',
    result: 'Policy text',
  } as RunEvent;
  const c = () => client('supported_fact', [1], '', 'policy');
  await expect(
    reviewGrounding(c(), 'm', task, [viewed, trace[1]!], [turn], 'rules'),
  ).resolves.toBeDefined();
  await expect(
    reviewGrounding(c(), 'm', task, [{ ...viewed, session: 2 }, trace[1]!], [turn], 'rules'),
  ).rejects.toThrow('other-session');
});
