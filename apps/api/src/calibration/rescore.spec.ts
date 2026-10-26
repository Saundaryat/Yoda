import type { JudgeReport, Score } from '@evals/shared';
import { formatReminderClient, replayRow, selectReplayScope } from './rescore.js';
import type { ClaudeClient } from '../runner/anthropic.js';

describe('judge-only replay', () => {
  it('never queues a Hermes attempt or double bills reused work', () => {
    const source = {
      id: 'source-run',
      experimentId: 'original',
      status: 'scored',
      attempts: 2,
      attemptLog: [{ attempt: 1 }],
      costUsd: 1,
      leadCostUsd: 2,
      judgeCostUsd: 3,
      inputTokens: 100,
      outputTokens: 10,
      context: { skillMode: 'preloaded' },
      sessionIds: ['original-session'],
      crmInitial: { original: true },
      crmFinal: { saved: true },
    } as unknown as Parameters<typeof replayRow>[0];
    const before = structuredClone(source);
    const judge = { usage: { costUsd: 0.01 } } as JudgeReport;
    const score: Score = { passed: true, score: 100, checks: [] };
    const replay = replayRow(source, 'corrected', judge, score);
    expect(replay.status).toBe('scored');
    expect(replay.id).not.toBe(source.id);
    expect(replay.experimentId).toBe('corrected');
    expect(replay.attempts).toBe(0);
    expect(replay.costUsd).toBe(0);
    expect(replay.leadCostUsd).toBe(0);
    expect(replay.judgeCostUsd).toBe(0.01);
    expect(replay.sessionIds).toEqual(source.sessionIds);
    expect(replay.crmFinal).toEqual(source.crmFinal);
    expect(replay.context.rescoring.sourceRunId).toBe(source.id);
    expect(source).toEqual(before);
  });
});

describe('scoring-only replay provenance', () => {
  it.each([true, false, null])(
    'keeps the saved judge version and charges no new model cost when passed=%s',
    (passed) => {
      const judge = {
        evaluatorVersion: 'clinical-grounding-v3',
        usage: { costUsd: 0.08 },
        turns: [],
        questions: [],
      } as unknown as JudgeReport;
      const source = {
        id: 'source',
        context: {},
        judge,
        costUsd: 1,
        leadCostUsd: 2,
      } as unknown as Parameters<typeof replayRow>[0];
      const before = structuredClone(source);
      const score: Score = {
        passed,
        score: passed === null ? null : passed ? 100 : 50,
        checks: [],
      };
      const replay = replayRow(source, 'v4-regrade', judge, score, 'score-only');
      expect(replay).toMatchObject({
        passed,
        score: score.score,
        attempts: 0,
        costUsd: 0,
        leadCostUsd: 0,
        judgeCostUsd: 0,
      });
      expect(replay.judge).toEqual(judge);
      expect(replay.judge.evaluatorVersion).toBe('clinical-grounding-v3');
      expect(replay.context.rescoring).toMatchObject({
        evaluatorVersion: 'evidence-grounding-v10',
        mode: 'score-only',
        sourceJudgeVersion: 'clinical-grounding-v3',
      });
      expect(source).toEqual(before);
    },
  );
});

it('a format retry preserves model, rubric and transcript while requesting only allowed outcome labels', async () => {
  const parse = vi.fn().mockResolvedValue({ parsed_output: { untouched: true } });
  const client = formatReminderClient({ parse } as unknown as ClaudeClient);
  const params = {
    model: 'claude-sonnet-5-5',
    max_tokens: 100,
    system: 'frozen-v4-rubric',
    messages: [{ role: 'user' as const, content: 'original transcript' }],
  };
  const response = await client.parse(params);
  expect(parse).toHaveBeenCalledWith(
    {
      ...params,
      messages: [
        ...params.messages,
        { role: 'user', content: expect.stringContaining('outcome.label must be exactly one of') },
      ],
    },
    undefined,
  );
  expect(response).toEqual({ parsed_output: { untouched: true } });
  expect(params.messages).toHaveLength(1);
});

it('focused rejudging selects entire task families across both arms and all repetitions without mutating originals', () => {
  const rows = ['t1', 't2'].flatMap((taskId) =>
    ['a', 'b'].flatMap((config) => [1, 2, 3].map((rep) => ({ taskId, config, rep }))),
  );
  const before = structuredClone(rows),
    tasks = [
      { id: 't1', key: 'availability' },
      { id: 't2', key: 'unrelated' },
    ];
  const focused = selectReplayScope(rows, tasks, ['availability']);
  expect(focused.taskIds).toEqual(['t1']);
  expect(focused.rows).toHaveLength(6);
  expect(new Set(focused.rows.map((r) => r.config))).toEqual(new Set(['a', 'b']));
  expect(new Set(focused.rows.map((r) => r.rep))).toEqual(new Set([1, 2, 3]));
  expect(selectReplayScope(rows, tasks, null).rows).toEqual(rows);
  expect(() => selectReplayScope(rows, tasks, ['unknown'])).toThrow();
  expect(() => selectReplayScope(rows, tasks, [])).toThrow();
  expect(rows).toEqual(before);
});

it('never copies a source call ledger into a replay that charges only new grading', () => {
  const source = {
    gradingUsage: [
      {
        id: 'old-call',
        component: 'judge',
        model: 'm',
        inputTokens: 100,
        outputTokens: 0,
        costUsd: 1,
      },
    ],
    context: {},
    judgeCostUsd: 1,
  } as unknown as Parameters<typeof replayRow>[0];
  const judge = { model: 'm', usage: { costUsd: 0.2 } } as Parameters<typeof replayRow>[2];
  const score = { passed: true, score: 100 } as Parameters<typeof replayRow>[3];
  expect(replayRow(source, 'replay', judge, score).gradingUsage).toBeNull();
  expect(replayRow(source, 'replay', judge, score).judgeCostUsd).toBe(0.2);
  expect(source.gradingUsage).toHaveLength(1);
});
