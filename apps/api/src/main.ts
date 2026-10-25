import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { configureWeb } from './web.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureWeb(app, config.WEB_DIST);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}
await bootstrap();
