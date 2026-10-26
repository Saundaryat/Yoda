import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
  BadRequestException,
} from '@nestjs/common';
import type { ConfigurationSpec, ProgressEvent, TaskDefinition } from '@evals/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { loadConfig } from '../config.js';
import { DB, type Db } from '../db/db.module.js';
import { checkResults, configurations, experiments, runEvents, runs, tasks } from '../db/schema.js';
import { SkillsService } from '../skills/skills.service.js';
import { InfraError } from './hermes-cli.js';
import type { GradingCallUsage } from '../scoring/grading-usage.js';
import { Judge } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';
import { claudeClient } from './anthropic.js';
import {
  executeConversation,
  gradeConversation,
  type RunConversation,
  type ExecutorSettings,
  type RunOutcome,
} from './run-executor.js';
import { assertNotCancelled } from './cancellation.js';
import type { ExecutionSnapshot } from './execution-snapshot.js';
import { EVALUATOR_VERSION } from '../scoring/judge.js';
import { COMPARISON_VERSION } from '../analysis/statistics.js';

type RunRow = typeof runs.$inferSelect;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Seconds to wait before retrying an attempt that failed for infrastructure reasons. */
export function backoffSeconds(kind: InfraError['kind'], attempt: number): number {
  return kind === 'rate_limit' ? 30 * 2 ** (attempt - 1) : 10;
}

/**
 * The worker. Runs live in Postgres; this claims queued ones (FOR UPDATE SKIP LOCKED, so several
 * claims cannot double-apply work), executes with bounded concurrency and records the outcome.
 * Execution retries start fresh; grading retries reuse the durable conversation checkpoint.
 */
