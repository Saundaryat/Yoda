import { describe, expect, it } from 'vitest';
import { costBreakdown } from './cost-breakdown.js';

const experiment = { id: 'experiment', name: 'Comparison', baselineConfigId: 'a' };
const run = {
  configId: 'a',
  attempts: 1,
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 1,
  costStatus: 'estimated',
  leadCostUsd: 0.2,
  judgeCostUsd: 0.53,
  context: {
    model: 'agent',
    lead: { model: 'customer', calls: 1, inputTokens: 100, outputTokens: 10 },
  },
  judge: {
    model: 'judge',
    usage: { inputTokens: 300, outputTokens: 30, costUsd: 0.53 },
    groundingReview: { model: 'reviewer', inputTokens: 100, outputTokens: 10, costUsd: 0.1 },
    groundingClassifier: { model: 'jev', inputTokens: 50, outputTokens: 1, costUsd: 0.03 },
  },
};

describe('saved cost breakdown', () => {
  it('splits the combined grading estimate without counting reviewer or Jev twice', () => {
    const result = costBreakdown(experiment, [run]);
    expect(result.rows.map((r) => [r.label, r.estimatedCostUsd])).toEqual([
      ['Agent A', 1],
      ['Customer', 0.2],
      ['Claude judge', 0.4],
      ['Evidence reviewer', 0.1],
      ['Jev', 0.03],
    ]);
    expect(result.estimatedCostUsd).toBeCloseTo(1.73);
  });
  it('omits scripted customers and unused reviewer/classifier components', () => {
    const result = costBreakdown(experiment, [
      {
        ...run,
        leadCostUsd: null,
        context: { model: 'agent' },
        judge: { ...run.judge, groundingReview: null, groundingClassifier: null },
      },
    ]);
    expect(result.rows.map((r) => r.label)).toEqual(['Agent A', 'Claude judge']);
  });
  it('marks unavailable estimates and reports retry coverage', () => {
    const result = costBreakdown(experiment, [
      { ...run, costUsd: null, costStatus: 'unknown', attempts: 2 },
    ]);
    expect(result.rows[0]?.unknownEstimates).toBe(1);
    expect(result.unknownEstimates).toBe(1);
    expect(result.estimatedCostUsd).toBeCloseTo(0.73);
    expect(result.retriedRuns).toBe(1);
  });
  it('does not charge copied conversations or inherited judgments in score-only replays', () => {
    const result = costBreakdown(experiment, [
      {
        ...run,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        leadCostUsd: 0,
        judgeCostUsd: 0,
        context: { ...run.context, rescoring: { mode: 'score-only' } },
      },
    ]);
    expect(result.rows).toEqual([]);
    expect(result.estimatedCostUsd).toBe(0);
  });
  it('keeps a known total unitemized when the saved grading split is incomplete', () => {
    const result = costBreakdown(experiment, [
      {
        ...run,
        judge: {
          ...run.judge,
          groundingClassifier: { ...run.judge.groundingClassifier, costUsd: null },
        },
      },
    ]);
    expect(result.rows.map((r) => r.label)).toEqual(['Agent A', 'Customer', 'Grading']);
    expect(result.estimatedCostUsd).toBeCloseTo(1.73);
  });
});

it('counts all grading attempts from the call ledger without double charging the final report', () => {
  const result = costBreakdown(experiment, [
    {
      ...run,
      gradingUsage: [
        {
          id: 'first',
          component: 'judge',
          model: 'judge',
          inputTokens: 100,
          outputTokens: 0,
          costUsd: 0.2,
        },
        {
          id: 'second',
          component: 'judge',
          model: 'judge',
          inputTokens: 100,
          outputTokens: 0,
          costUsd: 0.2,
        },
        {
          id: 'review',
          component: 'review',
          model: 'reviewer',
          inputTokens: 50,
          outputTokens: 0,
          costUsd: 0.1,
        },
      ],
    },
  ]);
  expect(result.rows.find((row) => row.label === 'Claude judge')).toMatchObject({
    runs: 1,
    estimatedCostUsd: 0.4,
  });
  expect(result.rows.find((row) => row.label === 'Evidence reviewer')?.estimatedCostUsd).toBe(0.1);
  expect(result.rows.some((row) => row.label === 'Jev')).toBe(false);
  expect(result.estimatedCostUsd).toBeCloseTo(1.7);
});
it('retains known ledger estimates while marking unavailable components', () => {
  const result = costBreakdown(experiment, [
    {
      ...run,
      judge: null,
      gradingUsage: [
        {
          id: 'known',
          component: 'judge',
          model: 'm',
          inputTokens: 100,
          outputTokens: 0,
          costUsd: 0.2,
        },
        {
          id: 'unknown',
          component: 'judge',
          model: 'm',
          inputTokens: 100,
          outputTokens: 0,
          costUsd: null,
        },
      ],
    },
  ]);
  expect(result.rows.find((row) => row.label === 'Claude judge')).toMatchObject({
    runs: 1,
    estimatedCostUsd: 0.2,
    unknownEstimates: 1,
  });
  expect(result.estimatedCostUsd).toBeCloseTo(1.4);
});
