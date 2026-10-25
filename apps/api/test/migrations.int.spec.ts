import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

// The published branch and the local v8 build both used migration number 0003.
// Both histories must upgrade without adding an existing column or losing data.
describe.each(['fresh', 'published-v3', 'local-v3'] as const)('migration from %s', (history) => {
  it('preserves existing data and installs both check-status columns', async () => {
    const schema = `migration_${randomBytes(6).toString('hex')}`;
    const pool = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgres://evals:evals-local-only@127.0.0.1:55433/evals',
      options: `-c search_path=${schema}`,
    });
    const folder = mkdtempSync(join(tmpdir(), 'evals-migration-'));
    const db = drizzle({ client: pool });
    try {
      await pool.query(`create schema ${schema}`);
      if (history !== 'fresh') {
        cpSync(migrationsFolder, folder, { recursive: true });
        const journalPath = join(folder, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        journal.entries = journal.entries.slice(0, 4);
        if (history === 'local-v3') {
          journal.entries[3] = {
            ...journal.entries[3],
            when: 1792851326337,
            tag: '0003_legacy-local',
          };
          writeFileSync(
            join(folder, '0003_legacy-local.sql'),
            'ALTER TABLE "check_results" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint\n' +
              'ALTER TABLE "check_results" ADD COLUMN "informational" boolean DEFAULT false NOT NULL;',
          );
        }
        writeFileSync(journalPath, JSON.stringify(journal));
        await migrate(db, { migrationsFolder: folder, migrationsSchema: schema });
      }
      await pool.query('create table migration_probe (marker text not null)');
      await pool.query('insert into migration_probe values ($1)', ['keep existing data']);
      await migrate(db, { migrationsFolder, migrationsSchema: schema });
      // A second startup must also be harmless.
      await migrate(db, { migrationsFolder, migrationsSchema: schema });
      const columns = await pool.query(
        `select column_name from information_schema.columns
         where table_schema = $1 and table_name = 'check_results'
         and column_name in ('skipped', 'informational') order by column_name`,
        [schema],
      );
      expect(columns.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
        'informational',
        'skipped',
      ]);
      expect((await pool.query('select marker from migration_probe')).rows).toEqual([
        { marker: 'keep existing data' },
      ]);
      const applied = await pool.query(
        'select created_at from __drizzle_migrations order by created_at',
      );
      expect(Number(applied.rows.at(-1).created_at)).toBe(1792851326338);
    } finally {
      await pool.query(`drop schema if exists ${schema} cascade`);
      await pool.end();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
