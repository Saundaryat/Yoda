import 'reflect-metadata';
import { BadRequestException, Body, Controller, Get, Headers, Inject, Module, Param, Post, Query, ServiceUnavailableException, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store } from './store.ts';
import { ExperimentWorker } from './worker.ts';
import type { Executor } from './worker.ts';
import { configurationSchema, suiteSchema } from '../../packages/contracts/tasks.ts';

const createExperimentSchema = z.object({
  suiteId: z.string().uuid(), configurationIds: z.array(z.string().uuid()).min(1).max(2),
  repetitions: z.number().int().min(1).max(5).default(1), taskIds: z.array(z.string().min(1).max(64)).min(1).max(100).optional(),
}).strict().refine(v => new Set(v.configurationIds).size === v.configurationIds.length, 'Configuration IDs must be unique');
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
  return result.data;
}
function uuid(value: string) { return parse(z.string().uuid(), value); }

@Controller('api')
class EvaluationController {
  constructor(@Inject(Store) private readonly store: Store, @Inject(ExperimentWorker) private readonly worker: ExperimentWorker,
    @Inject('READ_ONLY') private readonly readOnly: boolean) {}
  @Get('health') async health() {
    await this.store.pool.query('SELECT 1');
    if (this.worker.healthError) throw new ServiceUnavailableException('Experiment worker unhealthy');
    return { status: 'ok', database: 'postgresql', executor: this.readOnly ? 'saved-evidence' : this.worker.executor.label, readOnly: this.readOnly };
  }
  @Get('task-suites') suites() { return this.store.listSuites(); }
  @Post('task-suites') importSuite(@Body() body: unknown) { return this.store.importSuite(parse(suiteSchema, body)); }
  @Get('task-suites/:id') suite(@Param('id') id: string) { return this.store.suite(uuid(id)); }
  @Get('configurations') configurations() { return this.store.listConfigurations(); }
  @Post('configurations') configure(@Body() body: unknown) { return this.store.createConfiguration(parse(configurationSchema, body)); }
  @Get('configurations/:id') configuration(@Param('id') id: string) { return this.store.configuration(uuid(id)); }
  @Post('experiments') create(@Body() body: unknown) {
    const input = parse(createExperimentSchema, body);
    return this.store.createExperiment(input.suiteId, input.configurationIds, input.repetitions, input.taskIds, this.worker.executor.label);
  }
  @Get('experiments') experiments() { return this.store.listExperiments(); }
  @Post('experiments/:id/start') start(@Param('id') id: string) { return this.store.start(uuid(id)); }
  @Post('experiments/:id/cancel') cancel(@Param('id') id: string) { return this.worker.cancel(uuid(id)); }
  @Get('experiments/:id') async experiment(@Param('id') id: string) {
    const validId = uuid(id);
    return { ...await this.store.experiment(validId), runs: await this.store.runs(validId) };
  }
  @Get('experiments/:id/results') results(@Param('id') id: string) { return this.store.results(uuid(id)); }
  @Get('experiments/:id/diff') diff(@Param('id') id: string) { return this.store.configurationDiff(uuid(id)); }
  @Get('experiments/:id/export') export(@Param('id') id: string) { return this.store.exportExperiment(uuid(id)); }
  @Sse('experiments/:id/stream') async stream(@Param('id') id: string, @Headers('last-event-id') last?: string) {
    const validId = uuid(id);
    await this.store.experiment(validId);
    let cursor = last === undefined ? 0 : parse(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), last);
    return new Observable<{ id?: string; data: unknown }>(subscriber => {
      let busy = false;
      const tick = async () => {
        if (busy || subscriber.closed) return;
        busy = true;
        try {
          const events = await this.store.experimentEvents(validId, cursor);
          for (const event of events) { cursor = Number(event.sequence); subscriber.next({ id: String(cursor), data: event.payload }); }
          const experiment = await this.store.experiment(validId);
          if (['completed', 'failed', 'cancelled'].includes(experiment.status)) {
            subscriber.next({ data: { type: 'stream.terminal', status: experiment.status } });
            subscriber.complete();
          }
        } catch { subscriber.error(new Error('Progress stream unavailable')); }
        finally { busy = false; }
      };
      const timer = setInterval(() => void tick(), 500);
      void tick();
      return () => clearInterval(timer);
    });
  }
  @Get('experiments/:id/events') events(@Param('id') id: string, @Query('after') after?: string) {
    const cursor = after === undefined ? 0 : parse(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), after);
    return this.store.experimentEvents(uuid(id), cursor);
  }
  @Get('runs/:id') run(@Param('id') id: string) { return this.store.run(uuid(id)); }
  @Get('runs/:id/events') runEvents(@Param('id') id: string) { return this.store.events(uuid(id)); }
  @Get('runs/:id/grades') grades(@Param('id') id: string) { return this.store.grades(uuid(id)); }
}

export async function createEvaluationApp(options: { store?: Store; executor?: Executor; logger?: false; readOnly?: boolean } = {}) {
  const store = options.store ?? new Store();
  await store.migrate();
  await store.seed();
  const worker = new ExperimentWorker(store, options.executor, !options.readOnly);
  @Module({ controllers: [EvaluationController], providers: [
    { provide: Store, useValue: store }, { provide: ExperimentWorker, useValue: worker },
    { provide: 'READ_ONLY', useValue: options.readOnly ?? false },
  ] })
  class EvaluationModule {}
  const app = await NestFactory.create<NestExpressApplication>(EvaluationModule, { logger: options.logger === false ? false : ['error', 'warn', 'log'], abortOnError: false });
  if (options.readOnly) app.use('/api', (req: { method: string }, res: { status: (code: number) => { json: (value: unknown) => void } }, next: () => void) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(403).json({ message: 'Saved-evidence review is read-only. Use npm start for live experiments.' });
    next();
  });
  const webRoot = resolve(import.meta.dirname, '../../dist/web');
  if (existsSync(resolve(webRoot, 'index.html'))) app.useStaticAssets(webRoot);
  app.setGlobalPrefix('');
  app.enableShutdownHooks();
  // Only loopback is bound by main.ts; this milestone is a local API without public authentication.
  app.enableCors({ origin: false });
  const originalClose = app.close.bind(app);
  app.close = async () => { try { await originalClose(); } finally { await store.pool.end(); } };
  return app;
}
