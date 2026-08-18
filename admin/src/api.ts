export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  if (response.status === 401) { window.location.href = '/auth/login'; throw new Error('Authentication required'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
