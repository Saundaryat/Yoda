import { InfraError } from './hermes-cli.js';

export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new InfraError('cancelled', 'Run cancelled');
}

/** Also settles promptly when a test client or third-party transport ignores AbortSignal. */
export async function cancellable<T>(
  signal: AbortSignal | undefined,
  action: () => PromiseLike<T>,
): Promise<T> {
  assertNotCancelled(signal);
  if (!signal) return action();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new InfraError('cancelled', 'Run cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        assertNotCancelled(signal);
        return action();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}
