import { materialize } from '@evals/crm';
import { taskSchema, type JudgeReport, type RunEvent } from '@evals/shared';
import type { ClaudeClient } from '../runner/anthropic.js';
import { invariantChecks, replyChecks, scoreRun } from './checks.js';
import { GroundingSeverityClassifier, type TypeSafeSystemOneClient } from './grounding-severity.js';
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
      if (String(params.system).startsWith('Grounding evidence review.')) {
        const proposed = JSON.parse((params.messages as { content: string }[])[0]!.content)
          .proposed as { seq: number; quote: string; reason: string }[];
        return {
          parsed_output: {
            decisions: proposed.map((t) => ({ ...t, basis: 'unsupported', evidenceSeqs: [] })),
          },
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
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

  it('passes explicit preloaded authority to the judge without granting unopened policy', async () => {
    const { client, requests } = fakeClient(output);
    const judge = new Judge(client, 'claude-sonnet-5-5');
    await judge.judge(task, events, 'Saturday, October 24, 2026', {
      instructions: 'Reply directly to the customer.',
      preloadedPolicies: [{ name: 'clinic-policy', content: 'Never book same-day.' }],
    });
    await judge.judge(task, events, 'Saturday, October 24, 2026', {
      instructions: 'Reply directly to the customer.',
      preloadedPolicies: [],
    });
    expect(JSON.stringify(requests[0])).toContain('Never book same-day.');
    expect(JSON.stringify(requests[1])).not.toContain('Never book same-day.');
  });

  it('adds one Jev severity decision to each verified grounding failure', async () => {
    const groundedOutput = structuredClone(output);
    groundedOutput.turns[0]!.grounded = {
      pass: false,
      quote: 'opted out of all messaging',
      reason: 'The CRM only records an opt-out flag.',
    };
    const { client } = fakeClient(groundedOutput);
    const typeSafe = {
      systemOne: async () => ({
        model: 'jev-1.14.0',
        answers: {
          claim_0: {
            type: 'choice',
            choice: 'minor',
            confidence: 0.8,
            probabilities: { minor: 0.9, serious: 0.1 },
          },
        },
        usage: { input_tokens: 100, output_tokens: 5 },
      }),
    } as unknown as TypeSafeSystemOneClient;

    const report = await new Judge(
      client,
      'claude-sonnet-5-5',
      new GroundingSeverityClassifier(typeSafe, 'jev-1.14.0'),
    ).judge(task, events, 'Saturday, October 24, 2026');

    expect(report.turns[0]?.grounded.severity).toMatchObject({
      label: 'minor',
      model: 'jev-1.14.0',
    });
    expect(report.turns[0]?.issues.find((i) => i.label === 'unbacked_claim')?.severity?.label).toBe(
      'minor',
    );
    expect(report.groundingClassifier).toMatchObject({ model: 'jev-1.14.0', inputTokens: 100 });
    expect(report.usage.inputTokens).toBe(3100);
  });

  it.each([
    {
      text: 'We have morning slots available.',
      quote: 'We have morning slots available',
      rule: 'availability-evidence-v1',
    },
    {
      text: 'Want me to add you to the waitlist?',
      quote: 'add you to the waitlist',
      rule: 'unsupported-waitlist-v1',
    },
    {
      text: 'Call the clinic at the number on file.',
      quote: 'Call the clinic at the number on file',
      rule: 'clinic-contact-evidence-v1',
    },
  ])(
    'a CRM evidence failure cannot be passed by Claude or downgraded to minor by Jev: $rule',
    async ({ text, quote, rule }) => {
      const trace: RunEvent[] = [
        {
          seq: 1,
          session: 1,
          turn: 1,
          kind: 'lead',
          text: 'Do you have morning appointments?',
          ruleId: null,
        },
        { seq: 3, session: 1, turn: 1, kind: 'agent', text },
      ];
      const good = { pass: true, quote: '', reason: 'Model incorrectly thinks this is grounded.' };
      const { client } = fakeClient({
        ...output,
        turns: [
          {
            seq: 3,
            audience: good,
            format: good,
            grounded: good,
            act: 'offers_options',
            issues: [],
          },
        ],
      });
      const classifier = {
        classify: vi.fn().mockResolvedValue({
          decisions: new Map([
            [
              3,
              {
                label: 'minor',
                confidence: 0.9,
                probabilities: { minor: 0.9, serious: 0.1 },
                model: 'jev-test',
              },
            ],
          ]),
          usage: { model: 'jev-test', inputTokens: 0, outputTokens: 0, costUsd: 0 },
        }),
      } as unknown as GroundingSeverityClassifier;
      const report = await new Judge(client, 'claude-sonnet-5-5', classifier).judge(
        task,
        trace,
        'Saturday, October 24, 2026',
      );
      expect(report.turns[0]?.grounded).toMatchObject({
        pass: false,
        verified: true,
        quote,
        evidenceRule: {
          id: rule,
          severity: 'serious',
          modelVerdict: { pass: true },
        },
        severity: { label: 'minor' },
      });
      expect(report.turns[0]?.issues[0]).toMatchObject({
        label: 'unbacked_claim',
        evidenceRule: { severity: 'serious' },
      });
      expect(replyChecks(report).find((c) => c.checkId === 'reply-grounded')).toMatchObject({
        passed: false,
        critical: true,
      });
      const crm = materialize(task.crm, new Date());
      const score = scoreRun(task, trace, crm, { judge: report, crmInitial: crm });
      expect(score.passed).toBe(false);
      expect(score.score).toBeLessThan(100);
    },
  );

  it('clears a false future-booking finding through evidence review without calling it a completed reservation', async () => {
    const intent = "Once she confirms, I'll book the 9 AM slot.";
    const pass = { pass: true, quote: '', reason: 'ok' };
    const primary = fakeClient({
      ...output,
      turns: [
        {
          seq: 3,
          audience: pass,
          format: pass,
          grounded: { pass: false, quote: "I'll book the 9 AM slot", reason: 'Implies held slot.' },
          act: 'informs',
          issues: [],
        },
      ],
    });
    const client = {
      parse: async (params: Record<string, unknown>) =>
        String(params.system).startsWith('Grounding evidence review.')
          ? {
              parsed_output: {
                decisions: [
                  {
                    seq: 3,
                    basis: 'future_intent',
                    claimType: 'other',
                    quote: '',
                    reason: 'The booking is conditional intent, not a hold.',
                    evidenceSeqs: [],
                  },
                ],
              },
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5 },
            }
          : primary.client.parse(params as never),
    } as unknown as ClaudeClient;
    const trace: RunEvent[] = [
      {
        seq: 1,
        session: 1,
        turn: 1,
        kind: 'lead',
        text: 'My parent will confirm later.',
        ruleId: null,
      },
      { seq: 3, session: 1, turn: 1, kind: 'agent', text: intent },
    ];
    const report = await new Judge(client, 'claude-sonnet-5-5').judge(
      task,
      trace,
      'Saturday, October 24, 2026',
    );
    expect(report.turns[0]?.grounded).toMatchObject({
      pass: true,
      review: { basis: 'future_intent', modelVerdict: { pass: false } },
    });
    const crm = materialize(task.crm, new Date());
    const score = scoreRun(task, trace, crm, { judge: report, crmInitial: crm });
    expect(score).toMatchObject({ passed: true, score: 100 });
    expect(score.checks.find((c) => c.checkId === 'reply-grounded')?.detail).toContain(
      'cleared by evidence review',
    );
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

  it.each(['turns', 'leadTurns', 'questions'] as const)(
    'rejects an incomplete %s report instead of silently passing',
    async (field) => {
      const incomplete = structuredClone(output);
      incomplete[field] = [];
      await expect(
        new Judge(fakeClient(incomplete).client, 'm').judge(task, events, 'today'),
      ).rejects.toMatchObject({ kind: 'provider_error' });
    },
  );

  it('rejects duplicate reply judgments', async () => {
    const duplicate = structuredClone(output);
    duplicate.turns.push(duplicate.turns[0]!);
    await expect(
      new Judge(fakeClient(duplicate).client, 'm').judge(task, events, 'today'),
    ).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('rejects fabricated evidence for a failed task answer', async () => {
    const fabricated = structuredClone(output);
    fabricated.questions[0] = {
      id: 'stopped-selling',
      answer: 'no',
      quote: 'Buy our discount cleaning now',
      reason: 'Kept selling',
    };
    await expect(
      new Judge(fakeClient(fabricated).client, 'm').judge(task, events, 'today'),
    ).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('accepts task evidence from actual tool results, not only SMS text', async () => {
    const toolEvidence = structuredClone(output);
    toolEvidence.questions[0] = {
      id: 'stopped-selling',
      answer: 'no',
      quote: '"optedOut":true',
      reason: 'Reference evidence from tool output',
    };
    const report = await new Judge(fakeClient(toolEvidence).client, 'm').judge(
      task,
      events,
      'today',
    );
    expect(report.questions[0]?.quote).toBe('"optedOut":true');
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

  it('requires review for an unverified grounding failure', () => {
    const checks = replyChecks(report);
    expect(checks.map((c) => [c.checkId, c.passed, c.informational ?? false])).toEqual([
      ['reply-audience', false, true],
      ['reply-format', true, true],
      ['reply-grounded', false, false],
    ]);
    expect(checks[0]?.evidence).toEqual([{ eventSeq: 3 }]);
    expect(checks[2]).toMatchObject({ skipped: true, critical: true });
    const crm = materialize(task.crm, new Date());
    expect(scoreRun(task, events, crm, { judge: report, crmInitial: crm })).toMatchObject({
      passed: null,
      score: null,
    });
  });

  it('does not award a silent agent a clean grounding pass', () => {
    expect(
      replyChecks({ ...report, turns: [] }).find((c) => c.checkId === 'reply-grounded'),
    ).toMatchObject({ passed: false, critical: true });
  });

  it('notes minor grounding issues but only fails the critical check for serious ones', () => {
    const grounding = (label: 'minor' | 'serious') => ({
      pass: false,
      quote: label === 'minor' ? 'soon' : "You're booked",
      reason: 'Unsupported.',
      verified: true,
      severity: {
        label,
        confidence: 0.9,
        probabilities:
          label === 'minor' ? { minor: 0.95, serious: 0.05 } : { minor: 0.05, serious: 0.95 },
        model: 'jev-1.14.0',
      },
    });
    const withGrounding = (label: 'minor' | 'serious'): JudgeReport => ({
      ...report,
      turns: [{ ...report.turns[0]!, grounded: grounding(label) }],
    });

    const minor = replyChecks(withGrounding('minor')).find((c) => c.checkId === 'reply-grounded');
    expect(minor).toMatchObject({ passed: true, evidence: [{ eventSeq: 3 }] });
    expect(minor?.detail).toContain('1 minor grounding issue noted');

    const serious = replyChecks(withGrounding('serious')).find(
      (c) => c.checkId === 'reply-grounded',
    );
    expect(serious).toMatchObject({ passed: false, critical: true, evidence: [{ eventSeq: 3 }] });
  });

  it('flags a "booked" stage with no appointment and bookings after an opt-out', () => {
    const before = materialize(task.crm, new Date());
    const after = structuredClone(before);
    after.contacts['c-1']!.stage = 'booked';
    expect(invariantChecks(before, after).map((c) => c.passed)).toEqual([false, true]);
    after.contacts['c-1']!.optedOut = true;
    after.audit.push(
      {
        seq: 1,
        tool: 'set_opt_out',
        args: { contact_id: 'c-1' },
        ok: true,
        result: { optedOut: true },
      },
      {
        seq: 2,
        tool: 'book_appointment',
        args: { contact_id: 'c-1', slot_id: 's1' },
        ok: true,
        result: {},
      },
    );
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
    const clean = {
      ...report,
      turns: report.turns.map((t) => ({ ...t, grounded: verdict(true, '', true) })),
    };
    const judged = scoreRun(task, events, crm, { judge: clean, crmInitial: crm });
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
    expect(unjudged).toMatchObject({ score: null, passed: null });
  });
});
