import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import type { AgentConfiguration, TaskDefinition } from '../../packages/contracts/tasks.ts';
import type { CrmState } from '../crm-mcp/crm.ts';
import { gradeRun, graderVersion } from '../../packages/eval-engine/graders.ts';
import { runHermes } from '../../packages/hermes/runner.ts';
import { Store } from './store.ts';

export interface ExecutionResult {
  initialState: CrmState;
  finalState: CrmState;
  runtime: Record<string, unknown>;
  error: string | null;
  errorKind: 'infra_error' | 'agent_failed' | 'cancelled' | null;
}
export interface Executor {
  label: 'hermes' | 'scripted-test';
  execute(task: TaskDefinition, config: AgentConfiguration, runId: string, signal: AbortSignal,
    checkpoint: (initial: CrmState, final: CrmState, runtime: Record<string, unknown>) => Promise<void>): Promise<ExecutionResult>;
}
export const hermesExecutor: Executor = {
  label: 'hermes',
  async execute(task, configuration, runId, signal, onCheckpoint) {
    const report = await runHermes({ task, configuration, runId, signal, onCheckpoint });
    const { initialState, finalState, ...runtime } = report;
    return { initialState, finalState, runtime, error: report.error, errorKind: report.errorKind };
  },
};

export class ExperimentWorker {
  private store: Store;
  executor: Executor;
  private stopping = false;
  private loopPromise?: Promise<void>;
  private lease?: PoolClient;
  private current?: { experimentId: string; abort: AbortController };
  healthError: string | null = null;
  constructor(store: Store, executor: Executor = hermesExecutor, private readonly enabled = true) { this.store = store; this.executor = executor; }
  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    this.lease = await this.store.pool.connect();
    const result = await this.lease.query('SELECT pg_try_advisory_lock(hashtext(current_schema()),78112402) AS locked');
    if (!result.rows[0].locked) { this.lease.release(); this.lease = undefined; throw new Error('A worker already owns this database schema.'); }
    this.lease.on('error', () => { this.healthError = 'Worker database lease lost'; this.stopping = true; this.current?.abort.abort(new Error('Worker database lease lost')); });
    await this.store.recoverInterrupted();
    this.loopPromise = this.loop();
  }
  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        const run = await this.store.claimRun();
        if (!run) { await delay(250); continue; }
        const abort = new AbortController();
        this.current = { experimentId: run.experiment_id, abort };
        const experiment = await this.store.experiment(run.experiment_id);
        if (experiment.snapshot.graderVersion !== graderVersion) {
          await this.store.finish(run, 'infra_error', null, 'Frozen grader version is unavailable; create a new experiment or explicitly regrade saved evidence.');
          this.current = undefined;
          continue;
        }
        if (experiment.status === 'cancelled') abort.abort(new Error('Experiment cancelled'));
        if (abort.signal.aborted) { await this.store.finish(run, 'cancelled', null); this.current = undefined; continue; }
        try {
          const result = await this.executor.execute(run.task_snapshot, run.configuration_snapshot, run.id, abort.signal,
            (initial, final, runtime) => this.store.checkpoint(run, initial, final, runtime));
          await this.store.checkpoint(run, result.initialState, result.finalState, result.runtime);
          await this.store.pool.query('UPDATE runs SET status=\'grading\' WHERE id=$1', [run.id]);
          const grade = gradeRun(run.task_snapshot, result.initialState, result.finalState);
          const status = abort.signal.aborted ? 'cancelled' : result.errorKind ?? (grade.status === 'ungradable' ? 'ungradable' : 'completed');
          await this.store.finish(run, status, status === 'infra_error' || status === 'cancelled' ? null : grade, result.error ?? undefined);
        } catch (error) {
          await this.store.finish(run, abort.signal.aborted ? 'cancelled' : 'infra_error', null, (error as Error).message);
        } finally { this.current = undefined; }
      } catch (error) {
        this.healthError = (error as Error).message;
        await delay(1000);
      }
    }
  }
  async cancel(id: string) {
    const experiment = await this.store.cancel(id);
    if (this.current?.experimentId === id) this.current.abort.abort(new Error('Experiment cancelled'));
    return experiment;
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.current?.abort.abort(new Error('Backend shutting down'));
    await this.loopPromise;
    if (this.lease) {
      try { await this.lease.query('SELECT pg_advisory_unlock(hashtext(current_schema()),78112402)'); }
      finally { this.lease.release(); this.lease = undefined; }
    }
  }
}
