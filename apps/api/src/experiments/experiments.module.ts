import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsService } from './experiments.service.js';
import { RunsController } from './runs.controller.js';

@Module({
  imports: [RunnerModule],
  controllers: [ExperimentsController, RunsController],
  providers: [ExperimentsService],
})
export class ExperimentsModule {}
