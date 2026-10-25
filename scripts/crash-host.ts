import { writeFileSync } from 'node:fs';
import { runHermes } from '../packages/hermes/runner.ts';
const [runId, checkpoint] = process.argv.slice(2);
if (!runId || !checkpoint) throw new Error('Crash host requires run ID and checkpoint file');
let group: unknown;
await runHermes({ runId, onCheckpoint: async (_initial, _final, runtime) => {
  group = runtime.processGroupId;
  writeFileSync(checkpoint, JSON.stringify({ parentPid: process.pid, processGroupId: runtime.processGroupId }));
}, onReady: async () => {
  writeFileSync(checkpoint, JSON.stringify({ parentPid: process.pid, processGroupId: group, gatewayReady: true }));
  // Crash lifecycle verification must not depend on another billable model call.
  await new Promise(() => {});
} });
