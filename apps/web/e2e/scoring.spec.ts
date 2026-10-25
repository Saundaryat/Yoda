import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

async function fixture(request: APIRequestContext) {
  const experiments = await (await request.get('/api/experiments')).json();
  const experiment = experiments.find((e: { name: string }) => e.name === 'E2E skill experiment');
  const results = await (await request.get(`/api/experiments/${experiment.id}/results`)).json();
  const runs = await (await request.get(`/api/experiments/${experiment.id}/runs`)).json();
  return { experiment, results, runs };
}

test('a run missing critical judgment is Needs grading and never Passed with score 100', async ({
  page,
}) => {
  const { runs } = await fixture(page.request);
  const run = runs.find((r: { passed: boolean }) => r.passed);
  const detail = await (await page.request.get(`/api/runs/${run.id}`)).json();
  await page.route(`**/api/runs/${run.id}`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        run: { ...detail.run, passed: null, score: null, judge: null },
        checks: detail.checks.map((c: { critical: boolean }) =>
          c.critical
            ? {
                ...c,
                passed: false,
                skipped: true,
                detail: 'Not judged: required judgment unavailable',
              }
            : c,
        ),
      },
    }),
  );
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.page-head .badge')).toHaveText('Needs grading');
  await expect(page.locator('.why')).toContainText(
    'no final score and is excluded from the comparison',
  );
  await expect(page.getByText(/Passed · score 100/)).toHaveCount(0);
  await expect(page.locator('.checks .skipped').first()).toBeVisible();
});

test('an experiment with completed conversations but no critical judgments stays Incomplete', async ({
  page,
}) => {
  const { experiment, results } = await fixture(page.request);
  await page.route(`**/api/experiments/${experiment.id}/results`, (route) =>
    route.fulfill({
      json: {
        ...results,
        comparison: {
          ...results.comparison,
          verdict: 'incomplete',
          complete: false,
          pairedTasks: 0,
          incompleteReason: 'Required grading is missing.',
          comparisonVersion: 'paired-task-bootstrap-v2',
        },
        coverage: {
          ...results.coverage,
          scoredRuns: 0,
          ungradedRuns: results.coverage.plannedRuns,
        },
        tasks: results.tasks.map((t: object) => ({ ...t, a: [], b: [] })),
      },
    }),
  );
  await page.goto(`/experiments/${experiment.id}`);
  await expect(page.locator('.verdict .badge').first()).toHaveText('Incomplete');
  await expect(page.getByRole('heading', { name: 'Required grading is missing.' })).toBeVisible();
  await expect(page.locator('.rate-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Metrics & evidence', exact: true }).click();
  await expect(page.getByText(/need grading and are excluded from the comparison/)).toBeVisible();
});

test('paired task presence cannot disguise missing repetitions or a gain below the practical margin', async ({
  page,
}) => {
  const { experiment, results } = await fixture(page.request);
  let incomplete = true;
  await page.route(`**/api/experiments/${experiment.id}/results`, (route) =>
    route.fulfill({
      json: {
        ...results,
        comparison: {
          ...results.comparison,
          comparisonVersion: 'paired-task-bootstrap-v2',
          pairedTasks: 20,
          plannedTasks: 20,
          complete: !incomplete,
          verdict: incomplete ? 'incomplete' : 'no_meaningful_difference',
          incompleteReason: incomplete
            ? 'Every planned repetition on both versions must have complete grading, and the experiment must be finished.'
            : undefined,
          difference: 0.05,
          passRateA: 0.7,
          passRateB: 0.75,
          ci: [0.01, 0.08],
          practicalMargin: 0.1,
        },
        coverage: { ...results.coverage, plannedRuns: 120, scoredRuns: incomplete ? 40 : 120 },
      },
    }),
  );
  await page.goto(`/experiments/${experiment.id}`);
  await expect(page.locator('.verdict .badge').first()).toHaveText('Incomplete');
  await expect(page.getByRole('heading', { name: /Every planned repetition/ })).toBeVisible();
  await page.getByRole('button', { name: 'Metrics & evidence', exact: true }).click();
  await expect(page.getByText(/40 of 120 planned runs have complete grading/)).toBeVisible();
  incomplete = false;
  await page.reload();
  await expect(page.locator('.verdict .badge').first()).toHaveText('B scored higher');
  await page.getByText('Confidence & methodology', { exact: true }).click();
  await expect(page.locator('.confidence-assessment')).toContainText('No meaningful difference');
  await expect(page.getByText(/practical margin of ±10 pts/)).toBeVisible();
  await expect(page.getByText(/Comparison paired-task-bootstrap-v2/)).toBeVisible();
});

