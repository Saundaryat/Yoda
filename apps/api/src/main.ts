import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (config.WEB_DIST) {
    const indexHtml = readFileSync(resolve(config.WEB_DIST, 'index.html'), 'utf8');
    const server = app.getHttpAdapter().getInstance();
    app.useStaticAssets(config.WEB_DIST);
    // The client router owns non-API paths, including directly opened nested URLs.
    server.get(/^(?!\/api(?:\/|$)).*/, (_request: Request, response: Response) => {
      response.type('html').send(indexHtml);
    });
  }
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}
await bootstrap();
