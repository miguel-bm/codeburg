import { useEffect, useState } from 'react';
import { isDesktopShell } from '../platform/runtimeConfig';

export interface MacTabShortcutItem {
  id: string;
  action: () => void;
  disabled?: boolean;
}

function shortcutIndex(event: KeyboardEvent): number {
  const digit = event.code.startsWith('Digit') || event.code.startsWith('Numpad')
    ? Number(event.code.slice(-1))
    : Number(event.key);

  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return -1;
  return digit - 1;
}

export function useMacTabShortcuts(items: MacTabShortcutItem[], enabled = true): boolean {
  const desktopShell = isDesktopShell();
  const [showHints, setShowHints] = useState(false);

  useEffect(() => {
    if (!desktopShell || !enabled) {
      setShowHints(false);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        setShowHints(true);
      }

      if (event.defaultPrevented || event.isComposing) return;
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;

      const index = shortcutIndex(event);
      if (index < 0) return;

      const item = items[index];
      if (!item || item.disabled) return;

      event.preventDefault();
      item.action();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || !event.metaKey) {
        setShowHints(false);
      }
    };

    const onBlur = () => setShowHints(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktopShell, enabled, items]);

  return desktopShell && enabled && showHints;
}
