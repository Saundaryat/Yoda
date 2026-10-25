import { createEvaluationApp } from './app.ts';
import { graderVersion } from '../../packages/eval-engine/graders.ts';
import { Store } from './store.ts';
import { loadSavedEvidence } from './saved-evidence.ts';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
const readOnly = process.env.EVAL_REVIEW_ONLY === '1';
const store = new Store();
if (readOnly) {
  await store.migrate();
  await store.seed();
  await loadSavedEvidence(store, 'output/experiments/7454dcc5-0a02-4998-af58-7163ba001d94');
  const id = await loadSavedEvidence(store);
  console.log(`Saved real evidence review ${id}; ${graderVersion} offline grades; no new model calls.`);
}
const app = await createEvaluationApp({ store, readOnly });
await app.listen(port, '127.0.0.1');
console.log(`Evaluation API listening on http://127.0.0.1:${port}/api`);
