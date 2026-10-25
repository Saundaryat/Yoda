import { Module } from '@nestjs/common';
import { ConfigurationsModule } from './configurations/configurations.module.js';
import { DbModule } from './db/db.module.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { HealthController } from './health/health.controller.js';
import { SkillsModule } from './skills/skills.module.js';
import { SuitesModule } from './suites/suites.module.js';

@Module({
  imports: [DbModule, SuitesModule, SkillsModule, ConfigurationsModule, ExperimentsModule],
  controllers: [HealthController],
})
export class AppModule {}
