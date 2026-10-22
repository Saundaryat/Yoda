import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Hermes CLI. In Docker this is the official image's launcher. */
  HERMES_BIN: z.string().default('hermes'),
  /** Per-run Hermes homes and CRM state live here (a Docker named volume in compose). */
  RUNS_DIR: z.string().default('.runs'),
  /** Task suites: <suite>/<dev|eval>/*.yaml. */
  SUITES_DIR: z.string().default('../../suites'),
  /** Skill library: <name>/SKILL.md. */
  SKILLS_DIR: z.string().default('../../skills'),
  /** Built Vue app to serve at /. Unset in dev, where Vite serves it. */
  WEB_DIST: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
