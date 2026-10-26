import type { ConfigurationSpec } from '@evals/shared';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { HERMES_PROVIDER, toolsets } from './hermes-home.js';

/** The `--usage-file` report Hermes writes after every `-z` turn, even a failed one. */
export interface TurnUsage {
  session_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_usd?: number | null;
  cost_status?: string | null;
  api_calls?: number | null;
  turn_exit_reason?: string | null;
  failed?: boolean;
  failure?: string;
  auxiliary?: { api_calls?: number | null; estimated_cost_usd?: number | null };
}

export interface TurnResult {
  exitCode: number | null;
  stdout: string;
  usage: TurnUsage | null;
  timedOut: boolean;
}

// External CLI output must be validated before leaving its event callback.
const count = z.number().finite().nonnegative().nullable().optional();
const usageSchema = z
  .object({
    session_id: z.string().nullable().optional(),
    input_tokens: count,
    output_tokens: count,
    estimated_cost_usd: count,
    cost_status: z.string().nullable().optional(),
    api_calls: count,
    turn_exit_reason: z.string().nullable().optional(),
    failed: z.boolean().optional(),
    failure: z.string().optional(),
    auxiliary: z.object({ api_calls: count, estimated_cost_usd: count }).optional(),
  })
  .passthrough();

/** Why an attempt could not produce a scoreable run. `retry` kinds are retried from scratch. */
export class InfraError extends Error {
  constructor(
    readonly kind:
      'rate_limit' | 'timeout' | 'provider_error' | 'crash' | 'account' | 'cancelled' | 'cost_cap',
    message: string,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.kind !== 'account' && this.kind !== 'cancelled' && this.kind !== 'cost_cap';
  }
}

/**
 * Decide whether a turn produced an agent outcome or failed for infrastructure reasons.
 * Agent-side endings (iteration or time budget, empty answer) are outcomes and get scored.
 */
export function classifyTurn(result: TurnResult): InfraError | null {
  const { usage } = result;
  if (result.timedOut) return new InfraError('timeout', 'Turn exceeded the hard time limit');
  if (!usage)
    return new InfraError('crash', `Hermes exited ${result.exitCode} without a usage report`);
  if (!usage.failed && result.exitCode === 0) return null;
  const failure = usage.failure ?? `exit ${result.exitCode}`;
  // Key, billing and quota problems won't fix themselves: stop instead of retrying.
  if (
    /\b40[13]\b|api.?key|unauthori[sz]ed|authentication|permission|insufficient_quota|billing|credit/i.test(
      failure,
    )
  ) {
    return new InfraError('account', failure);
  }
  if (/\b429\b|rate.?limit|overloaded|\b529\b/i.test(failure))
    return new InfraError('rate_limit', failure);
  return new InfraError('provider_error', failure);
}

export interface TurnInput {
  hermesBin: string;
  home: string;
  /** Scratch working directory outside any git repo (Hermes reads AGENTS.md from the repo root). */
  cwd: string;
  spec: ConfigurationSpec;
  prompt: string;
  resume: string | null;
  usageFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Extra variables for Hermes. Only tests use this, to steer the fake Hermes. */
  extraEnv?: Record<string, string>;
}

/** Only these variables reach Hermes: no host keys, base URLs or logins leak into a run. */
function hermesEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    LANG: 'C.UTF-8',
    TZ: 'America/Chicago',
    HOME: home,
    HERMES_HOME: home,
    HERMES_DISABLE_LAZY_INSTALLS: '1',
    PYTHONUNBUFFERED: '1',
    NO_COLOR: '1',
  };
}

export function turnArgs(input: TurnInput): string[] {
  const { spec } = input;
  return [
    '-z',
    input.prompt,
    '-m',
    spec.model,
    '--provider',
    HERMES_PROVIDER[spec.provider],
    '-t',
    toolsets(spec).join(','),
    '--usage-file',
    input.usageFile,
    ...(spec.reasoning ? ['--reasoning', spec.reasoning] : []),
    ...(spec.skillMode === 'preloaded' ? spec.skills.flatMap((name) => ['-s', name]) : []),
    ...(input.resume ? ['--resume', input.resume] : []),
  ];
}

/** Run one lead turn. The process gets its own group so a timeout kills Hermes and its children. */
export function runTurn(input: TurnInput): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) return reject(new InfraError('cancelled', 'Run cancelled'));
    const child = spawn(input.hermesBin, turnArgs(input), {
      cwd: input.cwd,
      env: { ...hermesEnv(input.home), ...input.extraEnv },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    let cancelled = false;
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.resume();

    const killGroup = () => {
      try {
        process.kill(-child.pid!, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            // already gone
          }
        }, 5_000).unref();
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, input.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killGroup();
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new InfraError('crash', `Could not start Hermes: ${error.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      if (cancelled) return reject(new InfraError('cancelled', 'Run cancelled'));
      try {
        const usage = existsSync(input.usageFile)
          ? usageSchema.parse(JSON.parse(readFileSync(input.usageFile, 'utf8')))
          : null;
        resolve({ exitCode, stdout: stdout.trim(), usage, timedOut });
      } catch {
        // Do not echo malformed output: it can contain provider response details or credentials.
        reject(new InfraError('crash', 'Hermes usage report is unreadable or invalid'));
      }
    });
  });
}

/** Stop the per-home gateway Hermes auto-starts (it would otherwise idle for minutes, ~400 MB). */
export function stopGateway(hermesBin: string, home: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(hermesBin, ['gateway', 'stop'], {
      env: hermesEnv(home),
      stdio: 'ignore',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
