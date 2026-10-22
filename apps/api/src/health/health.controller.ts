import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthStatus } from '@evals/shared';
import { sql } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { DB, type Db } from '../db/db.module.js';

const run = promisify(execFile);

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const [database, hermes] = await Promise.all([this.database(), this.hermesVersion()]);
    return { database, hermes };
  }

  private async database(): Promise<HealthStatus['database']> {
    try {
      await this.db.execute(sql`select 1`);
      return 'ok';
    } catch {
      return 'unavailable';
    }
  }

  private async hermesVersion(): Promise<string | null> {
    try {
      const { stdout } = await run(loadConfig().HERMES_BIN, ['--version'], { timeout: 15_000 });
      return stdout.split('\n')[0]?.trim() || null;
    } catch {
      return null;
    }
  }
}
