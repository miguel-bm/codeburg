const TOKEN_STORAGE_KEY = 'token';

interface TokenStorageAdapter {
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

declare global {
  interface Window {
    __CODEBURG_TOKEN_STORAGE__?: Partial<TokenStorageAdapter>;
  }
}

function createLocalStorageAdapter(): TokenStorageAdapter {
  return {
    getToken: () => {
      try {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    setToken: (token: string) => {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        // Ignore storage write failures (private mode, denied quota, etc.)
      }
    },
    clearToken: () => {
      try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
        // Ignore storage delete failures.
      }
    },
  };
}

function getWindowAdapter(): TokenStorageAdapter | null {
  if (typeof window === 'undefined' || !window.__CODEBURG_TOKEN_STORAGE__) {
    return null;
  }

  const adapter = window.__CODEBURG_TOKEN_STORAGE__;
  if (
    typeof adapter.getToken === 'function' &&
    typeof adapter.setToken === 'function' &&
    typeof adapter.clearToken === 'function'
  ) {
    return {
      getToken: adapter.getToken,
      setToken: adapter.setToken,
      clearToken: adapter.clearToken,
    };
  }

  return null;
}

let adapterOverride: TokenStorageAdapter | null = null;

export function configureAuthTokenStorage(adapter: TokenStorageAdapter | null) {
  adapterOverride = adapter;
}

function getAdapter(): TokenStorageAdapter {
  if (adapterOverride) {
    return adapterOverride;
  }
  return getWindowAdapter() ?? createLocalStorageAdapter();
}

export function getAuthToken(): string | null {
  return getAdapter().getToken();
}

export function setAuthToken(token: string): void {
  getAdapter().setToken(token);
}

export function clearAuthToken(): void {
  getAdapter().clearToken();
}

