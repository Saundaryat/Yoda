import type { JudgeReport, RunEvent, TaskDefinition } from '@evals/shared';
import type { Judge } from '../src/scoring/judge.js';

/** Test fixture only: no model calls. Rule checks still decide the fake Hermes outcomes. */
export function fakeJudge(): Judge {
  return {
    judge: async (task: TaskDefinition, events: RunEvent[]): Promise<JudgeReport> => {
      const verdict = { pass: true, quote: '', reason: 'Offline test fixture', verified: true };
      return {
        evaluatorVersion: 'test-only',
        model: 'test-only',
        turns: events
          .filter((e) => e.kind === 'agent')
          .map((e) => ({
            eventSeq: e.seq,
            audience: verdict,
            format: verdict,
            grounded: verdict,
            act: 'informs',
            issues: [],
          })),
        leadTurns: events
          .filter((e) => e.kind === 'lead')
          .map((e) => ({ eventSeq: e.seq, intent: 'other', mood: 'calm' })),
        questions: task.checks
          .filter((c) => c.type === 'llm_judge')
          .map((c) => ({
            checkId: c.id,
            answer: 'yes',
            quote: '',
            reason: 'Offline test fixture',
          })),
        outcome: { label: 'unresolved', reason: 'Offline test fixture' },
        leadConsistent: { ok: true, reason: '' },
        firstProblemSeq: null,
        replyQuality: 1,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    },
  } as unknown as Judge;
}
