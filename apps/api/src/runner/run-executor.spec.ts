import { configurationSpecSchema, type TaskDefinition } from '@evals/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Judge } from '../scoring/judge.js';
import { readTaskFiles } from '../suites/task-files.js';
import { InfraError } from './hermes-cli.js';
import { executeRun, type ExecutorSettings } from './run-executor.js';

const FAKE_HERMES = fileURLToPath(new URL('../../test/fake-hermes.mjs', import.meta.url));
const tasks = new Map(
  readTaskFiles(fileURLToPath(new URL('../../../../suites', import.meta.url))).map((f) => [
    f.key,
    f.definition,
  ]),
);
const task = (key: string) => tasks.get(key) as TaskDefinition;

const spec = configurationSpecSchema.parse({
  provider: 'openai',
  model: 'gpt-test',
  systemPrompt: 'You are the Bright Smile Dental SMS assistant.',
  skills: ['clinic-policy'],
});

let runsDir: string;
let settings: ExecutorSettings;
beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'evals-runs-'));
  settings = {
    hermesBin: FAKE_HERMES,
    runsDir,
    turnTimeoutMs: 20_000,
    runBudgetSeconds: 60,
    providerKeys: { OPENAI_API_KEY: 'sk-test-only' },
    skillContent: () => '---\nname: clinic-policy\ndescription: test\n---\nRules.',
    leadClient: null,
    leadModel: 'claude-test',
    judge: null,
  };
});
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

