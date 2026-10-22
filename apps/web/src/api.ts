/** Thin fetch wrapper: JSON in, JSON out, errors carry the server's message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers });
  const body = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw new Error(body?.message ?? `${response.status} ${response.statusText}`);
  }
  return body as T;
}
