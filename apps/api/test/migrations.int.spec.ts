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
describe.each(['fresh', 'published-v3', 'local-v3', 'current-v4'] as const)(
  'migration from %s',
  (history) => {
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
          journal.entries = journal.entries.slice(0, history === 'current-v4' ? 5 : 4);
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
        let savedRunId: string | undefined;
        if (history !== 'fresh') {
          const config = (
            await pool.query(
              `insert into configurations(name,spec,spec_hash) values('Saved configuration','{}','historical-hash') returning id`,
            )
          ).rows[0];
          const task = (
            await pool.query(
              `insert into tasks(suite,key,version_hash,split,family,title,definition) values('clinic','saved','task-hash','eval','saved','Saved task','{}') returning id`,
            )
          ).rows[0];
          const experiment = (
            await pool.query(
              `insert into experiments(name,baseline_config_id,candidate_config_id,task_ids,repetitions,status) values('Saved experiment',$1,$1,ARRAY[$2]::uuid[],1,'finished') returning id`,
              [config.id, task.id],
            )
          ).rows[0];
          savedRunId = (
            await pool.query(
              `insert into runs(experiment_id,task_id,config_id,repetition,position,status,passed,score,context,crm_final,session_ids) values($1,$2,$3,1,0,'scored',true,88.5,'{"saved":"context"}','{"saved":"crm"}',ARRAY['historical-session']) returning id`,
              [experiment.id, task.id, config.id],
            )
          ).rows[0].id;
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
        if (savedRunId) {
          const saved = await pool.query(
            'select passed,score,context,crm_final,session_ids,conversation,grading_usage from runs where id=$1',
            [savedRunId],
          );
          expect(saved.rows).toEqual([
            {
              passed: true,
              score: 88.5,
              context: { saved: 'context' },
              crm_final: { saved: 'crm' },
              session_ids: ['historical-session'],
              conversation: null,
              grading_usage: null,
            },
          ]);
          expect(
            (await pool.query('select spec_hash,skill_contents from configurations')).rows,
          ).toEqual([{ spec_hash: 'historical-hash', skill_contents: null }]);
        }
        const applied = await pool.query(
          'select created_at from __drizzle_migrations order by created_at',
        );
        const journal = JSON.parse(
          readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
        );
        expect(Number(applied.rows.at(-1).created_at)).toBe(journal.entries.at(-1).when);
        const durable = await pool.query(
          `select column_name from information_schema.columns where table_schema=$1 and table_name='runs' and column_name in ('conversation','phase_attempts') order by column_name`,
          [schema],
        );
        expect(durable.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
          'conversation',
          'phase_attempts',
        ]);
      } finally {
        await pool.query(`drop schema if exists ${schema} cascade`);
        await pool.end();
        rmSync(folder, { recursive: true, force: true });
      }
    });
  },
);
