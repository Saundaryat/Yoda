// `pnpm db:generate <name>`: drizzle-kit generate, then make the SQL schema-agnostic.
import { execFileSync } from 'node:child_process';

const name = process.argv[2];
if (!name) throw new Error('usage: pnpm db:generate <migration_name>');
execFileSync('drizzle-kit', ['generate', '--name', name], { stdio: 'inherit' });
execFileSync('node', [new URL('./unqualify-migrations.mjs', import.meta.url).pathname], {
  stdio: 'inherit',
});
