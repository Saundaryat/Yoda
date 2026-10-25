import { vi } from 'vitest';
import type { Db } from '../db/db.module.js';
import type { runs } from '../db/schema.js';
import type { SkillsService } from '../skills/skills.service.js';
import { RunQueueService } from './run-queue.service.js';

type Run = typeof runs.$inferSelect;

it('serializes overlapping fills and waits for aborted work before shutdown', async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    RUN_CONCURRENCY: process.env.RUN_CONCURRENCY,
  };
  process.env.DATABASE_URL = 'postgres://unused';
  process.env.RUN_CONCURRENCY = '2';
  const queue = new RunQueueService({} as Db, {} as SkillsService);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const internals = queue as unknown as {
    claim: () => Promise<Run | undefined>;
    process: (run: Run, signal: AbortSignal) => Promise<void>;
    active: Map<string, AbortController>;
  };
  let claims = 0;
  const claim = vi.spyOn(internals, 'claim').mockImplementation(async () => {
    const index = claims++;
    await gate;
    return { id: `run-${index}`, experimentId: 'test' } as Run;
  });
  const processSpy = vi.spyOn(internals, 'process').mockImplementation(
    (_run, signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            queueMicrotask(resolve);
          },
          { once: true },
        );
      }),
  );
  try {
    const fills = Array.from({ length: 5 }, () => queue.fill());
    expect(claim).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(fills);
    expect(internals.active.size).toBe(2);
    expect(processSpy).toHaveBeenCalledTimes(2);
    await queue.beforeApplicationShutdown();
    expect(internals.active.size).toBe(0);
  } finally {
    release();
    await queue.beforeApplicationShutdown();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis.process.env[key];
      else globalThis.process.env[key] = value;
    }
  }
});
