// `NEXT_PUBLIC_API_URL` lets you point the browser at a different host (e.g. for
// local cross-origin dev). Otherwise we use the Next.js basePath (baked at build
// time and exposed as NEXT_PUBLIC_BASE_PATH) so that requests from the browser
// — which always start at host root — stay inside the Liliput / nginx prefix.
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '') || '';
const configuredBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim().replace(/\/$/, '');

export function toApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (configuredApiBaseUrl) {
    return `${configuredApiBaseUrl}${path}`;
  }

  if (configuredBasePath && path.startsWith('/')) {
    return `${configuredBasePath}${path}`;
  }

  return path;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(toApiUrl(path), {
    ...init,
    credentials: init.credentials ?? 'include',
  });
}
