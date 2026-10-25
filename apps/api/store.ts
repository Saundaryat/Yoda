import { randomUUID, createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { loadSampleSuite, referenceInstructions } from '../../packages/contracts/tasks.ts';
import type { TaskSuite, AgentConfiguration, TaskDefinition } from '../../packages/contracts/tasks.ts';
import type { CrmState } from '../crm-mcp/crm.ts';
import type { Grade } from '../../packages/eval-engine/graders.ts';
import { graderVersion } from '../../packages/eval-engine/graders.ts';
import { analyze, analysisVersion } from '../../packages/eval-engine/statistics.ts';
import { evaluationSuite } from '../../fixtures/evaluation.ts';

export const defaultDatabaseUrl = 'postgresql://evals:evals-local-only@127.0.0.1:55432/evals';
export interface StoredRun {
  id: string; experiment_id: string; task_id: string; configuration_id: string; repetition: number; status: string;
  task_snapshot: TaskDefinition; configuration_snapshot: AgentConfiguration; initial_state: CrmState | null; final_state: CrmState | null;
  runtime: Record<string, unknown> | null; grade: Grade | null; error: { message: string } | null;
}
export class Store {
  pool: Pool;
  constructor(url = process.env.DATABASE_URL ?? defaultDatabaseUrl, schema?: string) {
    if (schema && !/^eval_test_[a-z0-9_]+$/.test(schema)) throw new Error('Invalid test schema');
    this.pool = new Pool({ connectionString: url, max: 6, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  }
  async migrate(): Promise<void> {
    const sql = readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8');
    await this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(78112401)');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING');
    });
  }
  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async seed(): Promise<void> {
    await this.importSuite(loadSampleSuite());
    await this.importSuite(evaluationSuite());
    await this.createConfiguration({ name: 'Reference workflow · reliable workflow v1', provider: process.env.EVAL_PROVIDER ?? 'copilot', model: process.env.EVAL_MODEL ?? 'gpt-4.1', instructions: referenceInstructions, memoryEnabled: false });
  }
  async importSuite(suite: TaskSuite): Promise<Record<string, any>> {
    const hash = digest(suite);
    const existing = await this.pool.query('SELECT * FROM task_suites WHERE logical_id=$1 AND version=$2', [suite.id, suite.version]);
    if (existing.rowCount) {
      if (existing.rows[0].content_hash !== hash) throw new ConflictException('This suite revision is immutable; increment its version.');
      return existing.rows[0];
    }
    const result = await this.pool.query('INSERT INTO task_suites(id, logical_id, version, content_hash, definition) VALUES($1,$2,$3,$4,$5) ON CONFLICT(logical_id,version) DO NOTHING RETURNING *', [randomUUID(), suite.id, suite.version, hash, suite]);
    if (result.rowCount) return result.rows[0];
    return this.importSuite(suite);
  }
  async createConfiguration(config: AgentConfiguration) {
    const hash = digest(config);
    const result = await this.pool.query('INSERT INTO configurations(id,content_hash,definition) VALUES($1,$2,$3) ON CONFLICT(content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING *', [randomUUID(), hash, config]);
    return result.rows[0];
  }
  async listSuites() { return (await this.pool.query('SELECT * FROM task_suites ORDER BY created_at,id')).rows; }
  async listConfigurations() { return (await this.pool.query('SELECT * FROM configurations ORDER BY created_at,id')).rows; }
  async listExperiments() { return (await this.pool.query('SELECT * FROM experiments ORDER BY created_at DESC,id LIMIT 100')).rows; }
  async suite(id: string) { return this.required('task_suites', id); }
  async configuration(id: string) { return this.required('configurations', id); }
  async experiment(id: string) { return this.required('experiments', id); }
  async run(id: string): Promise<StoredRun> { return this.required('runs', id); }
  private async required(table: 'task_suites' | 'configurations' | 'experiments' | 'runs', id: string) {
    const result = await this.pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
    if (!result.rowCount) throw new NotFoundException(`${table} record not found`);
    return result.rows[0];
  }
  async createExperiment(suiteId: string, configurationIds: string[], repetitions: number, taskIds?: string[], executor = 'hermes') {
    const suite = await this.suite(suiteId);
    const configurations = await Promise.all(configurationIds.map(id => this.configuration(id)));
    const tasks = (suite.definition as TaskSuite).tasks.filter(t => !taskIds || taskIds.includes(t.id));
    if (!tasks.length || (taskIds && tasks.length !== taskIds.length)) throw new ConflictException('Unknown or duplicate task IDs');
    const id = randomUUID();
    const order: { task: TaskDefinition; config: typeof configurations[number]; repetition: number }[] = [];
    for (const task of tasks) for (let repetition = 1; repetition <= repetitions; repetition++) {
      const pair = configurations.map(config => ({ task, config, repetition }));
      for (let i = pair.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pair[i], pair[j]] = [pair[j], pair[i]]; }
      order.push(...pair);
    }
    await this.transaction(async client => {
      await client.query('INSERT INTO experiments(id,status,snapshot) VALUES($1,\'draft\',$2)', [id, {
        suite, configurations, taskIds: tasks.map(t => t.id), repetitions, executor,
        graderVersion, analysisVersion, analysisSeed: randomInt(2147483647), practicalThreshold: 0.05, plannedRuns: order.length,
      }]);
      for (const [index, item] of order.entries()) await client.query('INSERT INTO runs(id,experiment_id,task_id,configuration_id,repetition,execution_order,status,task_snapshot,configuration_snapshot) VALUES($1,$2,$3,$4,$5,$6,\'queued\',$7,$8)',
        [randomUUID(), id, item.task.id, item.config.id, item.repetition, index, item.task, item.config.definition]);
      await this.event(client, id, { type: 'experiment.created', plannedRuns: order.length });
    });
    return this.experiment(id);
  }
  async start(id: string) {
    const result = await this.pool.query('UPDATE experiments SET status=\'queued\' WHERE id=$1 AND status=\'draft\' RETURNING *', [id]);
    if (!result.rowCount) { await this.experiment(id); throw new ConflictException('Only a draft experiment can be started.'); }
    return result.rows[0];
  }
  async claimRun(): Promise<StoredRun | null> {
    return this.transaction(async client => {
      // Claim and cancel lock the experiment first, so a claim cannot revive a cancelled parent.
      const parent = await client.query(`SELECT id FROM experiments WHERE status IN ('queued','running')
        AND EXISTS(SELECT 1 FROM runs WHERE runs.experiment_id=experiments.id AND runs.status='queued')
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!parent.rowCount) return null;
      const result = await client.query(`SELECT * FROM runs WHERE experiment_id=$1 AND status='queued'
        ORDER BY execution_order FOR UPDATE SKIP LOCKED LIMIT 1`, [parent.rows[0].id]);
      if (!result.rowCount) return null;
      const run = result.rows[0] as StoredRun;
      await client.query('UPDATE runs SET status=\'running\',started_at=now() WHERE id=$1', [run.id]);
      await client.query('UPDATE experiments SET status=\'running\' WHERE id=$1', [run.experiment_id]);
      await this.event(client, run.experiment_id, { type: 'run.started', runId: run.id });
      return run;
    });
  }
  async checkpoint(run: StoredRun, initial: CrmState, final: CrmState, runtime: Record<string, unknown>) {
    await this.transaction(async client => {
      await client.query('UPDATE runs SET initial_state=$2,final_state=$3,runtime=$4 WHERE id=$1', [run.id, initial, final, runtime]);
      for (const event of final.events) await client.query('INSERT INTO run_events(run_id,source,event_id,sequence,payload) VALUES($1,\'crm\',$2,$3,$4) ON CONFLICT DO NOTHING', [run.id, event.id, event.sequence, event]);
      const lifecycle = runtime.lifecycleEvents as unknown[] | undefined;
      for (const [index, event] of (lifecycle ?? []).entries()) await client.query('INSERT INTO run_events(run_id,source,event_id,sequence,payload) VALUES($1,\'hermes\',$2,$3,$4) ON CONFLICT DO NOTHING', [run.id, `hermes-${index + 1}`, index + 1, event]);
    });
  }
  async finish(run: StoredRun, status: string, grade: Grade | null, error?: string) {
    await this.transaction(async client => {
      const parent = await client.query('SELECT status FROM experiments WHERE id=$1 FOR UPDATE', [run.experiment_id]);
      if (parent.rows[0].status === 'cancelled') { status = 'cancelled'; grade = null; error ??= 'Experiment cancelled'; }
      await client.query('UPDATE runs SET status=$2,grade=$3,error=$4,completed_at=now() WHERE id=$1', [run.id, status, grade, error ? { message: error } : null]);
      for (const assertion of grade?.assertions ?? []) await client.query('INSERT INTO assertion_results(run_id,rule,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,rule) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload', [run.id, assertion.rule, assertion.status, assertion]);
      await this.event(client, run.experiment_id, { type: 'run.finished', runId: run.id, status, gradeStatus: grade?.status ?? null });
      const unfinished = await client.query('SELECT 1 FROM runs WHERE experiment_id=$1 AND status IN (\'queued\',\'running\',\'grading\') LIMIT 1', [run.experiment_id]);
      if (!unfinished.rowCount) {
        const errors = await client.query('SELECT 1 FROM runs WHERE experiment_id=$1 AND status=\'infra_error\' LIMIT 1', [run.experiment_id]);
        const result = await client.query('UPDATE experiments SET status=$2,completed_at=now() WHERE id=$1 AND status<>\'cancelled\' RETURNING id', [run.experiment_id, errors.rowCount ? 'failed' : 'completed']);
        if (result.rowCount) await this.event(client, run.experiment_id, { type: 'experiment.finished', status: errors.rowCount ? 'failed' : 'completed' });
      }
    });
  }
  async cancel(id: string) {
    await this.transaction(async client => {
      const updated = await client.query('UPDATE experiments SET status=\'cancelled\',completed_at=now() WHERE id=$1 AND status IN (\'draft\',\'queued\',\'running\') RETURNING id', [id]);
      if (!updated.rowCount) { await this.experiment(id); throw new ConflictException('Experiment is already terminal.'); }
      await client.query('UPDATE runs SET status=\'cancelled\',completed_at=now() WHERE experiment_id=$1 AND status=\'queued\'', [id]);
      await this.event(client, id, { type: 'experiment.cancelled' });
    });
    return this.experiment(id);
  }
  async recoverInterrupted() {
    await this.pool.query(`UPDATE runs SET status='infra_error',error='{"message":"Worker interrupted; no automatic replay"}'::jsonb,completed_at=now() WHERE status IN ('running','grading')`);
    await this.pool.query(`UPDATE experiments SET status='failed',completed_at=now() WHERE status='running' AND EXISTS(SELECT 1 FROM runs WHERE runs.experiment_id=experiments.id AND runs.status='infra_error')`);
    await this.pool.query(`UPDATE runs SET status='cancelled',completed_at=now() WHERE status='queued' AND experiment_id IN (SELECT id FROM experiments WHERE status='failed')`);
  }
  async runs(id: string): Promise<StoredRun[]> { await this.experiment(id); return (await this.pool.query('SELECT * FROM runs WHERE experiment_id=$1 ORDER BY execution_order', [id])).rows; }
  async events(id: string) { await this.run(id); return (await this.pool.query('SELECT * FROM run_events WHERE run_id=$1 ORDER BY source,sequence', [id])).rows; }
  async grades(id: string) { if (!(await this.run(id)).grade) return []; return (await this.pool.query('SELECT payload FROM assertion_results WHERE run_id=$1 ORDER BY rule', [id])).rows.map(r => r.payload); }
  async experimentEvents(id: string, after = 0) { await this.experiment(id); return (await this.pool.query('SELECT * FROM experiment_events WHERE experiment_id=$1 AND sequence>$2 ORDER BY sequence', [id, after])).rows; }
  async exportExperiment(id: string) {
    const experiment = await this.experiment(id);
    const runs = await this.runs(id);
    const evidence = await Promise.all(runs.map(async run => ({ run, events: await this.events(run.id), assertions: await this.grades(run.id) })));
    return { recordedAt: new Date().toISOString(), kind: `${experiment.snapshot.executor}-experiment-export`, experiment: { ...experiment, runs }, results: await this.results(id), evidence };
  }
  async configurationDiff(id: string) {
    const { snapshot } = await this.experiment(id);
    const [a, b] = snapshot.configurations;
    if (!b) return { baselineId: a.id, candidateId: null, changes: [] };
    const changes = Object.keys({ ...a.definition, ...b.definition }).filter(key => digest(a.definition[key]) !== digest(b.definition[key]))
      .map(field => ({ field, baseline: a.definition[field] ?? null, candidate: b.definition[field] ?? null }));
    return { baselineId: a.id, candidateId: b.id, changes };
  }
  private async event(client: PoolClient, id: string, payload: unknown) { await client.query('INSERT INTO experiment_events(experiment_id,payload) VALUES($1,$2)', [id, payload]); }
  async results(id: string) {
    const experiment = await this.experiment(id);
    const runs = await this.runs(id);
    return { experimentId: id, ...analyze(runs, {
      configurationIds: experiment.snapshot.configurations.map((c: any) => c.id), taskIds: experiment.snapshot.taskIds,
      repetitions: experiment.snapshot.repetitions, experimentStatus: experiment.status,
      seed: experiment.snapshot.analysisSeed ?? 74219, practicalThreshold: experiment.snapshot.practicalThreshold ?? 0.05,
    }) };
  }
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