test('a scoring-only regrade distinguishes v4 rules from saved v3 judgments and reports zero flips', async ({
  page,
}) => {
  const { experiment } = await fixture(page.request);
  await page.route(`**/api/experiments/${experiment.id}`, (route) =>
    route.fulfill({
      json: {
        ...experiment,
        rescoring: {
          sourceExperimentId: experiment.id,
          evaluatorVersion: 'clinical-grounding-v4',
          mode: 'score-only',
          sourceJudgeVersions: ['clinical-grounding-v3'],
          judgeOnlyCostUsd: 0,
          changes: { passToFail: 0, failToPass: 0, unchanged: 120, ungraded: 0, scoreChanges: 0 },
        },
      },
    }),
  );
  await page.goto(`/experiments/${experiment.id}`);
  const notice = page.locator('.notice').first();
  await expect(notice).toContainText('Corrected scoring · clinical-grounding-v4');
  await expect(notice).toContainText('clinical-grounding-v3 judgments');
  await expect(notice).toContainText('No new model calls or spend');
  await expect(notice).toContainText(
    '0 pass → fail; 0 fail → pass; 120 unchanged pass/fail outcomes; 0 numeric scores changed; 0 need grading',
  );
});

test('fresh rejudging shows grade transitions, old/new reasons and exact run evidence links', async ({
  page,
}) => {
  const { experiment, runs } = await fixture(page.request);
  const a = runs[0],
    b = runs[1];
  await page.route(`**/api/experiments/${experiment.id}`, (route) =>
    route.fulfill({
      json: {
        ...experiment,
        rescoring: {
          sourceExperimentId: experiment.id,
          evaluatorVersion: 'clinical-grounding-v4',
          mode: 'judge-and-score',
          judgeOnlyCostUsd: 0.25,
        },
      },
    }),
  );
  const reason = {
    checkId: 'reply-grounded',
    label: 'Claims backed by CRM',
    critical: true,
    previous: {
      passed: true,
      skipped: false,
      detail: 'All replies backed by tools.',
      evidence: [],
    },
    current: {
      passed: false,
      skipped: false,
      detail: 'Unsupported saved-note claim: "I saved it".',
      evidence: [{ eventSeq: 5 }],
    },
  };
  await page.route(`**/api/experiments/${experiment.id}/grade-changes`, (route) =>
    route.fulfill({
      json: {
        sourceExperimentId: experiment.id,
        evaluatorVersion: 'clinical-grounding-v4',
        mode: 'judge-and-score',
        comparedRuns: 120,
        unmatchedRuns: 0,
        passToFail: 1,
        failToPass: 1,
        scoreOnlyChanges: 0,
        unchanged: 118,
        changes: [
          {
            runId: a.id,
            sourceRunId: b.id,
            taskId: a.taskId,
            taskKey: 'updated-availability',
            taskTitle: 'Use latest preference',
            side: 'A',
            repetition: 2,
            previousPassed: true,
            passed: false,
            previousScore: 100,
            score: 75,
            reasons: [reason],
          },
          {
            runId: b.id,
            sourceRunId: a.id,
            taskId: b.taskId,
            taskKey: 'morning-booking',
            taskTitle: 'Book morning',
            side: 'B',
            repetition: 1,
            previousPassed: false,
            passed: true,
            previousScore: 75,
            score: 100,
            reasons: [{ ...reason, previous: reason.current, current: reason.previous }],
          },
        ],
      },
    }),
  );
  await page.goto(`/experiments/${experiment.id}`);
  const review = page.getByRole('region', { name: 'Grade changes from previous evaluation' });
  await expect(review).toContainText('Fresh model judgments under clinical-grounding-v4');
  await expect(review).toContainText('1 pass → fail');
  await page.getByLabel('Filter grade changes').selectOption('regressions');
  await expect(review.locator('article')).toHaveCount(1);
  const regression = page.getByTestId(`grade-change-${a.id}`);
  await regression.getByText('Why the grade changed', { exact: true }).click();
  await expect(regression).toContainText('All replies backed by tools.');
  await expect(regression).toContainText('Unsupported saved-note claim: "I saved it".');
  await expect(regression).toContainText('message/tool #5');
  await expect(
    regression.getByRole('link', { name: 'Open current run and evidence →' }),
  ).toHaveAttribute('href', `/runs/${a.id}`);
  for (const width of [375, 677, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
  await page.getByLabel('Filter grade changes').selectOption('improvements');
  await expect(review.locator('article')).toHaveCount(1);
  await expect(page.getByTestId(`grade-change-${b.id}`)).toBeVisible();
});

test('a v5 CRM evidence failure retains the original model verdict and Jev probabilities', async ({
  page,
}) => {
  const { runs } = await fixture(page.request);
  const detail = await (await page.request.get(`/api/runs/${runs[0].id}`)).json();
  const agent = detail.events.find((e: { kind: string }) => e.kind === 'agent');
  const evidenceRule = {
    id: 'availability-evidence-v1',
    severity: 'serious',
    evidenceSeqs: [],
    modelVerdict: { pass: true, quote: '', reason: 'Original model pass', verified: true },
  };
  const severity = {
    label: 'minor',
    confidence: 0.9,
    probabilities: { minor: 0.95, serious: 0.05 },
    model: 'jev',
  };
  await page.route(`**/api/runs/${runs[0].id}`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        run: {
          ...detail.run,
          passed: false,
          score: 75,
          judge: {
            ...detail.run.judge,
            evaluatorVersion: 'evidence-grounding-v5',
            turns: [
              {
                eventSeq: agent.seq,
                act: 'offers_options',
                audience: { pass: true, quote: '', reason: '', verified: true },
                format: { pass: true, quote: '', reason: '', verified: true },
                grounded: {
                  pass: false,
                  quote: agent.text,
                  reason: 'No prior slot search.',
                  verified: true,
                  evidenceRule,
                  severity,
                },
                issues: [
                  {
                    label: 'unbacked_claim',
                    quote: agent.text,
                    reason: 'No prior slot search.',
                    evidenceRule,
                    severity,
                  },
                ],
              },
            ],
          },
        },
        checks: [
          {
            checkId: 'reply-grounded',
            type: 'reply_judge',
            label: 'Grounding',
            weight: 2,
            critical: true,
            passed: false,
            detail: 'No prior slot search.',
            evidence: [{ eventSeq: agent.seq }],
          },
        ],
      },
    }),
  );
  await page.goto(`/runs/${runs[0].id}`);
  await expect(page.locator('.page-head .badge')).toContainText('Failed');
  const event = page.locator(`#event-${agent.seq}`);
  await event.getByText('Review scoring evidence', { exact: true }).click();
  await expect(event).toContainText('CRM evidence rule: serious');
  await expect(event).toContainText('Jev: minor');
  await expect(event).toContainText('p(minor) 95%');
  await event.getByText('Original model assessment', { exact: true }).click();
  await expect(event).toContainText('Before the CRM check: Pass. Original model pass');
});

