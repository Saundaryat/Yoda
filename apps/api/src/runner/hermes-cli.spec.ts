import { configurationSpecSchema } from '@evals/shared';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyTurn, runTurn } from './hermes-cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hermes-usage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const spec = configurationSpecSchema.parse({
  provider: 'openai',
  model: 'test',
  systemPrompt: 'Test',
});
async function invoke(body: string) {
  const bin = join(dir, 'hermes.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nimport {writeFileSync,mkdirSync} from 'node:fs';\nconst args=process.argv.slice(2);\nconst usage=args[args.indexOf('--usage-file')+1];\n${body}\n`,
    { mode: 0o700 },
  );
  return runTurn({
    hermesBin: bin,
    home: dir,
    cwd: dir,
    spec,
    prompt: 'Test',
    resume: null,
    usageFile: join(dir, 'usage.json'),
    timeoutMs: 2000,
  });
}
it.each([
  '{"input_tokens":',
  'null',
  '[]',
  '"text"',
  '{"input_tokens":"100"}',
  '{"estimated_cost_usd":-1}',
  '{"failed":"false"}',
  '{"auxiliary":null}',
])('rejects malformed CLI usage without escaping the subprocess callback: %s', async (content) => {
  await expect(invoke(`writeFileSync(usage, ${JSON.stringify(content)});`)).rejects.toMatchObject({
    kind: 'crash',
    message: 'Hermes usage report is unreadable or invalid',
  });
});
it('handles a usage file read failure as a run error', async () => {
  await expect(invoke('mkdirSync(usage);')).rejects.toMatchObject({ kind: 'crash' });
});
it('preserves the missing-file crash classification', async () => {
  const result = await invoke('');
  expect(result.usage).toBeNull();
  expect(classifyTurn(result)?.kind).toBe('crash');
});
it('accepts valid success and nullable usage fields', async () => {
  const result = await invoke(
    `writeFileSync(usage, JSON.stringify({session_id:'s',input_tokens:100,output_tokens:20,estimated_cost_usd:null,cost_status:'unknown',failed:false,auxiliary:{api_calls:null,estimated_cost_usd:null}}));`,
  );
  expect(classifyTurn(result)).toBeNull();
  expect(result.usage?.session_id).toBe('s');
});
it('preserves valid provider errors and their retry classification', async () => {
  const result = await invoke(
    `writeFileSync(usage, JSON.stringify({failed:true,failure:'HTTP 429 rate limit'}));process.exitCode=2;`,
  );
  expect(classifyTurn(result)?.kind).toBe('rate_limit');
});
