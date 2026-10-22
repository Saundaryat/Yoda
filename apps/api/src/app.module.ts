import { DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { loadConfig } from './config.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';

const webDist = loadConfig().WEB_DIST;
const staticWeb: DynamicModule[] = webDist
  ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })]
  : [];

@Module({
  imports: [DbModule, ...staticWeb],
  controllers: [HealthController],
})
export class AppModule {}
