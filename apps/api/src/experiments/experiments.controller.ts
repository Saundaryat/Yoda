import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { createExperimentSchema, type CreateExperiment } from '@evals/shared';
import { filter, interval, map, merge, Observable } from 'rxjs';
import { AnalysisService } from '../analysis/analysis.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RunQueueService } from '../runner/run-queue.service.js';
import { ExperimentsService } from './experiments.service.js';

@Controller('experiments')
export class ExperimentsController {
  constructor(
    private readonly experiments: ExperimentsService,
    private readonly queue: RunQueueService,
    private readonly analysis: AnalysisService,
  ) {}

  /** Creates a draft. Nothing runs (and nothing is spent) until it is started. */
  @Post()
  create(@Body(new ZodValidationPipe(createExperimentSchema)) body: CreateExperiment) {
    return this.experiments.create(body);
  }

  @Get()
  list() {
    return this.experiments.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.get(id);
  }

  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.start(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.cancel(id);
  }

  @Post(':id/retry-errors')
  retryErrors(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.retryErrors(id);
  }

  /** The comparison so far. Provisional while runs are still open (see coverage.openRuns). */
  @Get(':id/results')
  results(@Param('id', ParseUUIDPipe) id: string) {
    return this.analysis.results(id);
  }

  @Get(':id/grade-changes')
  gradeChanges(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.gradeChanges(id);
  }

  @Get(':id/costs')
  costs(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.costs(id);
  }

  @Get(':id/runs')
  runs(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.runs(id);
  }

  /** Live progress: one message per run state change, plus a heartbeat to keep proxies happy. */
  @Sse(':id/events')
  events(@Param('id', ParseUUIDPipe) id: string): Observable<MessageEvent> {
    return merge(
      this.queue.progress.pipe(
        filter((event) => event.experimentId === id),
        map((event) => ({ data: event })),
      ),
      interval(15_000).pipe(map(() => ({ type: 'heartbeat', data: {} }))),
    );
  }
}
