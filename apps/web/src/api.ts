export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new Error(typeof error.message === 'string' ? error.message : JSON.stringify(error));
  }
  return await response.json() as T;
}
export const percent = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
export const points = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pp`;
export const pretty = (v: unknown) => JSON.stringify(v, null, 2);
export const shortId = (id: string) => id.slice(0, 8);
export const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
