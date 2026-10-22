// Run one lead turn through Hermes (official Docker image) with a throwaway per-run home.
//
//   node turn.mjs <run> "<lead message>" [--resume <session>] [--provider stub|openai|anthropic]
//        [--model <id>] [--toolsets mcp-crm,skills,memory] [--skill <name>]... [--preload <name>]...
//        [--memory off|on] [--memory-seed <file>] [--new-session]
//
// The home is seeded on first use of <run>; later turns reuse it (that is what makes memory and
// resume observable). The container gets no host env, so nothing leaks in except what we write.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const IMAGE =
  'nousresearch/hermes-agent:v0.22.4@sha256:7a69201726bc64db2072a1371557137c23312d29705cda2b8ea2a0214a50a4cf';
const spikeDir = dirname(fileURLToPath(import.meta.url));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    resume: { type: 'string' },
    provider: { type: 'string', default: 'stub' },
    model: { type: 'string' },
    toolsets: { type: 'string', default: 'mcp-crm' },
    skill: { type: 'string', multiple: true, default: [] },
    preload: { type: 'string', multiple: true, default: [] },
    memory: { type: 'string', default: 'off' },
    'memory-seed': { type: 'string' },
    'run-budget': { type: 'string', default: '90' },
    'tool-search': { type: 'string', default: 'off' },
  },
});
const [run, prompt] = positionals;
if (!run || !prompt) throw new Error('usage: node turn.mjs <run> <prompt> [options]');

const providers = {
  stub: {
    provider: 'custom',
    model: 'stub-model',
    base_url: 'http://host.docker.internal:8787/v1',
    api_key: 'stub',
  },
  openai: { provider: 'openai-api', model: 'gpt-4.1-mini', keyName: 'OPENAI_API_KEY' },
  anthropic: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    keyName: 'ANTHROPIC_API_KEY',
  },
};
const p = providers[values.provider];
const model = values.model ?? p.model;

const runDir = join(spikeDir, 'runs', run);
const home = join(runDir, 'home');
const inContainer = (hostPath) => hostPath.replace(spikeDir, '/spike');

function readDotEnv() {
  const file = join(spikeDir, '..', '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=./.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  );
}

function seedHome() {
  mkdirSync(join(home, 'memories'), { recursive: true });
  const memoryOn = values.memory !== 'off';
  const config = {
    _config_version: 51,
    model: {
      default: model,
      provider: p.provider,
      context_length: 128000,
      ...(p.base_url && { base_url: p.base_url, api_key: p.api_key }),
    },
    // MCP tools are deferred behind tool_search/tool_describe/tool_call by default.
    tools: { tool_search: { enabled: values['tool-search'] } },
    fallback_providers: [],
    agent: { run_budget_seconds: Number(values['run-budget']), auto_recovery_cycles: 0 },
    memory: {
      memory_enabled: memoryOn,
      user_profile_enabled: memoryOn,
      nudge_interval: 0,
      provider: '',
    },
    skills: { project_discovery: false, creation_nudge_interval: 0 },
    curator: { enabled: false },
    auxiliary: { background_review: { enabled: false }, title_generation: { enabled: false } },
    updates: { check: false },
    auth: { adopt_external_logins: false },
    security: { allow_lazy_installs: false },
    telemetry: { shared_metrics: { enabled: false, send: false } },
    mcp_servers: {
      crm: {
        command: '/usr/local/bin/node',
        args: ['/spike/crm-server.mjs'],
        env: { CRM_STATE_FILE: inContainer(join(runDir, 'crm.json')) },
      },
    },
  };
  // JSON is valid YAML; Hermes reads it as config.yaml.
  writeFileSync(join(home, 'config.yaml'), JSON.stringify(config, null, 2));
  writeFileSync(join(home, '.no-bundled-skills'), '');
  writeFileSync(
    join(home, 'SOUL.md'),
    'You are the SMS assistant for Bright Smile Dental. You answer inbound leads, qualify them and book appointments using the CRM tools. Keep replies short.\n',
  );
  if (p.keyName) {
    const key = readDotEnv()[p.keyName];
    if (!key) throw new Error(`${p.keyName} missing from agent-evals/.env`);
    writeFileSync(join(home, '.env'), `${p.keyName}=${key}\n`, { mode: 0o600 });
  }
  for (const name of values.skill) {
    cpSync(join(spikeDir, 'skills', name), join(home, 'skills', 'clinic', name), {
      recursive: true,
    });
  }
  if (values['memory-seed']) {
    cpSync(values['memory-seed'], join(home, 'memories', 'MEMORY.md'));
  }
}

if (!existsSync(home)) seedHome();
const turn =
  (existsSync(join(runDir, 'turns'))
    ? JSON.parse(readFileSync(join(runDir, 'turns'), 'utf8'))
    : 0) + 1;
writeFileSync(join(runDir, 'turns'), String(turn));
const usageFile = join(runDir, `usage-${turn}.json`);

const args = [
  'run',
  '--rm',
  '--init',
  '-v',
  `${spikeDir}:/spike`,
  '-w',
  '/tmp',
  '-e',
  `HERMES_HOME=${inContainer(home)}`,
  '-e',
  'HERMES_DISABLE_LAZY_INSTALLS=1',
  '-e',
  'TZ=UTC',
  '--entrypoint',
  '/opt/hermes/bin/hermes',
  IMAGE,
  '-z',
  prompt,
  '-m',
  model,
  '--provider',
  p.provider,
  '-t',
  values.toolsets,
  '--usage-file',
  inContainer(usageFile),
  ...values.preload.flatMap((name) => ['-s', name]),
  ...(values.resume ? ['--resume', values.resume] : []),
];

const started = Date.now();
const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180_000 });
const usage = existsSync(usageFile) ? JSON.parse(readFileSync(usageFile, 'utf8')) : null;
console.log(
  JSON.stringify(
    {
      run,
      turn,
      exit: result.status,
      seconds: (Date.now() - started) / 1000,
      reply: result.stdout.trim(),
      stderr: result.stderr.trim().slice(-2000),
      usage,
    },
    null,
    2,
  ),
);
