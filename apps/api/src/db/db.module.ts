import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
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
      useFactory: () => {
        const { DATABASE_URL, DB_SCHEMA } = loadConfig();
        const pool = new pg.Pool({
          connectionString: DATABASE_URL,
          ...(DB_SCHEMA && { options: `-c search_path=${DB_SCHEMA}` }),
        });
        // pg removes broken idle clients before emitting this event. An unhandled pool event
        // terminates Node; query failures still reject through their normal callers.
        const logger = new Logger('PostgresPool');
        pool.on('error', (error) => logger.error('Idle PostgreSQL connection failed', error.stack));
        return pool;
      },
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
    const schema = loadConfig().DB_SCHEMA;
    if (schema) await this.pool.query(`create schema if not exists ${schema}`);
    await migrate(this.db, { migrationsFolder, ...(schema && { migrationsSchema: schema }) });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
