import type { FullConfig } from '@playwright/test';

// Seed two configurations and one finished experiment through the API, as a user would.
export default async function globalSetup(config: FullConfig) {
  const base = `${config.projects[0]!.use.baseURL}/api`;
  const post = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const spec = {
    provider: 'openai',
    model: 'gpt-test',
    systemPrompt: 'You are the Bright Smile Dental SMS assistant.',
  };
  const a = await post('/configurations', { name: 'Baseline', spec });
  const b = await post('/configurations', {
    name: 'Baseline + clinic skill',
    spec: { ...spec, skills: ['clinic-policy'] },
  });
  const tasks = (await (await fetch(`${base}/tasks`)).json()) as { id: string; split: string }[];
  const experiment = await post('/experiments', {
    name: 'E2E skill experiment',
    hypothesis: 'The skill helps the policy tasks.',
    baselineConfigId: a.id,
    candidateConfigId: b.id,
    taskIds: tasks.filter((t) => t.split === 'dev').map((t) => t.id),
    repetitions: 2,
  });
  await post(`/experiments/${experiment.id}/start`);
  for (let i = 0; i < 120; i++) {
    const status = (await (await fetch(`${base}/experiments/${experiment.id}`)).json()).status;
    if (status === 'finished') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Seed experiment did not finish');
}
