// Auth access token is kept strictly in JS module memory (never localStorage or sessionStorage).
// Persistent sessions use HttpOnly, SameSite=Lax cookies managed by the backend.
let inMemoryToken: string | null = null;

export function getStoredToken(): string | null {
  return inMemoryToken;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Attempt single automatic cookie refresh if access token expired on non-auth endpoints
  if (
    response.status === 401 &&
    !url.startsWith('/api/auth/login') &&
    !url.startsWith('/api/auth/refresh')
  ) {
    try {
      const refreshResp = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (refreshResp.ok) {
        const refreshData = (await refreshResp.json()) as { token?: string };
        if (refreshData.token) {
          setStoredToken(refreshData.token);
          headers.set('Authorization', `Bearer ${refreshData.token}`);
        }
        response = await fetch(url, {
          ...options,
          headers,
          credentials: 'include',
        });
      }
    } catch {
      // Fall through to normal error handling
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : {};

  if (!response.ok) {
    const msg =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed (${response.status})`;
    throw new ApiError(msg, response.status, data);
  }

  return data as T;
}

export async function fetchAuthorizedBlobUrl(url: string): Promise<string> {
  const token = getStoredToken();
  const headers = new Headers({ 'X-Requested-With': 'XMLHttpRequest' });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    throw new Error(`Unable to load file (${resp.status})`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}
