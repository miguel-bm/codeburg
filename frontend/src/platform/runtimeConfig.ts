interface RuntimeConfig {
  apiHttpBase?: string;
  apiWsBase?: string;
  platform?: string;
  titleBarInsetTop?: number;
}

declare global {
  interface Window {
    __CODEBURG_CONFIG__?: RuntimeConfig;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith('/')) {
    return value.replace(/\/+$/, '');
  }
  return value;
}

function getWindowConfig(): RuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }
  return window.__CODEBURG_CONFIG__ ?? {};
}

function inferDefaultWsBase(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:8080';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function readConfigValue(key: 'apiHttpBase' | 'apiWsBase', envKey: 'VITE_API_HTTP_BASE' | 'VITE_API_WS_BASE'): string | null {
  const windowValue = asNonEmptyString(getWindowConfig()[key]);
  if (windowValue) {
    return trimTrailingSlash(windowValue);
  }

  const envValue = asNonEmptyString(import.meta.env[envKey]);
  if (envValue) {
    return trimTrailingSlash(envValue);
  }

  return null;
}

export function getApiHttpBase(): string {
  return readConfigValue('apiHttpBase', 'VITE_API_HTTP_BASE') ?? '/api';
}

export function getApiWsBase(): string {
  return readConfigValue('apiWsBase', 'VITE_API_WS_BASE') ?? inferDefaultWsBase();
}

export function buildWsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiWsBase()}${normalizedPath}`;
}

export function isDesktopShell(): boolean {
  return getWindowConfig().platform === 'desktop-macos-electron';
}

export function getDesktopTitleBarInsetTop(): number {
  const value = getWindowConfig().titleBarInsetTop;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
