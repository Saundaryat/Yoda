/** Saved-conversation replay. Deliberately never imports the executor or run queue. */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { asc, eq, inArray } from 'drizzle-orm';
import type {
  ConfigurationSpec,
  CrmState,
  JudgeReport,
  RunEvent,
  Score,
  TaskDefinition,
} from '@evals/shared';
import * as schema from '../db/schema.js';
import { claudeClient, type ClaudeClient } from '../runner/anthropic.js';
import { scoreRun } from '../scoring/checks.js';
import { EVALUATOR_VERSION, Judge, type GroundingAuthority } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type RunRow = typeof schema.runs.$inferSelect;
type ReplayMode = 'judge-and-score' | 'score-only';
export function selectReplayScope<T extends { taskId: string }>(
  sourceRows: T[],
  tasks: { id: string; key: string }[],
  keys: string[] | null,
) {
  if (keys && (!keys.length || keys.some((key) => !tasks.some((t) => t.key === key))))
    throw Error('Unknown or empty task scope');
  const taskIds = tasks.filter((t) => !keys || keys.includes(t.key)).map((t) => t.id);
  return { taskIds, rows: sourceRows.filter((r) => taskIds.includes(r.taskId)) };
}

/** Response-format retry only; no outcome mapping, grade changes, or alternate provider. */
export function formatReminderClient(client: ClaudeClient): ClaudeClient {
  return {
    parse: (params, options) =>
      client.parse(
        {
          ...params,
          messages: [
            ...params.messages,
            {
              role: 'user',
              content:
                'Response format reminder: outcome.label must be exactly one of booked, escalated, opted_out, waiting_on_lead, declined, unresolved. Do not invent another label. All original grading criteria remain unchanged.',
            },
          ],
        },
        options,
      ),
  };
}

export function replayRow(
  source: RunRow,
  experimentId: string,
  judge: JudgeReport,
  score: Score,
  mode: ReplayMode = 'judge-and-score',
) {
  return {
    ...source,
    id: randomUUID(),
    experimentId,
    status: 'scored' as const,
    attempts: 0,
    attemptLog: [],
    errorKind: null,
    errorDetail: null,
    passed: score.passed,
    score: score.score,
    judge,
    judgeCostUsd: mode === 'score-only' ? 0 : judge.usage.costUsd,
    // Charge only the NEW judge work, never the original agent/customer usage twice.
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    leadCostUsd: 0,
    costStatus:
      mode === 'score-only'
        ? 'reused conversation and judge; scoring-only replay'
        : 'reused conversation; judge-only replay',
    context: {
      ...(source.context as object),
      rescoring: {
        sourceRunId: source.id,
        evaluatorVersion: EVALUATOR_VERSION,
        mode,
        ...(mode === 'score-only' && {
          sourceJudgeVersion: judge.evaluatorVersion ?? 'unversioned',
        }),
      },
    },
  };
}

