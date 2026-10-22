import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module.js';
import { RunQueueService } from './run-queue.service.js';

@Module({
  imports: [SkillsModule],
  providers: [RunQueueService],
  exports: [RunQueueService],
})
export class RunnerModule {}
