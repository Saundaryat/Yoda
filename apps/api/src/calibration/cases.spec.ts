import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JudgeReport } from '@evals/shared';
import { readTaskFiles } from '../suites/task-files.js';
import { scoreRun } from '../scoring/checks.js';
import { buildCalibrationCases } from './cases.js';

const root = new URL('../../../../', import.meta.url);
const cases = buildCalibrationCases(
  readTaskFiles(fileURLToPath(new URL('suites', root))),
  readFileSync(new URL('skills/clinic-policy/SKILL.md', root), 'utf8'),
);

describe('all 20 scenario oracles', () => {
  // These labels test mechanical assertions and aggregation. The separate live calibration
  // command tests Claude/Jev against these same labels without exposing the labels to the model.
  it.each(cases)('$id matches its authored label', (fixture) => {
    const lastReply = fixture.events.filter((e) => e.kind === 'agent').at(-1)!;
    const good = { pass: true, quote: '', reason: 'Calibration oracle', verified: true };
    const judge: JudgeReport = {
      model: 'label-oracle',
      turns: fixture.events
        .filter((e) => e.kind === 'agent')
        .map((event) => ({
          eventSeq: event.seq,
          audience: good,
          format: good,
          grounded:
            event.seq === lastReply.seq && fixture.expectedFailedChecks.includes('reply-grounded')
              ? {
                  pass: false,
                  quote: event.text,
                  reason: 'Planted unsupported claim',
                  verified: true,
                  severity: {
                    label: 'serious',
                    model: 'label-oracle',
                    confidence: 1,
                    probabilities: { minor: 0, serious: 1 },
                  },
                }
              : good,
          act: 'informs',
          issues: [],
        })),
      leadTurns: [],
      questions: fixture.task.checks.flatMap((c) =>
        c.type === 'llm_judge'
          ? [
              {
                checkId: c.id,
                answer: fixture.expectedFailedChecks.includes(c.id)
                  ? ('no' as const)
                  : ('yes' as const),
                quote: '',
                reason: 'Authored calibration label',
              },
            ]
          : [],
      ),
      outcome: { label: 'unresolved', reason: '' },
      leadConsistent: { ok: true, reason: '' },
      firstProblemSeq: null,
      replyQuality: 1,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
    const score = scoreRun(fixture.task, fixture.events, fixture.after, {
      judge,
      crmInitial: fixture.before,
    });
    expect(score.passed).toBe(fixture.expectedPass);
    const failed = score.checks
      .filter((c) => !c.passed && !c.informational && !c.skipped)
      .map((c) => c.checkId);
    for (const checkId of fixture.expectedFailedChecks) expect(failed).toContain(checkId);
    if (fixture.expectedPass) expect(failed).toEqual([]);
  });
});
