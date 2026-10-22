import type { ConfigurationSpec } from '@evals/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hermes provider ids for the providers a configuration may name. */
export const HERMES_PROVIDER: Record<ConfigurationSpec['provider'], string> = {
  openai: 'openai-api',
  anthropic: 'anthropic',
};

export const PROVIDER_KEY_ENV: Record<ConfigurationSpec['provider'], string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** Hermes separates memory entries with this line (tools/memory_tool_store.py). */
const MEMORY_SEPARATOR = '\n§\n';

export interface HomeInput {
  home: string;
  spec: ConfigurationSpec;
  /** SKILL.md contents by skill name, for the skills the configuration lists. */
  skills: Record<string, string>;
  providerKey: string;
  crm: { node: string; server: string; stateFile: string };
  runBudgetSeconds: number;
}

/**
 * Hermes settings for an eval run. Everything that could make a run depend on anything but the
 * configuration under test is switched off: background review, curator and title generation (extra
 * model calls that also write memory/skills), fallback providers, update checks, lazy installs,
 * borrowing host logins, and project skill discovery. See spike/NOTES.md for how each was verified.
 */
export function hermesConfig(input: HomeInput) {
  const { spec } = input;
  return {
    _config_version: 51,
    model: { default: spec.model, provider: HERMES_PROVIDER[spec.provider] },
    fallback_providers: [],
    agent: { run_budget_seconds: input.runBudgetSeconds, auto_recovery_cycles: 0 },
    tools: { tool_search: { enabled: spec.toolSearch ? 'on' : 'off' } },
    memory: {
      memory_enabled: spec.memory.enabled,
      user_profile_enabled: spec.memory.enabled,
      nudge_interval: 0,
      provider: '',
    },
    skills: { project_discovery: false, creation_nudge_interval: 0, disabled: ['hermes-agent'] },
    curator: { enabled: false },
    auxiliary: { background_review: { enabled: false }, title_generation: { enabled: false } },
    gateway: { unmanaged_idle_exit_seconds: 120 },
    updates: { check: false },
    auth: { adopt_external_logins: false },
    security: { allow_lazy_installs: false },
    telemetry: { shared_metrics: { enabled: false, send: false } },
    mcp_servers: {
      crm: {
        command: input.crm.node,
        args: [input.crm.server],
        env: { CRM_STATE_FILE: input.crm.stateFile },
      },
    },
  };
}

/** Toolsets for `hermes -z -t`: the CRM always, plus what the configuration enables. */
export function toolsets(spec: ConfigurationSpec): string[] {
  return [
    'mcp-crm',
    ...(spec.skills.length && spec.skillMode === 'available' ? ['skills'] : []),
    ...(spec.memory.enabled ? ['memory'] : []),
    ...spec.toolsets,
  ];
}

/** Create a fresh Hermes home. Files are private (0600/0700): Hermes refuses group-writable homes. */
export function seedHome(input: HomeInput): void {
  const { home, spec } = input;
  mkdirSync(join(home, 'memories'), { recursive: true, mode: 0o700 });
  const write = (path: string, content: string) =>
    writeFileSync(join(home, path), content, { mode: 0o600 });

  // JSON is valid YAML, and avoids a YAML writer dependency.
  write('config.yaml', JSON.stringify(hermesConfig(input), null, 2));
  write('SOUL.md', `${spec.systemPrompt.trim()}\n`);
  write('.no-bundled-skills', '');
  write('.env', `${PROVIDER_KEY_ENV[spec.provider]}=${input.providerKey}\n`);
  if (spec.memory.seed.length) write('memories/MEMORY.md', spec.memory.seed.join(MEMORY_SEPARATOR));
  for (const [name, content] of Object.entries(input.skills)) {
    mkdirSync(join(home, 'skills', 'clinic', name), { recursive: true, mode: 0o700 });
    write(join('skills', 'clinic', name, 'SKILL.md'), content);
  }
}