test('a focused rejudge clearly identifies its subset and preserves the full-suite context', async ({
  page,
}) => {
  const { experiment } = await fixture(page.request);
  await page.route(`**/api/experiments/${experiment.id}`, (route) =>
    route.fulfill({
      json: {
        ...experiment,
        rescoring: {
          sourceExperimentId: experiment.id,
          evaluatorVersion: 'evidence-grounding-v5',
          mode: 'judge-and-score',
          judgeOnlyCostUsd: 1,
          scope: {
            kind: 'task-subset',
            taskKeys: ['availability'],
            tasks: 15,
            sourceTasks: 20,
            runs: 90,
            sourceRuns: 120,
          },
        },
      },
    }),
  );
  await page.goto(`/experiments/${experiment.id}`);
  const notice = page.locator('.notice').first();
  await expect(notice).toContainText('Focused rejudge: 15 of 20 tasks, 90 of 120 saved runs.');
  await expect(notice).toContainText('The previous full-suite result is preserved.');
  await expect(notice).toContainText('Fresh model judgments on the selected saved conversations');
});

test('a cleared future-plan finding preserves the original accusation for review', async ({
  page,
}) => {
  const { runs } = await fixture(page.request);
  const detail = await (await page.request.get(`/api/runs/${runs[0].id}`)).json();
  const agent = detail.events.find((e: { kind: string }) => e.kind === 'agent');
  await page.route(`**/api/runs/${runs[0].id}`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        run: {
          ...detail.run,
          judge: {
            ...detail.run.judge,
            evaluatorVersion: 'evidence-grounding-v6',
            turns: [
              {
                eventSeq: agent.seq,
                act: 'informs',
                issues: [],
                grounded: {
                  pass: true,
                  quote: '',
                  reason: 'Conditional future intent does not reserve a slot.',
                  verified: true,
                  review: {
                    model: 'claude-sonnet-5-5',
                    basis: 'future_intent',
                    evidenceSeqs: [],
                    modelVerdict: {
                      pass: false,
                      quote: 'I will book it',
                      reason: 'Incorrectly inferred a hold.',
                      verified: true,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    }),
  );
  await page.goto(`/runs/${runs[0].id}`);
  const event = page.locator(`#event-${agent.seq}`);
  await event.getByText('Grounding evidence review', { exact: true }).click();
  await expect(event).toContainText('Original model finding: Incorrectly inferred a hold.');
  await expect(event).toContainText(
    'Reviewed: Pass · Conditional future intent does not reserve a slot.',
  );
  await expect(event).toContainText('I will book it');
});

const observedCases = [
  {
    name: 'B has the higher rate despite uncertain repeatability',
    a: 0.6,
    b: 43 / 60,
    ci: [-1 / 30, 17 / 60],
    tasks: 20,
    label: 'B scored higher',
    headline: 'B scored higher in this test: 72% vs 60%.',
  },
  {
    name: 'A has the higher rate despite uncertain repeatability',
    a: 0.75,
    b: 0.6,
    ci: [-0.32, 0.03],
    tasks: 20,
    label: 'A scored higher',
    headline: 'A scored higher in this test: 75% vs 60%.',
  },
  {
    name: 'equal rates stay a tie despite floating-point noise',
    a: 0.6,
    b: 0.6000000000000001,
    ci: [-0.2, 0.2],
    tasks: 20,
    label: 'Same pass rate',
    headline: 'A and B had the same pass rate in this test: 60%.',
  },
  {
    name: 'limited coverage still reports the observed higher rate',
    a: 0.5,
    b: 0.75,
    ci: [0.05, 0.45],
    tasks: 7,
    label: 'B scored higher',
    headline: 'B scored higher in this test: 75% vs 50%.',
  },
];

for (const sample of observedCases) {
  test(`observed result: ${sample.name}`, async ({ page }) => {
    const { experiment, results } = await fixture(page.request);
    const experiments = await (await page.request.get('/api/experiments')).json();
    const comparison = {
      ...results.comparison,
      verdict: 'inconclusive',
      complete: true,
      passRateA: sample.a,
      passRateB: sample.b,
      difference: sample.b - sample.a,
      ci: sample.ci,
      pairedTasks: sample.tasks,
      plannedTasks: sample.tasks,
    };
    await page.route('**/api/experiments', (route) =>
      route.fulfill({
        json: experiments.map((e: { id: string }) =>
          e.id === experiment.id ? { ...e, result: comparison } : e,
        ),
      }),
    );
    await page.route(`**/api/experiments/${experiment.id}/results`, (route) =>
      route.fulfill({ json: { ...results, comparison } }),
    );
    await page.goto('/');
    const card = page.getByRole('link', { name: /E2E skill experiment/ });
    const published = card.getByLabel('Experiment result');
    await expect(published.locator('.result-decision strong')).toHaveText(sample.label);
    await expect(published).not.toContainText('Inconclusive');
    await expect(published).not.toContainText('No clear winner');
    await card.click();
    await expect(page.locator('.verdict .badge').first()).toHaveText(sample.label);
    await expect(page.locator('.verdict h2')).toHaveText(sample.headline);
    await expect(page.getByText('Inconclusive', { exact: true })).not.toBeVisible();
    await page.getByText('Confidence & methodology', { exact: true }).click();
    await expect(page.locator('.confidence-assessment')).toContainText('Inconclusive');
    await expect(page.getByText(/not enough evidence yet to say/)).toBeVisible();
    await expect(page.getByRole('img', { name: /95% interval/ })).toBeVisible();
    const unchanged = await (
      await page.request.get(`/api/experiments/${experiment.id}/results`)
    ).json();
    expect(unchanged.comparison).toEqual(results.comparison);
  });
}
