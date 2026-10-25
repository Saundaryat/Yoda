import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { claudeClient } from '../runner/anthropic.js';
import { Judge, JUDGE_RUBRIC } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';
import { scoreRun } from '../scoring/checks.js';
import { readTaskFiles } from '../suites/task-files.js';
import { buildCalibrationCases, buildCalibrationHoldouts, CALIBRATION_TODAY } from './cases.js';

/** Deliberately separate from experiments: calibration uses reference traces, not Hermes output. */
async function main() {
  if (!process.argv.includes('--live'))
    throw new Error('Explicit --live required (uses paid judge and Jev APIs)');
  const key = process.env.ANTHROPIC_API_KEY;
  const jevKey = process.env.TYPESAFE_API_KEY;
  if (!key || !jevKey) throw new Error('ANTHROPIC_API_KEY and TYPESAFE_API_KEY are required');
  const outIndex = process.argv.indexOf('--out');
  const output = resolve(
    outIndex >= 0 ? process.argv[outIndex + 1]! : 'docs/calibration/latest.json',
  );
  const files = readTaskFiles(resolve('suites'));
  const policy = readFileSync(resolve('skills/clinic-policy/SKILL.md'), 'utf8');
  const references = buildCalibrationCases(files, policy);
  const fixtures = [...references, ...buildCalibrationHoldouts(references)];
  const classifier = new GroundingSeverityClassifier(
    typeSafeClient(jevKey),
    process.env.JEV_MODEL ?? 'jev-1.14.0',
  );
  const judge = new Judge(
    claudeClient(key),
    process.env.JUDGE_MODEL ?? 'claude-sonnet-5-5',
    classifier,
  );
  const records: unknown[] = [];
  let cursor = 0;
  let costUsd = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < fixtures.length) {
        const fixture = fixtures[cursor++]!;
        let record;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const report = await judge.judge(fixture.task, fixture.events, CALIBRATION_TODAY);
            const score = scoreRun(fixture.task, fixture.events, fixture.after, {
              judge: report,
              crmInitial: fixture.before,
            });
            costUsd += report.usage.costUsd ?? 0;
            const failed = score.checks
              .filter((c) => !c.passed && !c.informational && !c.skipped)
              .map((c) => c.checkId);
            const matched =
              score.passed === fixture.expectedPass &&
              fixture.expectedFailedChecks.every((id) => failed.includes(id));
            record = { ...fixture, report, score, matched };
            console.log(
              JSON.stringify({
                id: fixture.id,
                matched,
                expected: fixture.expectedPass,
                passed: score.passed,
                failed,
              }),
            );
            break;
          } catch (error) {
            if (attempt === 2) {
              record = {
                ...fixture,
                matched: false,
                error: error instanceof Error ? error.message : String(error),
              };
              console.log(JSON.stringify({ id: fixture.id, error: true }));
            }
          }
        }
        records.push(record);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(
          output,
          JSON.stringify(
            {
              createdAt: new Date().toISOString(),
              judge: judge.model,
              jev: classifier.model,
              policyHash: createHash('sha256').update(policy).digest('hex'),
              rubric: JUDGE_RUBRIC,
              costUsd,
              cases: records,
            },
            null,
            2,
          ) + '\n',
        );
      }
    }),
  );
  const matched = records.filter((r) => (r as { matched: boolean }).matched).length;
  console.log(JSON.stringify({ cases: records.length, matched, costUsd, output }));
  if (matched !== records.length) process.exitCode = 1;
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