@Injectable()
export class RunQueueService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RunQueueService.name);
  private readonly config = loadConfig();
  private readonly active = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private filling?: Promise<void>;
  private readonly jobs = new Map<string, Promise<void>>();
  /** Overridable in tests (fake Hermes, tiny timeouts, no backoff). */
  settings: ExecutorSettings;
  backoffScale = 1;
  persistenceRetryMs = 1_000;
  readonly progress = new Subject<ProgressEvent>();

  constructor(
    @Inject(DB) private readonly db: Db,
    skills: SkillsService,
  ) {
    this.settings = {
      hermesBin: this.config.HERMES_BIN,
      runsDir: this.config.RUNS_DIR,
      turnTimeoutMs: this.config.TURN_TIMEOUT_MS,
      runBudgetSeconds: this.config.RUN_BUDGET_SECONDS,
      providerKeys: {
        OPENAI_API_KEY: this.config.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: this.config.ANTHROPIC_API_KEY,
      },
      skillContent: (name) => skills.get(name)?.content,
      leadClient: this.config.ANTHROPIC_API_KEY
        ? claudeClient(this.config.ANTHROPIC_API_KEY)
        : null,
      leadModel: this.config.LEAD_MODEL,
      judge: this.config.ANTHROPIC_API_KEY
        ? new Judge(
            claudeClient(this.config.ANTHROPIC_API_KEY),
            this.config.JUDGE_MODEL,
            this.config.TYPESAFE_API_KEY
              ? new GroundingSeverityClassifier(
                  typeSafeClient(this.config.TYPESAFE_API_KEY),
                  this.config.JEV_MODEL,
                )
              : null,
          )
        : null,
    };
  }

  snapshot(configs: (typeof configurations.$inferSelect)[]): ExecutionSnapshot {
    return {
      version: 1,
      evaluatorVersion: EVALUATOR_VERSION,
      comparisonVersion: COMPARISON_VERSION,
      judgeEnabled: this.settings.judge !== null,
      judgeModel: this.settings.judge?.model ?? null,
      classifierModel: this.config.TYPESAFE_API_KEY ? this.config.JEV_MODEL : null,
      leadModel: this.settings.leadModel,
      turnTimeoutMs: this.settings.turnTimeoutMs,
      runBudgetSeconds: this.settings.runBudgetSeconds,
      configurations: Object.fromEntries(
        configs.map((config) => {
          const spec = config.spec as ConfigurationSpec;
          const skills =
            config.skillContents ??
            Object.fromEntries(
              spec.skills.map((name) => {
                const content = this.settings.skillContent(name);
                if (!content)
                  throw new BadRequestException(`Skill ${name} is missing from the library`);
                return [name, content];
              }),
            );
          return [config.id, { spec, skills }];
        }),
      ),
    };
  }

  validateSnapshot(snapshot: ExecutionSnapshot | null): asserts snapshot is ExecutionSnapshot {
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      snapshot.evaluatorVersion !== EVALUATOR_VERSION ||
      snapshot.comparisonVersion !== COMPARISON_VERSION ||
      snapshot.judgeEnabled !== (this.settings.judge !== null) ||
      snapshot.judgeModel !== (this.settings.judge?.model ?? null) ||
      snapshot.classifierModel !== (this.config.TYPESAFE_API_KEY ? this.config.JEV_MODEL : null)
    ) {
      throw new InfraError(
        'account',
        'Frozen evaluator settings are unavailable; restore the original runtime or create a new experiment. Historical evidence can be explicitly regraded.',
      );
    }
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Cancellation is terminal, including work interrupted between cancel and process cleanup.
      await tx.execute(sql`update runs r set status = 'cancelled', finished_at = now()
        from experiments e where e.id = r.experiment_id and e.status in ('cancelled', 'finished')
        and r.status in ('queued', 'running')`);
      await tx.execute(sql`update runs r set status = 'queued'
        from experiments e where e.id = r.experiment_id and e.status = 'running' and r.status = 'running'`);
    });
    await this.reconcile();
  }

  /** Repair interrupted parent transitions during startup and every poll, without replaying work. */
  private async reconcile(): Promise<void> {
    const parents = await this.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(eq(experiments.status, 'running'));
    for (const parent of parents) {
      await this.db.transaction(async (tx) => {
        await tx.select().from(experiments).where(eq(experiments.id, parent.id)).for('update');
        // Only this process owns runs (one API worker per schema). A lost owner must not strand work.
        const owned = [...this.active.keys()];
        await tx
          .update(runs)
          .set({ status: 'queued' })
          .where(
            and(
              eq(runs.experimentId, parent.id),
              eq(runs.status, 'running'),
              owned.length ? notInArray(runs.id, owned) : undefined,
            ),
          );
      });
      await this.persist(() => this.afterRun(parent.id));
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();
    this.timer = setInterval(() => this.kick(), 1_000);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
    await this.filling;
    // Keep the DB pool alive until cancelled work has checkpointed and cleaned up its credentials.
    await Promise.allSettled(this.jobs.values());
  }

  abort(runIds: string[]): void {
    for (const id of runIds) this.active.get(id)?.abort();
  }

  /** A single fill operation owns capacity while awaiting database claims. */
  fill(): Promise<void> {
    if (!this.filling)
      this.filling = this.fillAvailable().finally(() => {
        this.filling = undefined;
      });
    return this.filling;
  }

  /** Request background admission without allowing a transient DB failure to reject the HTTP action. */
  kick(): void {
    void this.fill().catch((error) => this.logger.error(error));
  }

  private async fillAvailable(): Promise<void> {
    await this.reconcile();
    while (!this.stopping && this.active.size < this.config.RUN_CONCURRENCY) {
      const run = await this.claim();
      if (!run) return;
      const controller = new AbortController();
      this.active.set(run.id, controller);
      if (this.stopping) controller.abort();
      this.emit(run.experimentId, run.id, 'running');
      const job = this.process(run, controller.signal)
        .catch((error) => this.logger.error(error))
        .finally(() => {
          this.active.delete(run.id);
          this.jobs.delete(run.id);
        });
      this.jobs.set(run.id, job);
    }
  }

  /** Resolves once nothing is running or queued for `experimentId` (used by tests and the CLI). */
  async drain(experimentId: string): Promise<void> {
    for (;;) {
      await this.fill();
      const [{ open }] = (await this.db
        .select({ open: sql<number>`count(*)::int` })
        .from(runs)
        .where(
          and(eq(runs.experimentId, experimentId), inArray(runs.status, ['queued', 'running'])),
        )) as [{ open: number }];
      if (open === 0) {
        // The last outcome commits before its parent is finalized. Await that transition too.
        await this.afterRun(experimentId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async claim(): Promise<RunRow | undefined> {
    return this.db.transaction(async (tx) => {
      // All lifecycle operations lock the parent first: a claim cannot escape cancellation.
      const parents = await tx.execute<{ id: string }>(sql`select e.id from experiments e
        where e.status = 'running' and exists(select 1 from runs r
          where r.experiment_id = e.id and r.status = 'queued' and r.available_at <= now())
        order by e.created_at limit 1 for update of e skip locked`);
      const parent = parents.rows[0];
      if (!parent) return undefined;
      // Admission is checked under the same parent lock as retries, checkpoints and outcomes.
      if (await this.enforceBudget(tx, parent.id)) return undefined;
      const result = await tx.execute<{ id: string }>(sql`
        update runs set status = 'running', attempts = attempts + 1,
          phase_attempts = phase_attempts + 1, started_at = coalesce(started_at, now())
        where id = (select id from runs where experiment_id = ${parent.id}
          and status = 'queued' and available_at <= now() order by position
          limit 1 for update skip locked) returning id`);
      const id = result.rows[0]?.id;
      if (!id) return undefined;
      const [run] = await tx.select().from(runs).where(eq(runs.id, id));
      return run;
    });
  }

  private async process(run: RunRow, signal: AbortSignal): Promise<void> {
    const usageWrites = new Set<Promise<void>>();
    try {
      const [task] = await this.db.select().from(tasks).where(eq(tasks.id, run.taskId));
      const [experiment] = await this.db
        .select()
        .from(experiments)
        .where(eq(experiments.id, run.experimentId));
      if (experiment!.status !== 'running')
        throw new InfraError('cancelled', 'Experiment cancelled');
      const snapshot = experiment!.executionSnapshot;
      this.validateSnapshot(snapshot);
      const configuration = snapshot.configurations[run.configId];
      if (!configuration) throw new InfraError('account', 'Frozen configuration is unavailable');
      const settings = {
        ...this.settings,
        leadModel: snapshot.leadModel,
        turnTimeoutMs: snapshot.turnTimeoutMs,
        runBudgetSeconds: snapshot.runBudgetSeconds,
        gradingAccounting: {
          beforeCall: async () => {
            await this.admitGrading(run);
            assertNotCancelled(signal);
          },
          record: (usage: GradingCallUsage) => {
            const write = this.persist(() => this.saveGradingUsage(run, usage));
            usageWrites.add(write);
            void write.then(
              () => usageWrites.delete(write),
              () => usageWrites.delete(write),
            );
            return write;
          },
        },
      };
      let conversation = run.conversation;
      if (!conversation) {
        conversation = await executeConversation(
          {
            runId: run.id,
            attempt: run.attempts,
            task: task!.definition as TaskDefinition,
            spec: configuration.spec,
            skillContents: configuration.skills,
            leadMode: experiment!.leadMode,
            signal,
          },
          settings,
        );
        assertNotCancelled(signal);
        await this.persist(() => this.saveConversation(run, conversation!));
        run.phaseAttempts = 1;
        run.conversation = conversation;
      }
      assertNotCancelled(signal);
      await this.admitGrading(run);
      const outcome = await gradeConversation(
        task!.definition as TaskDefinition,
        conversation,
        settings,
        signal,
      );
      assertNotCancelled(signal);
      await this.persist(() => this.saveOutcome(run, outcome));
      this.emit(run.experimentId, run.id, 'scored');
    } catch (error) {
      const failure = signal.aborted
        ? new InfraError('cancelled', 'Run cancelled')
        : error instanceof InfraError
          ? error
          : new InfraError('crash', error instanceof Error ? error.message : String(error));
      if (!(error instanceof InfraError) && !signal.aborted) this.logger.error(error);
      await this.persist(() => this.saveFailure(run, failure));
    } finally {
      // Cancellation may settle a model wrapper while a returned usage write is still pending.
      // Keep the owner (and DB pool on shutdown) until those writes are durable too.
      await Promise.allSettled(usageWrites);
      rmSync(join(this.settings.runsDir, run.id, `attempt-${run.attempts}`, 'home', '.env'), {
        force: true,
      });
    }
    await this.persist(() => this.afterRun(run.experimentId));
  }

  /** Keep ownership and the in-memory result until persistence succeeds, including ambiguous commits.
   * Never rerun paid execution/grading because a database write failed. Shutdown waits for this owner;
   * a forced process exit is recovered from the last durable checkpoint on the next startup.
   */
  private async persist(write: () => Promise<void>): Promise<void> {
    for (;;) {
      try {
        await write();
        return;
      } catch (error) {
        if (error instanceof InfraError) throw error;
        this.logger.error('Persistence failed; retaining run ownership and retrying', error);
        await new Promise((resolve) => setTimeout(resolve, this.persistenceRetryMs));
      }
    }
  }

  private async lockRunning(tx: Transaction, run: RunRow) {
    const [parent] = await tx
      .select()
      .from(experiments)
      .where(eq(experiments.id, run.experimentId))
      .for('update');
    if (parent?.status !== 'running') throw new InfraError('cancelled', 'Experiment cancelled');
  }

  private async saveConversation(run: RunRow, conversation: RunConversation): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRunning(tx, run);
      const [saved] = await tx.select().from(runs).where(eq(runs.id, run.id));
      if (saved?.conversation) return; // Retried after a commit whose acknowledgement was lost.
      await tx
        .update(runs)
        .set({
          conversation,
          phaseAttempts: 1,
          inputTokens: conversation.inputTokens,
          outputTokens: conversation.outputTokens,
          costUsd: conversation.costUsd,
          costStatus: conversation.costStatus,
          leadCostUsd: conversation.leadUsage?.costUsd ?? null,
          durationMs: conversation.durationMs,
          sessionIds: conversation.sessionIds,
          crmInitial: conversation.crmInitial,
          crmFinal: conversation.crmFinal,
          context: { ...conversation.context, lead: conversation.leadUsage },
          leadFallbacks: conversation.leadFallbacks,
        })
        .where(eq(runs.id, run.id));
      if (conversation.events.length)
        await tx.insert(runEvents).values(
          conversation.events.map((event) => ({
            runId: run.id,
            seq: event.seq,
            session: event.session,
            turn: event.turn,
            kind: event.kind,
            payload: event,
          })),
        );
    });
    // The checkpoint is independent of the run home; judging never needs the provider credential.
    rmSync(join(this.settings.runsDir, run.id, `attempt-${run.attempts}`, 'home', '.env'), {
      force: true,
    });
  }

  private async admitGrading(run: RunRow): Promise<void> {
    await this.persist(async () => {
      await this.db.transaction(async (tx) => {
        await this.lockRunning(tx, run);
        if (await this.budgetReached(tx, run.experimentId))
          throw new InfraError(
            'cost_cap',
            'Experiment spend has reached its cost cap before grading',
          );
      });
    });
  }

  /** Record even after cancellation: the provider already returned billable work. Never reopen the run. */
  private async saveGradingUsage(run: RunRow, usage: GradingCallUsage): Promise<void> {
    const status = await this.db.transaction(async (tx) => {
      await tx.select().from(experiments).where(eq(experiments.id, run.experimentId)).for('update');
      const [saved] = await tx.select().from(runs).where(eq(runs.id, run.id));
      if (!saved) throw new InfraError('account', 'Cannot record usage for a missing run');
      const entries: GradingCallUsage[] =
        saved.gradingUsage ??
        (saved.judgeCostUsd === null
          ? []
          : [
              {
                id: 'legacy',
                component: 'legacy',
                model: 'unrecorded',
                inputTokens: null,
                outputTokens: null,
                costUsd: saved.judgeCostUsd,
              },
            ]);
      if (entries.some((entry) => entry.id === usage.id)) return saved.status;
      const gradingUsage = [...entries, { ...usage, attempt: run.attempts }];
      await tx
        .update(runs)
        .set({
          gradingUsage,
          // Keep every known component in admission totals; unknown components remain explicit in the ledger.
          judgeCostUsd: gradingUsage.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
        })
        .where(eq(runs.id, run.id));
      return saved.status;
    });
    // Returned usage can finish persisting after a cancel event. Invalidate cost views too.
    this.emit(run.experimentId, run.id, status);
  }

  private async saveOutcome(run: RunRow, outcome: RunOutcome): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRunning(tx, run);
      const [saved] = await tx.select().from(runs).where(eq(runs.id, run.id));
      await tx
        .update(runs)
        .set({
          status: 'scored',
          passed: outcome.passed,
          score: outcome.score,
          judge: outcome.judge,
          judgeCostUsd: saved?.gradingUsage
            ? saved.judgeCostUsd
            : (outcome.judge?.usage.costUsd ?? null),
          durationMs: outcome.durationMs,
          errorKind: null,
          errorDetail: null,
          finishedAt: new Date(),
        })
        .where(and(eq(runs.id, run.id), eq(runs.status, 'running')));
      await tx.delete(checkResults).where(eq(checkResults.runId, run.id));
      await tx
        .insert(checkResults)
        .values(outcome.checks.map((check) => ({ runId: run.id, ...check })));
    });
  }

  private async saveFailure(run: RunRow, failure: InfraError): Promise<void> {
    let status: 'queued' | 'cancelled' | 'error' = 'error';
    await this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(experiments)
        .where(eq(experiments.id, run.experimentId))
        .for('update');
      const [saved] = await tx.select().from(runs).where(eq(runs.id, run.id));
      if (saved?.status !== 'running') return; // Idempotent after an ambiguous commit.
      const log = [
        ...(saved.attemptLog as unknown[]),
        {
          attempt: run.attempts,
          phase: run.conversation ? 'grading' : 'execution',
          kind: failure.kind,
          detail: failure.message,
          at: new Date(),
        },
      ];
      if (parent?.status === 'running' && failure.kind === 'cancelled' && this.stopping) {
        // Stopping the API pauses work; only an explicit experiment cancellation is terminal.
        status = 'queued';
        await tx
          .update(runs)
          .set({
            status,
            phaseAttempts: Math.max(0, run.phaseAttempts - 1),
            availableAt: new Date(),
          })
          .where(and(eq(runs.id, run.id), eq(runs.status, 'running')));
      } else if (parent?.status !== 'running' || failure.kind === 'cancelled') {
        status = 'cancelled';
        await tx
          .update(runs)
          .set({ status, finishedAt: new Date() })
          .where(and(eq(runs.id, run.id), inArray(runs.status, ['running', 'queued'])));
      } else if (failure.retryable && run.phaseAttempts < this.config.MAX_ATTEMPTS) {
        status = 'queued';
        const wait = backoffSeconds(failure.kind, run.phaseAttempts) * this.backoffScale;
        await tx
          .update(runs)
          .set({
            status,
            attemptLog: log,
            availableAt: sql`now() + make_interval(secs => ${wait})`,
          })
          .where(eq(runs.id, run.id));
      } else {
        await tx
          .update(runs)
          .set({
            status: 'error',
            errorKind: failure.kind,
            errorDetail: failure.message,
            attemptLog: log,
            finishedAt: new Date(),
          })
          .where(eq(runs.id, run.id));
        if (!failure.retryable)
          await tx
            .update(runs)
            .set({
              status: 'error',
              errorKind: failure.kind,
              errorDetail: `Not run: ${failure.message}`,
              finishedAt: new Date(),
            })
            .where(and(eq(runs.experimentId, run.experimentId), eq(runs.status, 'queued')));
      }
    });
    this.emit(run.experimentId, run.id, status);
  }

  /** Enforce the cap and close the parent under the same lifecycle lock as start/cancel. */
  private async afterRun(experimentId: string): Promise<void> {
    const closed = await this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(experiments)
        .where(eq(experiments.id, experimentId))
        .for('update');
      if (parent?.status !== 'running') return false;
      await this.enforceBudget(tx, experimentId);
      const [remaining] = await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(runs)
        .where(
          and(eq(runs.experimentId, experimentId), inArray(runs.status, ['queued', 'running'])),
        );
      if (remaining!.open > 0) return false;
      await tx
        .update(experiments)
        .set({ status: 'finished', finishedAt: new Date() })
        .where(eq(experiments.id, experimentId));
      return true;
    });
    if (closed) this.emit(experimentId, null, 'finished');
  }

  /** Caller holds the experiment row lock. All admission paths share this spend calculation. */
  async budgetReached(tx: Transaction, experimentId: string): Promise<boolean> {
    return (await this.spend(tx, experimentId)) >= this.config.MAX_EXPERIMENT_COST_USD;
  }

  private async spend(tx: Transaction, experimentId: string): Promise<number> {
    const [stats] = await tx
      .select({
        cost: sql<number>`coalesce(sum(coalesce(cost_usd, 0) + coalesce(lead_cost_usd, 0) + coalesce(judge_cost_usd, 0)), 0)::float`,
      })
      .from(runs)
      .where(eq(runs.experimentId, experimentId));
    return stats!.cost;
  }

  private async enforceBudget(tx: Transaction, experimentId: string): Promise<boolean> {
    const cost = await this.spend(tx, experimentId);
    if (cost < this.config.MAX_EXPERIMENT_COST_USD) return false;
    await tx
      .update(runs)
      .set({
        status: 'error',
        errorKind: 'cost_cap',
        errorDetail: `Not run: spend reached $${cost.toFixed(2)} (cap $${this.config.MAX_EXPERIMENT_COST_USD})`,
        finishedAt: new Date(),
      })
      .where(and(eq(runs.experimentId, experimentId), eq(runs.status, 'queued')));
    return true;
  }

  private emit(experimentId: string, runId: string | null, status: ProgressEvent['status']) {
    this.progress.next({ experimentId, runId, status });
  }
}
