import { Inject, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { TaskDefinition } from '@evals/shared';
import { eq, inArray } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { DB, type Db } from '../db/db.module.js';
import { tasks } from '../db/schema.js';
import { readTaskFiles } from './task-files.js';

export type TaskRow = typeof tasks.$inferSelect & { definition: TaskDefinition };

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  /** Version hashes of the task files currently on disk. Older versions stay for old experiments. */
  private current: string[] = [];

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    const files = readTaskFiles(loadConfig().SUITES_DIR);
    await this.db
      .insert(tasks)
      .values(
        files.map((f) => ({
          suite: f.suite,
          key: f.key,
          versionHash: f.versionHash,
          split: f.definition.split,
          family: f.definition.family,
          title: f.definition.title,
          definition: f.definition,
        })),
      )
      .onConflictDoNothing();
    this.current = files.map((f) => f.versionHash);
  }

  async list(): Promise<TaskRow[]> {
    const rows = await this.db.select().from(tasks).where(inArray(tasks.versionHash, this.current));
    return (rows as TaskRow[]).sort(
      (a, b) => a.split.localeCompare(b.split) || a.key.localeCompare(b.key),
    );
  }

  async get(id: string): Promise<TaskRow> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new NotFoundException(`Task ${id} not found`);
    return row as TaskRow;
  }

  async getMany(ids: string[]): Promise<TaskRow[]> {
    return (await this.db.select().from(tasks).where(inArray(tasks.id, ids))) as TaskRow[];
  }
}
