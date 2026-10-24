import type { JudgeReport, TurnJudgment } from '@evals/shared';
import { improvementSummary, type LabelledRun } from './labels.js';

const ok = { pass: true, quote: '', reason: '', verified: true };
const turn = (eventSeq: number, issues: TurnJudgment['issues'] = []): TurnJudgment => ({
  eventSeq,
  audience: ok,
  format: ok,
  grounded: ok,
  act: 'informs',
  issues,
});
const report = (overrides: Partial<JudgeReport>): JudgeReport => ({
  model: 'm',
  turns: [],
  leadTurns: [],
  questions: [],
  outcome: { label: 'booked', reason: '' },
  leadConsistent: { ok: true, reason: '' },
  firstProblemSeq: null,
  replyQuality: 1,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  ...overrides,
});
const operator = { label: 'writes_to_operator' as const, quote: 'Reply to Jamie:', reason: '' };

describe('improvementSummary', () => {
  const runs: LabelledRun[] = [
    {
      runId: 'a1',
      taskKey: 'minor',
      side: 'a',
      judge: report({
        leadTurns: [{ eventSeq: 1, intent: 'wants_to_book', mood: 'calm' }],
        turns: [turn(3, [operator]), turn(6)],
        outcome: { label: 'booked', reason: '' },
      }),
    },
    {
      runId: 'b1',
      taskKey: 'minor',
      side: 'b',
      judge: report({
        leadTurns: [
          { eventSeq: 1, intent: 'wants_to_book', mood: 'calm' },
          { eventSeq: 5, intent: 'pushes_back', mood: 'impatient' },
        ],
        turns: [turn(3), turn(7)],
        outcome: { label: 'waiting_on_lead', reason: '' },
        leadConsistent: { ok: false, reason: 'Changed their age.' },
      }),
    },
    { runId: 'b2', taskKey: 'stop', side: 'b', judge: null },
  ];
  const summary = improvementSummary(runs);

  it('counts problems as a share of judged replies, with a run to look at', () => {
    expect(summary.judgedRuns).toEqual({ a: 1, b: 1 });
    expect(summary.issues).toEqual([
      { label: 'writes_to_operator', a: 0.5, b: 0, countA: 1, countB: 0, exampleRunId: 'a1' },
    ]);
  });

  it('measures how cleanly the agent answers each kind of lead message', () => {
    expect(summary.intents).toEqual([
      { intent: 'wants_to_book', countA: 1, countB: 1, handledA: 0, handledB: 1 },
      { intent: 'pushes_back', countA: 0, countB: 1, handledA: null, handledB: 1 },
    ]);
  });

  it('counts outcomes and flags runs where the simulated lead broke character', () => {
    expect(summary.outcomes).toEqual([
      { label: 'booked', a: 1, b: 0 },
      { label: 'waiting_on_lead', a: 0, b: 1 },
    ]);
    expect(summary.leadProblems).toEqual([
      { runId: 'b1', taskKey: 'minor', side: 'b', reason: 'Changed their age.' },
    ]);
  });
});
