const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '') || '';

export function toApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${configuredApiBaseUrl}${path}`;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(toApiUrl(path), {
    ...init,
    credentials: init.credentials ?? 'include',
  });
}
