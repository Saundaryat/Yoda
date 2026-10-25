import { test, expect } from '@playwright/test';

for (const pageKind of ['experiment', 'run', 'costs'] as const) {
  test(`resynchronizes ${pageKind} after native SSE reconnects without a replayed event`, async ({
    page,
  }) => {
    const experiments = await (await page.request.get('/api/experiments')).json();
    const saved = experiments.find((e: { name: string }) => e.name === 'E2E skill experiment');
    let completed = false,
      snapshots = 0,
      connections = 0;
    const runs = await (await page.request.get(`/api/experiments/${saved.id}/runs`)).json();
    const run = await (await page.request.get(`/api/runs/${runs[0].id}`)).json();
    const costs = await (await page.request.get(`/api/experiments/${saved.id}/costs`)).json();
    const endpoint =
      pageKind === 'run'
        ? `/api/runs/${runs[0].id}`
        : `/api/experiments/${saved.id}${pageKind === 'costs' ? '/costs' : ''}`;
    await page.route(`**${endpoint}`, (route) => {
      snapshots++;
      const json =
        pageKind === 'run'
          ? { ...run, run: { ...run.run, status: completed ? 'scored' : 'running' } }
          : pageKind === 'costs'
            ? { ...costs, estimatedCostUsd: completed ? 12.34 : 1.23 }
            : completed
              ? saved
              : {
                  ...saved,
                  status: 'running',
                  counts: { ...saved.counts, scored: saved.counts.scored - 1, running: 1 },
                };
      return route.fulfill({ json });
    });
    await page.route(`**/api/experiments/${saved.id}/events`, (route) => {
      connections++;
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 50\n\n: heartbeat\n\n',
      });
    });
    await page.goto(
      pageKind === 'run'
        ? `/runs/${runs[0].id}`
        : `/experiments/${saved.id}${pageKind === 'costs' ? '/costs' : ''}`,
    );
    await expect.poll(() => connections).toBeGreaterThan(1);
    if (pageKind === 'experiment')
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    if (pageKind === 'costs')
      await expect(page.getByRole('region', { name: 'Estimated total' })).toContainText('$1.23');
    const before = snapshots,
      priorConnections = connections;
    completed = true;
    await expect.poll(() => connections).toBeGreaterThan(priorConnections);
    await expect.poll(() => snapshots).toBeGreaterThan(before);
    if (pageKind === 'experiment')
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    if (pageKind === 'costs')
      await expect(page.getByRole('region', { name: 'Estimated total' })).toContainText('$12.34');
  });
}
