import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
const api = process.env.EVAL_API_URL ?? 'http://127.0.0.1:3001/api';
let experiment: any;
for (let attempt = 0; attempt < 30; attempt++) {
  const experiments = await (await fetch(`${api}/experiments`)).json();
  experiment = experiments.find((e: any) => e.snapshot.evidenceProvenance?.sourceExperimentId === 'b4df0b6e-35ff-4db2-a7ec-1de92db49f46'
    && e.snapshot.graderVersion === 'clinic-deterministic-v4.2');
  if (experiment && ['completed', 'failed', 'cancelled'].includes(experiment.status)) break;
  await delay(1000);
}
assert.ok(experiment, 'Start npm run review to load the current saved real experiment.');
const results = await (await fetch(`${api}/experiments/${experiment.id}/results`)).json();
assert.deepEqual(results.configurations.map((c: any) => c.passed), [14, 13]);
const detail = await (await fetch(`${api}/experiments/${experiment.id}`)).json();
const local = '/Users/saundarya/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const directory = resolve('output/demo'); mkdirSync(directory, { recursive: true });
const recordings = mkdtempSync(resolve(tmpdir(), 'tracework-video-'));
const browser = await chromium.launch({ executablePath: process.env.EVAL_CHROMIUM ?? (existsSync(local) ? local : undefined), slowMo: 250 });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: recordings, size: { width: 1440, height: 1000 } } });
const page = await context.newPage();
const video = page.video()!;
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
async function caption(text: string, duration = 4500) {
  await page.evaluate(text => {
    let el = document.getElementById('demo-caption');
    if (!el) { el = document.createElement('div'); el.id = 'demo-caption'; document.body.append(el); }
    el.textContent = text;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;background:#142a23ed;color:white;padding:13px 25px;border-radius:9px;font:14px system-ui;box-shadow:0 6px 30px #0003;max-width:900px;text-align:center;pointer-events:none';
  }, text);
  await page.waitForTimeout(duration);
}
try {
  await page.goto(process.env.EVAL_WEB_URL ?? 'http://127.0.0.1:5173');
  await page.locator('.experiment-item').filter({ hasText: experiment.id.slice(0, 8) }).click();
  await caption('Tracework: a working NestJS + Vue platform showing saved real Hermes runs. This walkthrough makes no model calls.', 6500);
  await caption('Current v4.2 offline replay: A passes 14/16; B passes 13/16. Eight attempts hit provider rate limits; 16/20 task pairs are valid.', 7500);
  await page.screenshot({ path: resolve(directory, 'comparison.png') });
  await page.getByText('Configuration differences', { exact: false }).click();
  await caption('The saved A/B prompts differ in stale-slot recovery: hand off, or re-search and obtain fresh consent. New prompt fixes await fresh model validation.', 7000);
  await page.getByText('Configuration differences', { exact: false }).click();
  await page.getByRole('combobox', { name: 'Run filter', exact: true }).selectOption('failures');
  await caption('Five graded failures remain, plus eight infrastructure errors. B has two hard failures. High diagnostic scores cannot override required failures.', 6500);
  const failures = detail.runs.filter((run: any) => run.grade?.status === 'failed' || ['infra_error', 'agent_failed', 'ungradable'].includes(run.status));
  const index = failures.findIndex((run: any) => run.runtime?.sourceRunId === 'ddcf2b90-6343-4ea7-8834-28674df139c6');
  assert.ok(index >= 0);
  const failed = page.getByRole('button', { name: 'Inspect run', exact: true }).nth(index);
  if (await failed.count()) {
    await failed.click();
    await caption('A genuine B failure: the saved trace attempts confirmation with a slot ID instead of the appointment ID. CRM rejects delivery.', 6500);
    await page.getByRole('button', { name: 'Grades', exact: true }).click();
    await caption('Deterministic graders explain what failed and link to CRM and calendar evidence.', 5500);
    const evidence = page.locator('.assertion').filter({ hasText: 'truthful confirmation' }).getByRole('button', { name: 'event-16 ↗', exact: true });
    if (await evidence.count()) { await evidence.click(); await caption('Full tool arguments and results are retained—even rejected attempts.', 5500); }
    await page.screenshot({ path: resolve(directory, 'run-inspector.png') });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Task suites', exact: true }).click();
  await page.getByRole('button', { name: /20 frozen cases/ }).click();
  await caption('Twenty frozen cases cover qualification, consent, recovery, opt-out, escalation, and untrusted notes.', 6000);
  await page.getByRole('button', { name: 'Methodology', exact: true }).click();
  await caption('The comparison uses whole-task bootstrap intervals. Limited evidence is reported as inconclusive.', 6500);
  assert.deepEqual(errors, [], 'Recorded UI must have no uncaught browser errors');
} finally {
  await context.close();
  await video.saveAs(resolve(directory, 'tracework-demo.webm'));
  await browser.close();
  rmSync(recordings, { recursive: true, force: true });
}
writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({ recordedAt: new Date().toISOString(), experimentId: experiment.id,
  sourceExperimentId: experiment.snapshot.evidenceProvenance.sourceExperimentId, sourceReportSha256: experiment.snapshot.evidenceProvenance.sourceReportSha256,
  graderVersion: experiment.snapshot.graderVersion, actualUI: true, newInference: false, workflowRevisionValidated: false,
  passes: [14, 13], validPerConfiguration: 16, infrastructureErrors: 8, narration: 'On-screen captions; saved real inference with v4.2 offline grades, no synthetic result data', video: 'tracework-demo.webm' }, null, 2));
console.log(`Demo saved: ${resolve(directory, 'tracework-demo.webm')}`);
