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

// Subclass of Error used for network-layer failures (the fetch() promise
// rejected, vs. resolving with a non-2xx Response). Carries the attempted
// URL and whether the browser thinks it was online so callers can render an
// actionable message instead of the bare "Failed to fetch" string Chrome
// throws by default.
export class ApiNetworkError extends Error {
  public readonly url: string;
  public readonly online: boolean;
  public readonly cause: unknown;
  constructor(message: string, opts: { url: string; online: boolean; cause: unknown }) {
    super(message);
    this.name = 'ApiNetworkError';
    this.url = opts.url;
    this.online = opts.online;
    this.cause = opts.cause;
  }
}

export interface ApiFetchOptions extends RequestInit {
  // Per-call timeout in milliseconds. Defaults to 30s — long enough for slow
  // mobile networks but short enough that a stalled request surfaces an
  // error instead of spinning forever. Pass `0` or `Infinity` to disable.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function apiFetch(path: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs, signal: callerSignal, ...rest } = init;
  const url = toApiUrl(path);
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Compose the caller's AbortSignal (if any) with our timeout signal so
  // either source can cancel the request. AbortSignal.any is widely
  // supported in modern browsers; fall back to manual wiring if not.
  let signal: AbortSignal | undefined = callerSignal ?? undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (effectiveTimeout > 0 && Number.isFinite(effectiveTimeout)) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, effectiveTimeout);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    signal = controller.signal;
  }

  return fetch(url, {
    ...rest,
    credentials: rest.credentials ?? 'include',
    signal,
  })
    .catch((err) => {
      // fetch() rejects only on network failures (DNS, TCP, TLS, CORS,
      // offline, ad-blocker, browser extension intercepting, etc.) — never
      // on HTTP error status codes. Wrap with the URL and online status so
      // the UI can render a useful message and the user can paste the URL
      // back to us if it keeps failing.
      const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
      const reason =
        timedOut
          ? `Request timed out after ${effectiveTimeout}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      const userMessage = !online
        ? `You appear to be offline. (${reason})`
        : `Couldn't reach ${url}: ${reason}. This usually means the network blocked the request, the server is down, or a browser extension is intercepting it.`;
      throw new ApiNetworkError(userMessage, { url, online, cause: err });
    })
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
}
