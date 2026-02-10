export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'codeburg:theme-preference';
const THEME_CHANGE_EVENT = 'codeburg:theme-change';

interface ThemeChangeDetail {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

let systemThemeListenerAttached = false;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function dispatchThemeChange(detail: ThemeChangeDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail }));
}

function writeThemePreference(preference: ThemePreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore
  }
}

function watchSystemThemeChanges() {
  if (typeof window === 'undefined' || systemThemeListenerAttached) return;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    if (getThemePreference() !== 'system') return;
    applyTheme('system');
  };

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', sync);
  } else {
    media.addListener(sync);
  }

  systemThemeListenerAttached = true;
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function getResolvedTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference: ThemePreference) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const resolvedTheme = getResolvedTheme(preference);

  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }

  root.style.colorScheme = resolvedTheme;
  dispatchThemeChange({ preference, resolvedTheme });
}

export function setThemePreference(preference: ThemePreference) {
  writeThemePreference(preference);
  applyTheme(preference);
}

export function initializeTheme() {
  const preference = getThemePreference();
  applyTheme(preference);
  watchSystemThemeChanges();
}

export function subscribeToThemeChange(onChange: (detail: ThemeChangeDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler: EventListener = (event) => {
    const themeEvent = event as CustomEvent<ThemeChangeDetail>;
    onChange(themeEvent.detail);
  };

  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}
