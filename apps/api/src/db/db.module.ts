import { Global, Inject, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';
import * as schema from './schema.js';

export const DB = Symbol('DB');
const POOL = Symbol('POOL');
export type Db = NodePgDatabase<typeof schema>;

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      useFactory: () => new pg.Pool({ connectionString: loadConfig().DATABASE_URL }),
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (pool: pg.Pool): Db => drizzle({ client: pool, schema, casing: 'snake_case' }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(POOL) private readonly pool: pg.Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    await migrate(this.db, { migrationsFolder });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