describe('executeRun with the fake Hermes', () => {
  it('runs a scenario end to end and scores it', async () => {
    const outcome = await executeRun(
      { runId: 'r1', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'scripted' },
      settings,
    );
    expect(outcome.checks.filter((c) => !c.passed)).toEqual([]);
    expect(outcome).toMatchObject({ passed: true, score: 100, leadFallbacks: 0 });
    expect(outcome.events.map((e) => (e.kind === 'tool' ? `tool:${e.tool}` : e.kind))).toEqual([
      'lead',
      'tool:skill_view',
      'tool:get_contact',
      'tool:search_slots',
      'agent',
      'lead',
      'tool:search_slots',
      'tool:book_appointment',
      'tool:update_contact',
      'agent',
      'lead',
      'agent',
    ]);
    expect(outcome.events[1]).toMatchObject({ kind: 'tool', source: 'hermes', tool: 'skill_view' });
    expect(outcome.crmFinal.appointments).toHaveLength(1);
    expect(outcome.sessionIds).toHaveLength(1);
    expect(outcome.costUsd).toBeCloseTo(0.003);
    expect(outcome.context).toMatchObject({ model: 'gpt-test', billingProvider: 'openai-api' });
  });

  it('records the recovery when the chosen slot is taken', async () => {
    const outcome = await executeRun(
      { runId: 'r2', attempt: 1, task: task('slot-taken'), spec, leadMode: 'scripted' },
      settings,
    );
    const bookings = outcome.events.filter(
      (e) => e.kind === 'tool' && e.tool === 'book_appointment',
    );
    expect(bookings.map((e) => e.kind === 'tool' && e.ok)).toEqual([false, true]);
    expect(outcome.passed).toBe(true);
  });

  it('gives Hermes a home with only the configured provider key', async () => {
    await executeRun(
      { runId: 'r3', attempt: 2, task: task('stop-opt-out'), spec, leadMode: 'scripted' },
      settings,
    );
    const home = join(runsDir, 'r3', 'attempt-2', 'home');
    expect(readFileSync(join(home, '.env'), 'utf8')).toBe('OPENAI_API_KEY=sk-test-only\n');
    const config = JSON.parse(readFileSync(join(home, 'config.yaml'), 'utf8'));
    expect(config).toMatchObject({
      fallback_providers: [],
      auth: { adopt_external_logins: false },
      auxiliary: { background_review: { enabled: false } },
      memory: { memory_enabled: false },
    });
    expect(
      readFileSync(join(home, 'skills', 'clinic', 'clinic-policy', 'SKILL.md'), 'utf8'),
    ).toContain('Rules.');
  });

  it.each([
    ['rate_limit', 'rate_limit', true],
    ['account', 'account', false],
  ])('classifies a %s failure', async (mode, kind, retryable) => {
    const attempt = executeRun(
      { runId: 'r4', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'scripted' },
      { ...settings, extraEnv: { FAKE_HERMES_FAIL: mode } },
    );
    await expect(attempt).rejects.toBeInstanceOf(InfraError);
    await expect(attempt).rejects.toMatchObject({ kind, retryable });
  });

  it('kills a hung turn at the hard timeout', async () => {
    const attempt = executeRun(
      { runId: 'r5', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'scripted' },
      { ...settings, turnTimeoutMs: 500, extraEnv: { FAKE_HERMES_FAIL: 'hang' } },
    );
    await expect(attempt).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('runs a scenario with Claude playing the lead (fake client) and keeps rule-based checks working', async () => {
    const replies = [
      { text: 'oh nice, 9am works for me!', intents: ['accepts', 'confirm'], end: false },
      { text: 'perfect thank you', intents: ['done'], end: true },
    ];
    const leadClient = {
      parse: async () => ({
        parsed_output: replies.shift(),
        stop_reason: 'end_turn',
        usage: { input_tokens: 800, output_tokens: 60 },
      }),
    } as unknown as ExecutorSettings['leadClient'];
    const outcome = await executeRun(
      { runId: 'r7', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'llm' },
      { ...settings, leadClient, leadModel: 'claude-haiku-4-5' },
    );
    const leads = outcome.events.filter((e) => e.kind === 'lead');
    expect(leads.map((e) => e.kind === 'lead' && [e.by, e.ruleId])).toEqual([
      ['llm', null],
      ['llm', 'accepts'],
      ['llm', 'done'],
    ]);
    expect(outcome.passed).toBe(true);
    expect(outcome.leadUsage).toMatchObject({
      calls: 2,
      inputTokens: 1600,
      model: 'claude-haiku-4-5',
    });
    expect(outcome.leadUsage?.costUsd).toBeCloseTo((1600 * 1 + 120 * 5) / 1e6);
  });

  it('has every reply judged after the run and scores the standard checks', async () => {
    // Fake judge: fails the first reply's audience with a quote taken from that reply.
    const judgeClient = {
      parse: async (params: { messages: { content: string }[] }) => {
        const prompt = params.messages[0]!.content;
        const replies = [...prompt.matchAll(/#(\d+) AGENT REPLY \(sent to the lead\): (.*)/g)];
        const ok = { pass: true, quote: '', reason: 'ok' };
        return {
          parsed_output: {
            turns: replies.map(([, seq, text], i) => ({
              seq: Number(seq),
              audience: i === 0 ? { pass: false, quote: text!.slice(0, 12), reason: 'test' } : ok,
              format: ok,
              grounded: ok,
            })),
            questions: [],
          },
          stop_reason: 'end_turn',
          usage: { input_tokens: 2000, output_tokens: 300 },
        };
      },
    } as unknown as ConstructorParameters<typeof Judge>[0];
    const outcome = await executeRun(
      { runId: 'r9', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'scripted' },
      { ...settings, judge: new Judge(judgeClient, 'claude-sonnet-5-5') },
    );
    const byId = Object.fromEntries(outcome.checks.map((c) => [c.checkId, c]));
    expect(byId['reply-audience']).toMatchObject({
      passed: false,
      evidence: [{ eventSeq: expect.any(Number) }],
    });
    expect(byId['reply-grounded']?.passed).toBe(true);
    expect(byId['stage-matches-bookings']?.passed).toBe(true);
    expect(outcome.judge?.turns.length).toBe(3);
    expect(outcome.passed).toBe(true); // audience isn't critical; 9 of 10 weight points
  });

  it('needs ANTHROPIC_API_KEY for the LLM lead', async () => {
    const attempt = executeRun(
      { runId: 'r8', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'llm' },
      settings,
    );
    await expect(attempt).rejects.toMatchObject({ kind: 'account' });
  });

  it('stops immediately when the provider key is missing', async () => {
    const attempt = executeRun(
      { runId: 'r6', attempt: 1, task: task('qualify-and-book'), spec, leadMode: 'scripted' },
      { ...settings, providerKeys: {} },
    );
    await expect(attempt).rejects.toMatchObject({
      kind: 'account',
      message: 'OPENAI_API_KEY is not set',
    });
  });
});
