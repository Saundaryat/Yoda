import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Reuse an explicitly selected credential file without importing another app's
// database/routing settings or copying secrets into this project's artifacts.
export function liveCredentials(environment: NodeJS.ProcessEnv, readOnly = false): NodeJS.ProcessEnv {
  const env = { ...environment };
  if (readOnly || !env.EVAL_SECRETS_FILE || env.ANTHROPIC_API_KEY) return env;
  const values = parseEnv(readFileSync(resolve(env.EVAL_SECRETS_FILE), 'utf8'));
  if (!values.ANTHROPIC_API_KEY) throw new Error('EVAL_SECRETS_FILE has no ANTHROPIC_API_KEY');
  env.ANTHROPIC_API_KEY = values.ANTHROPIC_API_KEY;
  return env;
}
