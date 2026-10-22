import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Configuration, CreateConfiguration } from '@evals/shared';
import { desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DB, type Db } from '../db/db.module.js';
import { configurations } from '../db/schema.js';
import { SkillsService } from '../skills/skills.service.js';

type Row = typeof configurations.$inferSelect;

const toConfiguration = (row: Row): Configuration => ({
  id: row.id,
  name: row.name,
  description: row.description,
  spec: row.spec as Configuration['spec'],
  specHash: row.specHash,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class ConfigurationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly skills: SkillsService,
  ) {}

  /** Configurations are immutable; "editing" one in the UI saves a new one. */
  async create(input: CreateConfiguration): Promise<Configuration> {
    const missing = input.spec.skills.filter((name) => !this.skills.get(name));
    if (missing.length) throw new BadRequestException(`Unknown skills: ${missing.join(', ')}`);
    const specHash = createHash('sha256').update(JSON.stringify(input.spec)).digest('hex');
    const [row] = await this.db
      .insert(configurations)
      .values({ ...input, specHash })
      .returning();
    return toConfiguration(row!);
  }

  async list(): Promise<Configuration[]> {
    const rows = await this.db
      .select()
      .from(configurations)
      .orderBy(desc(configurations.createdAt));
    return rows.map(toConfiguration);
  }

  async get(id: string): Promise<Configuration> {
    const [row] = await this.db.select().from(configurations).where(eq(configurations.id, id));
    if (!row) throw new NotFoundException(`Configuration ${id} not found`);
    return toConfiguration(row);
  }
}
