import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { RunnerModule } from '../runner/runner.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsService } from './experiments.service.js';
import { RunsController } from './runs.controller.js';

@Module({
  imports: [RunnerModule, AnalysisModule],
  controllers: [ExperimentsController, RunsController],
  providers: [ExperimentsService],
})
export class ExperimentsModule {}
