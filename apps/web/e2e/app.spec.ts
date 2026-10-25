import { expect, test } from '@playwright/test';

test('a stale page chunk recovers at the intended destination after a rebuild', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment', exact: false }).click();
  await page.getByRole('button', { name: /Scenarios/ }).click();
  let interrupted = false;
  await page.route('**/assets/CompareView-*.js', (route) => {
    if (!interrupted) {
      interrupted = true;
      return route.abort();
    }
    return route.continue();
  });
  await page
    .getByTestId('scenario-qualify-and-book')
    .getByRole('link', { name: 'Compare runs' })
    .click();
  await expect(page.getByRole('heading', { name: 'Checks, side by side' })).toBeVisible();
  expect(interrupted).toBe(true);
});

test('rescored results distinguish replay usage from original conversations and CRM calls', async ({
  page,
}) => {
  const experiments = await (await page.request.get('/api/experiments')).json();
  const e = experiments.find((item: { name: string }) => item.name === 'E2E skill experiment');
  await page.route(`**/api/experiments/${e.id}`, (route) =>
    route.fulfill({
      json: {
        ...e,
        rescoring: {
          sourceExperimentId: e.id,
          evaluatorVersion: 'test-replay',
          judgeOnlyCostUsd: 1,
        },
      },
    }),
  );
  await page.goto(`/experiments/${e.id}`);
  await page.getByRole('button', { name: 'Metrics & evidence', exact: true }).click();
  await expect(
    page.getByText('New agent cost per rescore (excludes judge)', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Original conversation time per run', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Hermes-native tools', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/CRM calls are shown in each run/)).toBeVisible();
});

test('incomplete comparisons pair actual repetition numbers and preserve run deep links', async ({
  page,
}) => {
  const experiments = await (await page.request.get('/api/experiments')).json();
  const e = experiments.find((item: { name: string }) => item.name === 'E2E skill experiment');
  const results = await (await page.request.get(`/api/experiments/${e.id}/results`)).json();
  const task = results.tasks[0];
  const originalRuns = await (await page.request.get(`/api/experiments/${e.id}/runs`)).json();
  const a2 = originalRuns.find(
    (run: { taskId: string; configId: string; repetition: number }) =>
      run.taskId === task.taskId && run.configId === e.baselineConfigId && run.repetition === 2,
  );
  await page.route(`**/api/experiments/${e.id}/runs`, (route) =>
    route.fulfill({
      json: originalRuns.filter(
        (run: { taskId: string; configId: string; repetition: number }) =>
          !(
            run.taskId === task.taskId &&
            run.configId === e.baselineConfigId &&
            run.repetition === 1
          ),
      ),
    }),
  );
  await page.goto(`/experiments/${e.id}/tasks/${task.taskId}`);
  const a = page.getByRole('region', { name: 'A conversation', exact: true });
  const b = page.getByRole('region', { name: 'B conversation', exact: true });
  await expect(a).toContainText('No run recorded');
  await expect(a.getByRole('link', { name: 'Open run' })).toHaveCount(0);
  await expect(b.getByRole('link', { name: 'Open run' })).toHaveAttribute(
    'href',
    `/runs/${task.b[0].runId}`,
  );
  await page.getByRole('button', { name: '2', exact: true }).click();
  await expect(a.getByRole('link', { name: 'Open run' })).toHaveAttribute('href', `/runs/${a2.id}`);
  await a.getByRole('link', { name: 'Open run' }).click();
  await page.getByRole('link', { name: 'Compare A and B on this task' }).click();
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(a.getByRole('link', { name: 'Open run' })).toHaveAttribute('href', `/runs/${a2.id}`);
});

