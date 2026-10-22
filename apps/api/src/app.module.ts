import { DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { loadConfig } from './config.js';
import { ConfigurationsModule } from './configurations/configurations.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { SkillsModule } from './skills/skills.module.js';
import { SuitesModule } from './suites/suites.module.js';

const webDist = loadConfig().WEB_DIST;
const staticWeb: DynamicModule[] = webDist
  ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })]
  : [];

@Module({
  imports: [DbModule, SuitesModule, SkillsModule, ConfigurationsModule, ...staticWeb],
  controllers: [HealthController],
})
export class AppModule {}
