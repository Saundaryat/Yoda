import { expect, test } from '@playwright/test';

test('a reviewer can go from the verdict down to why a run failed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();

  // The overview explains the experiment before presenting its verdict.
  await expect(page.getByRole('link', { name: 'Back to experiments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /How the \d+ runs are created/ })).toBeVisible();
  await expect(page.getByText(/B passed \d+%/)).toBeVisible();
  await page.getByText('View statistical detail').click();
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
  await expect(page.getByRole('row', { name: /Gives no medical advice/ })).toContainText('—');
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
  await expect(page.getByLabel('Name')).toHaveValue(/\(copy\)$/);
  await page.getByLabel('Name').fill('Memory on');
  await page.getByText('Hermes memory on').click();
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByRole('heading', { name: 'Memory on' })).toBeVisible();
});

test('a new experiment is a draft until it is started', async ({ page }) => {
  await page.goto('/experiments/new');
  await expect(page.getByText(/This suite contains 7 scenarios/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Eval only/ })).toHaveCount(0);
  await page.getByLabel('Name').fill('Draft only');
  await page.getByLabel(/A — baseline/).selectOption({ label: 'Baseline' });
  await page.getByLabel(/B — candidate/).selectOption({ label: 'Baseline + clinic skill' });
  await expect(page.getByText(/runs \(\d+ tasks × 2 configurations × 3\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Create experiment' }).click();
  await expect(page.getByText('This experiment has not started.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start \d+ runs/ })).toBeVisible();
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
