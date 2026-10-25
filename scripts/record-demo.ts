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
  experiment = experiments.find((e: any) => e.snapshot.evidenceProvenance?.sourceExperimentId === '857ce98d-e957-4709-afd8-65f928828fb4'
    && e.snapshot.graderVersion === 'clinic-deterministic-v4.6');
  if (experiment && ['completed', 'failed', 'cancelled'].includes(experiment.status)) break;
  await delay(1000);
}
assert.ok(experiment, 'Start npm run review to load the current saved real experiment.');
const results = await (await fetch(`${api}/experiments/${experiment.id}/results`)).json();
assert.deepEqual(results.configurations.map((c: any) => c.passed), [16, 18]);
const detail = await (await fetch(`${api}/experiments/${experiment.id}`)).json();
const experiments = await (await fetch(`${api}/experiments`)).json();
const correction = experiments.find((e: any) => e.snapshot.evidenceProvenance?.sourceExperimentId === '609e00b1-4434-4d71-9993-c1236109118f' && e.snapshot.graderVersion === 'clinic-deterministic-v4.6');
assert.ok(correction);
const correctedResults = await (await fetch(`${api}/experiments/${correction.id}/results`)).json();
assert.deepEqual(correctedResults.configurations.map((c: any) => c.passed), [2, 2]);
const correctedDetail = await (await fetch(`${api}/experiments/${correction.id}`)).json();
assert.ok(correctedDetail.runs.every((run: any) => run.grade?.status === 'passed' && run.grade.score === 100 && !run.grade.hardFailures.length));

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
  await caption('Anthropic Sonnet 4.6, current v4.6 replay: A passes 16/18; B passes 18/20. Two startup errors leave 18/20 valid pairs.', 7500);
  await page.screenshot({ path: resolve(directory, 'comparison.png') });
  await page.getByText('Configuration differences', { exact: false }).click();
  await caption('The saved A/B prompts differ in stale-slot recovery: hand off, or re-search and obtain fresh consent. Both include the shared reliable-workflow instructions.', 7000);
  await page.getByText('Configuration differences', { exact: false }).click();
  await page.getByRole('combobox', { name: 'Run filter', exact: true }).selectOption('failures');
  await caption('Original full-suite evidence retains four graded failures and two startup errors. B has one original hard failure. High diagnostic scores cannot override required failures.', 6500);
  const failures = detail.runs.filter((run: any) => run.grade?.status === 'failed' || ['infra_error', 'agent_failed', 'ungradable'].includes(run.status));
  const index = failures.findIndex((run: any) => run.runtime?.sourceRunId === '1a04f3b8-a5d1-4493-8781-6880f410d0a5');
  assert.ok(index >= 0);
  const failed = page.getByRole('button', { name: 'Inspect run', exact: true }).nth(index);
  if (await failed.count()) {
    await failed.click();
    await caption('A genuine B failure: the agent tries to book before explicit lead consent. CRM blocks it; later success does not erase the violation.', 6500);
    await page.getByRole('button', { name: 'Grades', exact: true }).click();
    await caption('Deterministic graders explain what failed and link to CRM and calendar evidence.', 5500);
    const evidence = page.locator('.assertion').filter({ hasText: 'explicit consent' }).getByRole('button', { name: 'event-5 ↗', exact: true });
    if (await evidence.count()) { await evidence.click(); await caption('Full tool arguments and results are retained—even rejected attempts.', 5500); }
    await page.screenshot({ path: resolve(directory, 'run-inspector.png') });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  }

  await page.getByRole('combobox', { name: 'Run filter', exact: true }).selectOption('all');
  await page.locator('.experiment-item').filter({ hasText: correction.id.slice(0, 8) }).click();
  await caption('Fresh consent-workflow-v1 rerun: both affected tasks under A and B. Four completed, all pass 100; zero hard failures. These are two targeted pairs, separate from the original suite.', 8000);
  await page.screenshot({ path: resolve(directory, 'consent-correction.png') });
  const correctedIndex = correctedDetail.runs.findIndex((run: any) => run.task_id === 'maybe-is-not-consent' && run.configuration_snapshot.name.startsWith('B'));
  await page.getByRole('button', { name: 'Inspect run', exact: true }).nth(correctedIndex).click();
  await caption('After Maybe, the agent delivers a second slot offer through CRM. A new explicit consent event arrives before the booking attempt.', 8000);
  await page.screenshot({ path: resolve(directory, 'corrected-maybe.png') });
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
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
  graderVersion: experiment.snapshot.graderVersion, actualUI: true, newInference: false, workflowRevision: 'reliable-workflow-v1',
  consentCorrection: { sourceExperimentId: correction.snapshot.evidenceProvenance.sourceExperimentId, sourceReportSha256: correction.snapshot.evidenceProvenance.sourceReportSha256, passes: [2, 2], completed: 4, hardFailures: [0, 0], workflowRevision: 'consent-workflow-v1', separateFromPrimary: true },
  passes: [16, 18], validPerConfiguration: [18, 20], validPairs: 18, infrastructureErrors: 2, narration: 'On-screen captions; saved real inference with v4.6 offline grades, no synthetic result data', video: 'tracework-demo.webm' }, null, 2));
console.log(`Demo saved: ${resolve(directory, 'tracework-demo.webm')}`);
