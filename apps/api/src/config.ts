import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Postgres schema for all tables (tests use a throwaway one per file). Default: public. */
  DB_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .optional(),
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

  /** Scenarios run in parallel. Each holds a Hermes gateway (~400 MB) while it runs. */
  RUN_CONCURRENCY: z.coerce.number().int().min(1).default(3),
  /** Hard limit per lead turn; Hermes's own budget doesn't stop a hung model call. */
  TURN_TIMEOUT_MS: z.coerce.number().int().default(150_000),
  /** Hermes's wall-clock budget per turn (agent.run_budget_seconds). */
  RUN_BUDGET_SECONDS: z.coerce.number().int().default(120),
  /** Attempts per scenario when infrastructure fails (each attempt starts from scratch). */
  MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  /** Stop an experiment's remaining runs once its estimated spend passes this. */
  MAX_EXPERIMENT_COST_USD: z.coerce.number().default(25),
  OPENAI_API_KEY: z.string().optional(),
  /** Used by Hermes when a configuration's provider is anthropic, and by the LLM-played lead. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Claude model that plays the lead in experiments with lead mode "llm". */
  LEAD_MODEL: z.string().default('claude-opus-5-5'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
