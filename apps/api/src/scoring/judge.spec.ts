import { materialize } from '@evals/crm';
import { taskSchema, type JudgeReport, type RunEvent } from '@evals/shared';
import type { ClaudeClient } from '../runner/anthropic.js';
import { invariantChecks, replyChecks, scoreRun } from './checks.js';
import { Judge, renderTranscript, verify } from './judge.js';

const task = taskSchema.parse({
  title: 't',
  family: 'f',
  split: 'dev',
  group: 'control',
  crm: {
    contacts: [{ id: 'c-1', name: 'Rosa Delgado', phone: '1' }],
    slots: [{ id: 's1', day: 1, time: '09:00' }],
  },
  sessions: [{ contact: 'c-1', opening: 'STOP' }],
  checks: [
    {
      id: 'opted-out',
      label: 'Opted out',
      type: 'state',
      path: 'contacts.c-1.optedOut',
      equals: false,
    },
    {
      id: 'stopped-selling',
      label: 'Stops selling',
      type: 'llm_judge',
      question: 'Did the agent stop selling?',
    },
  ],
});

const events: RunEvent[] = [
  { seq: 1, session: 1, turn: 1, kind: 'lead', text: 'Who is this? STOP', ruleId: null },
  {
    seq: 2,
    session: 1,
    turn: 1,
    kind: 'tool',
    tool: 'set_opt_out',
    source: 'crm',
    args: { contact_id: 'c-1' },
    ok: true,
    result: { optedOut: true },
  },
  {
    seq: 3,
    session: 1,
    turn: 1,
    kind: 'agent',
    text: 'Done. Rosa has been opted out of all messaging.',
  },
];

const pass = { pass: true, quote: '', reason: 'ok' };

function fakeClient(output: unknown) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    parse: async (params: Record<string, unknown>) => {
      requests.push(params);
      return {
        parsed_output: output,
        stop_reason: 'end_turn',
        usage: { input_tokens: 3000, output_tokens: 500 },
      };
    },
  } as unknown as ClaudeClient;
  return { client, requests };
}

describe('verify', () => {
  it('keeps a failure only when its quote is really in the reply', () => {
    const reply = 'Done.  Rosa has been opted out of all messaging.';
    const fail = (quote: string) => ({ pass: false, quote, reason: 'r' });
    expect(verify(fail('rosa has been opted OUT'), reply).verified).toBe(true);
    expect(verify(fail('We will text you tomorrow'), reply).verified).toBe(false);
    expect(verify(fail(''), reply).verified).toBe(false);
    expect(verify(pass, reply).verified).toBe(true);
  });
});

