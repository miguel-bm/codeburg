const API_BASE = '/api';

let onUnauthorized: (() => void) | null = null;

/** Register a callback for 401 responses (called by auth store to avoid circular imports) */
export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Paths that should not trigger the 401 interceptor */
const AUTH_PATHS = ['/auth/login', '/auth/setup', '/auth/status', '/auth/me', '/auth/passkey/login/begin', '/auth/passkey/login/finish', '/auth/telegram'];

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('token');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized && !AUTH_PATHS.some(p => path.startsWith(p))) {
      onUnauthorized();
    }
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, error.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(path: string, data: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (path: string) =>
    request<void>(path, { method: 'DELETE' }),
};

export { ApiError };
