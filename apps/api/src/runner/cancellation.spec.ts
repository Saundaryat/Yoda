import { vi } from 'vitest';
import { cancellable } from './cancellation.js';

it('does not start requests after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  const action = vi.fn(async () => 'unexpected');
  await expect(cancellable(controller.signal, action)).rejects.toMatchObject({ kind: 'cancelled' });
  expect(action).not.toHaveBeenCalled();
});
it('settles cancellation even if a client ignores AbortSignal', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const pending = cancellable(
    controller.signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  release();
});

it('passes cancellation to the customer SDK and classifies it as cancellation', async () => {
  const { LlmLead } = await import('./llm-lead.js');
  const { sessionSchema } = await import('@evals/shared');
  const controller = new AbortController();
  const parse = vi.fn(() => new Promise<never>(() => {}));
  const lead = new LlmLead({
    session: sessionSchema.parse({ contact: 'c', opening: 'Hi' }),
    contactName: 'Alex',
    situation: 'Booking',
    model: 'test-only',
    client: { parse } as unknown as import('./anthropic.js').ClaudeClient,
    signal: controller.signal,
  });
  lead.opening();
  const pending = lead.next('What time works?');
  const cancelled = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
  expect(parse).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal });
  controller.abort();
  await cancelled;
});