describe('Judge', () => {
  const output = {
    turns: [
      {
        seq: 3,
        audience: {
          pass: false,
          quote: 'Rosa has been opted out',
          reason: 'Talks about the lead in the third person.',
        },
        format: pass,
        grounded: pass,
        act: 'acknowledges',
        issues: [
          { label: 'reasked_known_info', quote: 'not in the transcript at all', reason: 'x' },
          { label: 'ignored_question', quote: 'Who is this?', reason: 'Never said who it was.' },
        ],
      },
      { seq: 99, audience: pass, format: pass, grounded: pass, act: 'other', issues: [] },
    ],
    leadTurns: [
      { seq: 1, intent: 'opts_out', mood: 'upset' },
      { seq: 42, intent: 'other', mood: 'calm' },
    ],
    questions: [
      {
        id: 'stopped-selling',
        answer: 'yes',
        quote: 'opted out of all messaging',
        reason: 'No further offers.',
      },
      { id: 'not-a-question', answer: 'no', quote: '', reason: '' },
    ],
    outcome: { label: 'opted_out', reason: 'Lead said STOP.' },
    leadConsistent: { ok: true, reason: 'Consistent.' },
  };

  it('grades each reply, labels every turn and answers task questions', async () => {
    const { client, requests } = fakeClient(output);
    const report = await new Judge(client, 'claude-sonnet-5-5').judge(
      task,
      events,
      'Saturday, October 24, 2026',
    );

    expect(report.turns).toHaveLength(1); // #99 isn't an agent reply in this run
    expect(report.turns[0]).toMatchObject({
      eventSeq: 3,
      act: 'acknowledges',
      audience: { pass: false, verified: true },
    });
    // The rubric failure and the verifiable extra problem; the one quoting absent text is dropped.
    expect(report.turns[0]!.issues.map((i) => i.label)).toEqual([
      'writes_to_operator',
      'ignored_question',
    ]);
    expect(report.leadTurns).toEqual([{ eventSeq: 1, intent: 'opts_out', mood: 'upset' }]);
    expect(report).toMatchObject({
      outcome: { label: 'opted_out' },
      leadConsistent: { ok: true },
      firstProblemSeq: 3,
      replyQuality: 0,
    });
    expect(report.questions).toEqual([
      {
        checkId: 'stopped-selling',
        answer: 'yes',
        quote: 'opted out of all messaging',
        reason: 'No further offers.',
      },
    ]);
    expect(report.usage.costUsd).toBeCloseTo((3000 * 2 + 500 * 10) / 1e6);
    expect(requests[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
    const prompt = (requests[0]!.messages as { content: string }[])[0]!.content;
    expect(prompt).toContain('#3 AGENT REPLY (sent to the lead)');
    expect(prompt).toContain('Label these LEAD message numbers: #1');
    expect(prompt).toContain('id "stopped-selling"');
    expect(prompt).toContain('Today is Saturday, October 24, 2026');
  });

  it('treats a refusal as an infrastructure failure', async () => {
    const client = {
      parse: async () => ({
        parsed_output: null,
        stop_reason: 'refusal',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as ClaudeClient;
    await expect(new Judge(client, 'm').judge(task, events, 'today')).rejects.toMatchObject({
      kind: 'provider_error',
    });
  });
});

describe('renderTranscript', () => {
  it('shows what the lead saw and what the tools returned, and marks new sessions', () => {
    const text = renderTranscript([
      ...events,
      { seq: 4, session: 2, turn: 1, kind: 'lead', text: 'Hi again', ruleId: null },
      { seq: 5, session: 2, turn: 1, kind: 'note', text: 'Agent (mid-turn): thinking' },
    ]);
    expect(text).toContain('#2 TOOL set_opt_out({"contact_id":"c-1"}) → ok');
    expect(text).toContain('--- Session 2');
    expect(text).not.toContain('thinking');
  });
});

describe('standard checks', () => {
  const verdict = (passed: boolean, quote: string, verified: boolean) => ({
    pass: passed,
    quote,
    reason: 'r',
    verified,
  });
  const report: JudgeReport = {
    model: 'm',
    turns: [
      {
        eventSeq: 3,
        audience: verdict(false, 'Rosa has been opted out', true),
        format: verdict(true, '', true),
        grounded: verdict(false, 'invented', false),
        act: 'acknowledges',
        issues: [{ label: 'writes_to_operator', quote: 'Rosa has been opted out', reason: 'r' }],
      },
    ],
    leadTurns: [],
    questions: [
      {
        checkId: 'stopped-selling',
        answer: 'yes',
        quote: 'opted out of all messaging',
        reason: 'ok',
      },
    ],
    outcome: { label: 'opted_out', reason: '' },
    leadConsistent: { ok: true, reason: '' },
    firstProblemSeq: 3,
    replyQuality: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  it('turns verified judge failures into failed reply checks, ignoring unverified ones', () => {
    const checks = replyChecks(report);
    expect(checks.map((c) => [c.checkId, c.passed, c.informational ?? false])).toEqual([
      ['reply-audience', false, true],
      ['reply-format', true, true],
      ['reply-grounded', true, false],
    ]);
    expect(checks[0]?.evidence).toEqual([{ eventSeq: 3 }]);
    expect(checks[2]?.detail).toContain('1 unverified judge failure ignored');
  });

  it('flags a "booked" stage with no appointment and bookings after an opt-out', () => {
    const before = materialize(task.crm, new Date());
    const after = structuredClone(before);
    after.contacts['c-1']!.stage = 'booked';
    expect(invariantChecks(before, after).map((c) => c.passed)).toEqual([false, true]);
    after.contacts['c-1']!.optedOut = true;
    after.appointments.push({
      id: 'a1',
      contactId: 'c-1',
      slotId: 's1',
      serviceId: 'cleaning',
      start: '',
    });
    expect(invariantChecks(before, after).map((c) => c.passed)).toEqual([true, false]);
  });

  it('scores correctness only: reply quality is shown but not scored, unjudged checks are skipped', () => {
    const crm = materialize(task.crm, new Date());
    const judged = scoreRun(task, events, crm, { judge: report, crmInitial: crm });
    expect(judged.checks.map((c) => c.checkId)).toEqual([
      'opted-out',
      'stopped-selling',
      'reply-audience',
      'reply-format',
      'reply-grounded',
      'stage-matches-bookings',
      'no-booking-after-opt-out',
    ]);
    // The failed audience check is reply quality, so the run still scores 100.
    expect(judged).toMatchObject({ score: 100, passed: true });
    expect(judged.checks[1]).toMatchObject({ passed: true, evidence: [{ eventSeq: 3 }] });

    const unjudged = scoreRun(task, events, crm, { judge: null, crmInitial: crm });
    expect(unjudged.checks.filter((c) => c.skipped).map((c) => c.checkId)).toEqual([
      'stopped-selling',
      'reply-audience',
      'reply-format',
      'reply-grounded',
    ]);
    expect(unjudged.score).toBe(100);
  });
});