async function main() {
  const reuseJudge = process.argv.includes('--reuse-judge');
  const formatReminder = process.argv.includes('--format-reminder');
  const mode: ReplayMode = reuseJudge ? 'score-only' : 'judge-and-score';
  const taskKeys = process.argv.includes('--task-keys')
    ? [
        ...new Set(
          process.argv[process.argv.indexOf('--task-keys') + 1]!.split(',').filter(Boolean),
        ),
      ].sort()
    : null;
  const focused = taskKeys !== null;
  if (focused && !taskKeys.length) throw Error('Focused replay requires at least one task key');
  const sourceId = process.argv[process.argv.indexOf('--source') + 1];
  if (!process.argv.includes('--live') || !process.argv.includes('--source') || !sourceId)
    throw Error('--live --source <finished experiment id> required');
  if (
    !process.env.RESCORE_DATABASE_URL ||
    (!reuseJudge && (!process.env.ANTHROPIC_API_KEY || !process.env.TYPESAFE_API_KEY))
  )
    throw Error(
      'Explicit RESCORE_DATABASE_URL required; fresh judging also requires judge/classifier keys',
    );
  const pool = new pg.Pool({ connectionString: process.env.RESCORE_DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    const [source] = await db
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.id, sourceId));
    if (!source || source.status !== 'finished') throw Error('Source must be finished');
    if (
      !focused &&
      (source.analysis as { correctedExperimentId?: string } | null)?.correctedExperimentId
    )
      throw Error('Source already has corrected results; refusing duplicate publication');
    const sourceRows = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.experimentId, sourceId))
      .orderBy(asc(schema.runs.position));
    if (
      sourceRows.length !== source.taskIds.length * source.repetitions * 2 ||
      sourceRows.some((r) => r.status !== 'scored')
    )
      throw Error('Require complete scored source coverage');
    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, source.taskIds));
    const { taskIds: selectedTaskIds, rows } = selectReplayScope(sourceRows, tasks, taskKeys);
    const scopeKey = focused ? hash(taskKeys).slice(0, 12) : null;
    const configs = await db
      .select()
      .from(schema.configurations)
      .where(
        inArray(schema.configurations.id, [source.baselineConfigId, source.candidateConfigId]),
      );
    const protocolPath = process.argv.includes('--protocol')
      ? process.argv[process.argv.indexOf('--protocol') + 1]!
      : 'docs/experiments/2026-10-24-preloaded-protocol.json';
    const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
    const manifest = protocol.sourceManifest ?? protocol.manifest;
    if ((protocol.experimentId ?? protocol.experiment?.id) !== sourceId)
      throw Error('Historical policy protocol does not match source');
    const policy = readFileSync('skills/clinic-policy/SKILL.md', 'utf8');
    if (createHash('sha256').update(policy).digest('hex') !== manifest.policyHash)
      throw Error('Policy bytes differ from the historical frozen policy');
    const codeHash = hash(
      [
        'apps/api/src/scoring/judge.ts',
        'apps/api/src/scoring/checks.ts',
        'apps/api/src/scoring/grounding-severity.ts',
        'apps/api/src/scoring/clinical-evidence.ts',
        'apps/api/src/scoring/availability-evidence.ts',
        'apps/api/src/scoring/grounding-review.ts',
        'packages/shared/src/run.ts',
      ].map((p) => readFileSync(p, 'utf8')),
    );
    const output = `docs/experiments/${sourceId}-${EVALUATOR_VERSION}${reuseJudge ? '-score-only' : ''}${scopeKey ? `-tasks-${scopeKey}` : ''}.json`;
    type Record = {
      inputHash: string;
      report: JudgeReport;
      score: Score;
      authority: GroundingAuthority;
      formatReminder?: boolean;
    };
    const saved: {
      evaluatorVersion: string;
      mode?: ReplayMode;
      codeHash: string;
      sourceId: string;
      records: { [id: string]: Record };
      correctedExperimentId?: string;
    } = existsSync(output)
      ? JSON.parse(readFileSync(output, 'utf8'))
      : { evaluatorVersion: EVALUATOR_VERSION, mode, codeHash, sourceId, records: {} };
    if (
      saved.codeHash !== codeHash ||
      saved.sourceId !== sourceId ||
      (saved.mode ?? 'judge-and-score') !== mode
    )
      throw Error('Checkpoint evaluator/source mismatch');
    if (saved.correctedExperimentId)
      throw Error('Replay already published; refusing duplicate publication');
    const inputs = await Promise.all(
      rows.map(async (run) => {
        const events = (
          await db
            .select()
            .from(schema.runEvents)
            .where(eq(schema.runEvents.runId, run.id))
            .orderBy(asc(schema.runEvents.seq))
        ).map((r) => r.payload as RunEvent);
        const task = tasks.find((t) => t.id === run.taskId)!.definition as TaskDefinition;
        const spec = configs.find((c) => c.id === run.configId)!.spec as ConfigurationSpec;
        const pinned = [protocol.baseline, protocol.candidate].find((c) => c.id === run.configId);
        if (!pinned || hash(pinned.spec) !== hash(spec))
          throw Error('Historical configuration mismatch');
        if (reuseJudge && !run.judge)
          throw Error('Scoring-only replay requires a saved judge report');
        if (!events.length || !run.crmInitial || !run.crmFinal || !run.startedAt)
          throw Error('Missing saved evidence');
        if (spec.skills.some((s) => s !== 'clinic-policy')) throw Error('Unknown historical skill');
        const authority: GroundingAuthority = {
          instructions: spec.systemPrompt,
          preloadedPolicies:
            spec.skillMode === 'preloaded'
              ? spec.skills.map((name) => ({ name, content: policy }))
              : [],
        };
        const captured = (run.context as { groundingAuthority?: GroundingAuthority } | null)
          ?.groundingAuthority;
        if (captured && hash(captured) !== hash(authority))
          throw Error('Captured agent authority differs from historical policy/configuration');
        const inputHash = hash({
          events,
          task,
          spec,
          crmInitial: run.crmInitial,
          crmFinal: run.crmFinal,
          startedAt: run.startedAt,
          oldJudge: run.judge,
        });
        if (saved.records[run.id] && saved.records[run.id]!.inputHash !== inputHash)
          throw Error('Saved conversation changed');
        return { run, events, task, authority, inputHash };
      }),
    );
    // Save exact replay inputs independently of new outputs for audit and reproducibility.
    writeFileSync(
      output.replace('.json', '-inputs.json'),
      JSON.stringify({ sourceId, codeHash, policyHash: manifest.policyHash, inputs }, null, 2) +
        '\n',
    );
    const judge = reuseJudge
      ? null
      : new Judge(
          formatReminder
            ? formatReminderClient(claudeClient(process.env.ANTHROPIC_API_KEY!))
            : claudeClient(process.env.ANTHROPIC_API_KEY!),
          manifest.judge,
          new GroundingSeverityClassifier(
            typeSafeClient(process.env.TYPESAFE_API_KEY!),
            manifest.jev,
          ),
        );
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < inputs.length) {
          const input = inputs[cursor++]!;
          if (saved.records[input.run.id]) continue;
          let last: unknown;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const today = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                dateStyle: 'full',
              }).format(input.run.startedAt!);
              const report = reuseJudge
                ? structuredClone(input.run.judge as JudgeReport)
                : await judge!.judge(input.task, input.events, today, input.authority);
              const score = scoreRun(input.task, input.events, input.run.crmFinal as CrmState, {
                judge: report,
                crmInitial: input.run.crmInitial as CrmState,
              });
              saved.records[input.run.id] = {
                inputHash: input.inputHash,
                ...(formatReminder && { formatReminder: true }),
                authority: input.authority,
                report,
                score,
              };
              writeFileSync(output, JSON.stringify(saved, null, 2) + '\n');
              console.log(
                JSON.stringify({
                  scored: Object.keys(saved.records).length,
                  total: rows.length,
                  sourceRunId: input.run.id,
                  passed: score.passed,
                  attempt,
                }),
              );
              last = null;
              break;
            } catch (error) {
              last = error;
              console.log(
                JSON.stringify({
                  sourceRunId: input.run.id,
                  attempt,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            }
          }
          if (last) throw last;
        }
      }),
    );
    if (Object.keys(saved.records).length !== rows.length)
      throw Error('Incomplete replay; no publication');
    const correctedId = randomUUID();
    const cost = Object.values(saved.records).reduce(
      (s, r) => s + (reuseJudge ? 0 : (r.report.usage.costUsd ?? 0)),
      0,
    );
    const changes = {
      passToFail: rows.filter(
        (r) => r.passed === true && saved.records[r.id]!.score.passed === false,
      ).length,
      failToPass: rows.filter(
        (r) => r.passed === false && saved.records[r.id]!.score.passed === true,
      ).length,
      unchanged: rows.filter((r) => r.passed === saved.records[r.id]!.score.passed).length,
      ungraded: rows.filter((r) => saved.records[r.id]!.score.passed === null).length,
      scoreChanges: rows.filter((r) => r.score !== saved.records[r.id]!.score.score).length,
    };
    const sourceJudgeVersions = [
      ...new Set(
        rows.map((r) => (r.judge as JudgeReport | null)?.evaluatorVersion ?? 'unversioned'),
      ),
    ];
    await db.transaction(async (tx) => {
      // Everything is inserted atomically as FINISHED/SCORED. The Hermes queue cannot claim it.
      const [current] = await tx
        .select()
        .from(schema.experiments)
        .where(eq(schema.experiments.id, sourceId))
        .for('update');
      const currentAnalysis = (current!.analysis ?? {}) as {
        correctedExperimentId?: string;
        focusedReplays?: { scopeKey: string; codeHash: string; experimentId: string }[];
      };
      if (
        (!focused && currentAnalysis.correctedExperimentId) ||
        (focused &&
          currentAnalysis.focusedReplays?.some(
            (r) => r.scopeKey === scopeKey && r.codeHash === codeHash,
          ))
      )
        throw Error('Already published');
      await tx.insert(schema.experiments).values({
        ...source,
        id: correctedId,
        name: process.argv.includes('--name')
          ? process.argv[process.argv.indexOf('--name') + 1]!
          : `Corrected · ${source.name} · ${EVALUATOR_VERSION}`,
        status: 'finished',
        taskIds: source.taskIds.filter((id) => selectedTaskIds.includes(id)),
        hypothesis: focused
          ? `Focused evaluator regression replay of ${selectedTaskIds.length} task families under both unchanged configurations, all ${source.repetitions} saved repetitions. Task scope selected from availability/booking-intent evidence before rejudging. This measures corrected grading, not new agent behavior; the complete historical experiment is preserved.`
          : source.hypothesis,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
        analysis: {
          rescoring: {
            sourceExperimentId: sourceId,
            mode,
            sourceJudgeVersions,
            ...(focused && {
              scope: {
                kind: 'task-subset',
                taskKeys,
                tasks: selectedTaskIds.length,
                sourceTasks: source.taskIds.length,
                runs: rows.length,
                sourceRuns: sourceRows.length,
              },
            }),
            changes,
            evaluatorVersion: EVALUATOR_VERSION,
            judgeOnlyCostUsd: cost,
          },
        },
      });
      for (const input of inputs) {
        const record = saved.records[input.run.id]!;
        const newRun = replayRow(input.run, correctedId, record.report, record.score, mode);
        await tx.insert(schema.runs).values(newRun);
        await tx.insert(schema.runEvents).values(
          input.events.map((payload) => ({
            runId: newRun.id,
            seq: payload.seq,
            session: payload.session,
            turn: payload.turn,
            kind: payload.kind,
            payload,
          })),
        );
        await tx
          .insert(schema.checkResults)
          .values(record.score.checks.map((check) => ({ ...check, runId: newRun.id })));
      }
      await tx
        .update(schema.experiments)
        .set({
          analysis: focused
            ? {
                ...currentAnalysis,
                focusedReplays: [
                  ...(currentAnalysis.focusedReplays ?? []),
                  { scopeKey: scopeKey!, codeHash, experimentId: correctedId },
                ],
              }
            : { ...currentAnalysis, correctedExperimentId: correctedId },
        })
        .where(eq(schema.experiments.id, sourceId));
    });
    saved.correctedExperimentId = correctedId;
    writeFileSync(output, JSON.stringify(saved, null, 2) + '\n');
    console.log(
      JSON.stringify({
        correctedExperimentId: correctedId,
        judgeOnlyCostUsd: cost,
        mode,
        changes,
        judgeCalls: reuseJudge ? 0 : rows.length,
        hermesCalls: 0,
        customerCalls: 0,
      }),
    );
  } finally {
    await pool.end();
  }
}
if (process.argv.includes('--live'))
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
