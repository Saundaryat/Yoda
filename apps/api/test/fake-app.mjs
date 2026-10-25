// Offline Playwright server only. Production continues to use dist/main.js.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { loadConfig } from '../dist/config.js';
import { configureWeb } from '../dist/web.js';
import { RunQueueService } from '../dist/runner/run-queue.service.js';
import { fakeJudge } from './fake-judge.ts';
const app = await NestFactory.create(AppModule);
configureWeb(app, loadConfig().WEB_DIST);
app.setGlobalPrefix('api');
app.enableShutdownHooks();
app.get(RunQueueService).settings.judge = fakeJudge();
await app.listen(Number(process.env.PORT));
