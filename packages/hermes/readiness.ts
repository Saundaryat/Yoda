import { setTimeout as delay } from 'node:timers/promises';

// Hermes can publish HTTP health before its tool-registry imports finish. Retry
// only this read-only discovery call, before any lead turn/model execution.
export async function discoverReadyToolsets(request: (path: string) => Promise<Record<string, any>>,
  pause: () => Promise<unknown> = () => delay(500)) {
  for (let attempt = 1; ; attempt++) {
    try { return { toolsets: await request('/v1/toolsets'), attempts: attempt }; }
    catch (error) {
      if (attempt >= 5 || !(/\/v1\/toolsets: HTTP (?:500|503):/.test((error as Error).message) || (error as Error).name === 'TimeoutError')) throw error;
      await pause();
    }
  }
}
