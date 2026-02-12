import { useSyncExternalStore } from 'react';
import { getResolvedTheme, subscribeToThemeChange } from '../lib/theme';
import type { ResolvedTheme } from '../lib/theme';

function subscribe(onStoreChange: () => void): () => void {
  // Listen to our custom theme change event
  const unsub = subscribeToThemeChange(onStoreChange);

  // Also listen to system preference changes (for "system" mode)
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onStoreChange);

  return () => {
    unsub();
    media.removeEventListener('change', onStoreChange);
  };
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getResolvedTheme, () => 'dark' as const);
}
