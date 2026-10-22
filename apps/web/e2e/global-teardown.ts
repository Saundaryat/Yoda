import pg from 'pg';

export default async function globalTeardown() {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://evals:evals-local-only@127.0.0.1:55433/evals',
  });
  await pool.query(`drop schema if exists ${process.env.E2E_SCHEMA} cascade`);
  await pool.end();
}
