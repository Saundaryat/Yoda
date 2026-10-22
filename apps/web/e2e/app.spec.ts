import { expect, test } from '@playwright/test';

test('a reviewer can go from the verdict down to why a run failed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();

  // Verdict card with a plain-language explanation and the interval.
  await expect(page.getByText(/B passed \d+% of runs and A \d+%/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Difference .* points, 95% interval/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'skill_view' })).toBeVisible();

  // A failed baseline run says which check failed and why.
  const clinical = page.getByRole('row', { name: /Lead with a swollen/ });
  await clinical.getByRole('link', { name: '✗' }).first().click();
  await expect(page.getByText('Why it failed:')).toBeVisible();
  await expect(page.getByText('escalate_to_human never called').first()).toBeVisible();

  // Side-by-side comparison shows B opened the skill.
  // Side-by-side comparison shows B opened the skill.
  await page.getByRole('link', { name: 'Compare A and B on this task' }).click();
  await expect(page.getByRole('heading', { name: 'Checks, side by side' })).toBeVisible();
  await expect(page.locator('summary', { hasText: 'skill_view' }).first()).toBeVisible();
});

test("a check's evidence button highlights the exact event", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E skill experiment' }).click();
  const booking = page.getByRole('row', { name: /New lead books a cleaning/ });
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
  await page.getByLabel('Name').fill('Draft only');
  await page.getByLabel(/A — baseline/).selectOption({ label: 'Baseline' });
  await page.getByLabel(/B — candidate/).selectOption({ label: 'Baseline + clinic skill' });
  await expect(page.getByText(/runs \(\d+ tasks × 2 configurations × 3\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Create experiment' }).click();
  await expect(page.getByText("This experiment hasn't started.")).toBeVisible();
  await expect(page.getByRole('button', { name: /Run \d+ scenarios/ })).toBeVisible();
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
