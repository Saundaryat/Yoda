// drizzle-kit writes foreign keys as REFERENCES "public"."table". Dropping the schema prefix lets
// the same migrations build into any schema (the integration tests use a throwaway one per file).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../drizzle/', import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
  const path = new URL(name, dir);
  const sql = readFileSync(path, 'utf8');
  const fixed = sql.replaceAll('REFERENCES "public".', 'REFERENCES ');
  if (fixed !== sql) writeFileSync(path, fixed);
}