test('invalid links and setup failures offer recovery without losing form inputs', async ({
  page,
}) => {
  await page.goto('/not-a-real-page');
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to experiments' }).click();
  await page.getByRole('link', { name: 'Manage configurations →' }).click();
  await page.getByRole('link', { name: 'Copy', exact: true }).first().click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/\(copy\)$/);
  await page.getByLabel('Name', { exact: true }).fill('Preserve this draft');
  await page.route('**/api/configurations', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { message: 'Temporary save failure' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByText('Temporary save failure', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Preserve this draft');
  await expect(page.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
});

test('missing scenario comparisons explain the problem rather than rendering a blank page', async ({
  page,
}) => {
  const experiments = await (await page.request.get('/api/experiments')).json();
  await page.goto(`/experiments/${experiments[0].id}/tasks/00000000-0000-4000-8000-000000000000`);
  await expect(
    page.getByRole('heading', { name: 'Scenario not in this experiment' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to experiment', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Experiments', exact: true }),
  ).toHaveClass(/section-active/);
});

test('setup pages review choices, validate inputs and fit narrow screens without creating records', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(request.url());
  });
  await page.route('**/api/experiments', async (route) => {
    const response = await route.fetch();
    const [base] = await response.json();
    await route.fulfill({
      json: [
        {
          ...base,
          leadMode: 'scripted',
          rescoring: undefined,
          counts: { ...base.counts, scored: 28 },
          costUsd: 4.2,
        },
        {
          ...base,
          leadMode: 'scripted',
          rescoring: { sourceExperimentId: base.id },
          counts: { ...base.counts, scored: 120 },
          costUsd: 0.01,
        },
      ],
    });
  });
  await page.goto('/experiments/new');
  await page.getByRole('button', { name: 'Dev only (7)' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Test policy loading');
  await page.getByLabel('A — baseline').selectOption({ label: 'Baseline' });
  await page.getByLabel('B — candidate').selectOption({ label: 'Baseline + clinic skill' });
  await expect(page.getByText('Settings that differ', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Experiment review' })).toContainText(
    'about $6.30',
  );
  await expect(page.getByRole('button', { name: 'Create experiment' })).toBeEnabled();
  await page.getByLabel('Repetitions per task and configuration').fill('1.5');
  await expect(page.getByRole('button', { name: 'Create experiment' })).toBeDisabled();
  for (const width of [375, 677, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
  await page.goto('/configurations/new');
  await expect(page.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('New policy version');
  await page.getByLabel('Model', { exact: true }).fill('test-model');
  await page.getByLabel('Instructions', { exact: true }).fill('Reply only to the customer.');
  await page.getByRole('checkbox', { name: /Enable memory/ }).check();
  await page.getByText('Advanced tool settings', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Configuration review' })).toContainText(
    'Memory on',
  );
  await expect(page.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
  for (const width of [375, 677, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    const sections = await page.locator('.configuration-step').evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left };
      }),
    );
    expect(sections).toHaveLength(5);
    for (let step = 1; step < sections.length; step++) {
      expect(sections[step]!.top).toBeGreaterThan(sections[step - 1]!.top);
      expect(Math.abs(sections[step]!.top - sections[step - 1]!.bottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(sections[step]!.left - sections[step - 1]!.left)).toBeLessThanOrEqual(1);
    }
  }
  expect(writes).toEqual([]);
});

test('comparison evidence targets the correct arm without showing unrelated tool activity', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();
  await page.getByRole('button', { name: /Scenarios/ }).click();
  await page
    .getByTestId('scenario-qualify-and-book')
    .getByRole('link', { name: 'Compare runs' })
    .click();
  await expect(page.getByRole('heading', { name: 'Checks, side by side' })).toBeVisible();
  const checkTable = page.locator('table').first();
  await checkTable.locator('tbody tr').first().locator('td').nth(1).locator('summary').click();
  await page.getByRole('button', { name: 'Show A evidence', exact: true }).first().click();
  const aHighlight = page.locator('[id^="a-event-"].highlight');
  await expect(aHighlight.first()).toBeInViewport();
  await expect(page.locator('[id^="b-event-"].highlight')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'B conversation', exact: true }).locator('.event.tool'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Show tool calls and internal notes' }).first(),
  ).not.toBeChecked();
  // DOM ids remain unambiguous even when both conversations use the same sequence numbers.
  const ids = await page.locator('.event[id]').evaluateAll((els) => els.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  await checkTable.locator('tbody tr').first().locator('td').nth(2).locator('summary').click();
  await page.getByRole('button', { name: 'Show B evidence', exact: true }).first().click();
  await expect(page.locator('[id^="b-event-"].highlight').first()).toBeInViewport();
  const differences = await checkTable.locator('tr.differs').count();
  await page.getByRole('checkbox', { name: 'Only different results' }).check();
  await expect(checkTable.locator('tbody tr')).toHaveCount(differences + (differences ? 1 : 2));
});

test('configuration and scenario details keep technical data readable on small screens', async ({
  page,
}) => {
  await page.goto('/configurations');
  await page.getByRole('heading', { level: 2 }).first().getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Saved configuration' })).toBeVisible();
  await page.getByText('Version details & original name', { exact: true }).click();
  await page.getByText('View saved settings (JSON)', { exact: true }).click();
  for (const width of [375, 677, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Development scenarios', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Development scenarios', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('tbody a').first().click();
  await expect(page.getByRole('heading', { name: 'How it is scored' })).toBeVisible();
  await page.getByText('View rule', { exact: true }).first().click();
  await page.getByText('View starting CRM data', { exact: true }).click();
  for (const width of [375, 677, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});

test('history filter stays attached to its label and result cards fit desktop and mobile', async ({
  page,
}) => {
  await page.goto('/');
  const toggle = page.getByRole('checkbox', {
    name: 'Show development checks and replaced scores',
  });
  // Loading the count moves the toolbar. Measure both elements after results settle.
  await expect(page.locator('.experiment-card').first()).toBeVisible();
  for (const width of [1440, 677, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const input = await toggle.boundingBox();
    const label = await page.getByText('Include historical results', { exact: true }).boundingBox();
    expect(input!.width).toBeLessThanOrEqual(20);
    expect(label!.x - input!.x - input!.width).toBeLessThanOrEqual(12);
    expect(Math.abs(input!.y + input!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(4);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});

test('workflow explains the reading order and separates corrected scores from history', async ({
  page,
}) => {
  await page.route('**/api/experiments', async (route) => {
    const response = await route.fetch();
    const [base] = await response.json();
    await route.fulfill({
      json: [
        {
          ...base,
          id: '76190125-ae2f-4db2-ae07-7dc99a15cf66',
          correctedExperimentId: undefined,
          rescoring: {
            sourceExperimentId: 'a14ded53-7c33-4f61-addf-931c1bd9ebf0',
            evaluatorVersion: 'clinical-grounding-v3',
            judgeOnlyCostUsd: 2,
          },
        },
        {
          ...base,
          id: 'a14ded53-7c33-4f61-addf-931c1bd9ebf0',
          rescoring: undefined,
          correctedExperimentId: '76190125-ae2f-4db2-ae07-7dc99a15cf66',
        },
        {
          ...base,
          id: '185acbbc-5a9b-4bc5-a8e9-27e891cd6bf2',
          rescoring: undefined,
          correctedExperimentId: undefined,
        },
      ],
    });
  });
  await page.goto('/');
  const workflow = page.getByRole('navigation', { name: 'Evaluation workflow' });
  await expect(workflow.getByRole('link', { name: '1. Agent versions' })).toBeVisible();
  const cards = page.locator('.experiment-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('01 · Does access to the clinic policy help?');
  await expect(cards.last()).toContainText('no new agent run');
  await page.getByRole('checkbox', { name: 'Show development checks and replaced scores' }).check();
  await expect(cards).toHaveCount(3);
  await expect(page.getByText('Original scores · replaced by a correction')).toBeVisible();
});

test('experiment configuration and task names open their saved details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();
  await expect(page).toHaveURL(/\/experiments\/[\da-f-]+$/);
  const experimentUrl = page.url();
  const versions = page.getByRole('region', { name: 'Compared agent versions' });
  for (const name of ['Baseline', 'Baseline + clinic skill']) {
    await versions.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/configurations\/[\da-f-]+$/);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Instructions', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Full configuration' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.goto(experimentUrl);
  }
  await page.getByRole('button', { name: /Scenarios/ }).click();
  const clinical = page.getByTestId('scenario-clinical-escalation');
  const title = await clinical.getByRole('heading').innerText();
  await clinical.getByRole('link', { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[\da-f-]+$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it is scored' })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: /Scenarios/ }).click();
  await clinical.getByRole('link', { name: 'Compare runs' }).click();
  await expect(page.getByRole('heading', { name: 'Checks, side by side' })).toBeVisible();
});

test('a reviewer can go from the verdict down to why a run failed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();

  // The overview explains the experiment before presenting its verdict.
  await expect(page.getByRole('link', { name: 'Back to experiments' })).toBeVisible();
  await expect(page.getByText(/Setup & hypothesis/)).toBeVisible();
  await expect(page.getByText(/B passed \d+%/)).toBeVisible();
  await page.getByText('Confidence & methodology').click();
  await expect(page.getByRole('img', { name: /Difference .* points, 95% interval/ })).toBeVisible();
  await page.getByRole('button', { name: 'Metrics & evidence' }).click();
  await expect(page.getByText('skill_view', { exact: true })).toBeVisible();

  // A failed baseline run says which check failed and why.
  await page.getByRole('button', { name: /Scenarios/ }).click();
  const clinical = page.getByTestId('scenario-clinical-escalation');
  await clinical.getByRole('link', { name: '✗' }).first().click();
  await expect(page.getByText('Why it failed:')).toBeVisible();
  await expect(page.getByText('escalate_to_human never called').first()).toBeVisible();

  // Side-by-side comparison shows B opened the skill.
  await page.getByRole('link', { name: 'Compare A and B on this task' }).click();
  await expect(page.getByRole('heading', { name: 'Checks, side by side' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show tool calls and internal notes' }).last().check();
  await expect(page.locator('summary', { hasText: 'skill_view' }).first()).toBeVisible();
});

test("a check's evidence button highlights the exact event", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();
  await page.getByRole('button', { name: /Scenarios/ }).click();
  const booking = page.getByTestId('scenario-qualify-and-book');
  await booking.getByRole('link', { name: '✓' }).first().click();
  await page
    .getByRole('button', { name: /Show in conversation/ })
    .first()
    .click();
  await expect(page.locator('.event.highlight').first()).toBeInViewport();
});

test('a configuration can be copied and saved as a new one', async ({ page }) => {
  await page.goto('/configurations');
  await page.getByRole('link', { name: 'Copy' }).first().click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/\(copy\)$/);
  await page.getByLabel('Name', { exact: true }).fill('Memory on');
  await page.getByRole('checkbox', { name: /Enable memory/ }).check();
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByRole('heading', { name: 'Memory on' })).toBeVisible();
});

test('a new experiment is a draft until it is started', async ({ page }) => {
  await page.goto('/experiments/new');
  await page.getByRole('button', { name: 'Dev only (7)' }).click();
  await expect(page.getByText(/Only 7 scenarios selected/)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Draft only');
  await page.getByLabel(/A — baseline/).selectOption({ label: 'Baseline' });
  await page.getByLabel(/B — candidate/).selectOption({ label: 'Baseline + clinic skill' });
  await expect(page.getByText(/runs \(\d+ tasks × 2 configurations × 3\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Create experiment' }).click();
  await expect(page.getByText('This experiment has not started.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start \d+ runs/ })).toBeVisible();
});

test('the experiments list publishes results and completed runs do not look like 100% success', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.getByRole('link', { name: /E2E skill experiment/ });
  await expect(card.getByLabel('Experiment result')).toContainText('A pass rate');
  await expect(card.getByLabel('Experiment result')).toContainText('B pass rate');
  await expect(card.getByLabel('Experiment result')).toContainText('B scored higher');
  await expect(card.locator('.progress-track')).toHaveCount(0);
  await card.click();
  await expect(page.getByText('Expected outcome', { exact: true })).toHaveCount(0);
  await expect(page.locator('.bar')).toHaveCount(0);
});

test('run and A/B evidence fit small screens, including revealed tool results', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('link', { name: /E2E skill experiment/ }).click();
  await page.getByRole('button', { name: /Scenarios/ }).click();
  await page
    .getByTestId('scenario-clinical-escalation')
    .getByRole('link', { name: '✗' })
    .first()
    .click();
  await page.getByRole('checkbox', { name: 'Show tool calls and internal notes' }).check();
  for (const compare of [false, true]) {
    if (compare) {
      await page.getByRole('link', { name: 'Compare A and B on this task' }).click();
      await page
        .getByRole('checkbox', { name: 'Show tool calls and internal notes' })
        .first()
        .check();
    }
    await page.waitForLoadState('networkidle');
    for (const width of [375, 677, 1280]) {
      await page.setViewportSize({ width, height: 812 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        `width ${width}, compare ${compare}`,
      ).toBeLessThanOrEqual(0);
      if (compare) {
        const checkRatio = await page.locator('.comparison-checks table').evaluate((table) => {
          const first = table.querySelector('th')!;
          return first.getBoundingClientRect().width / table.getBoundingClientRect().width;
        });
        expect(checkRatio).toBeGreaterThanOrEqual(0.35);
      }
    }
  }
});

test('pages fit a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/tasks', '/configurations', '/experiments/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
