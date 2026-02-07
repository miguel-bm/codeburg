import { useEffect, useRef } from 'react';

interface KeyMap {
  [key: string]: () => void;
}

interface Options {
  keyMap: KeyMap;
  enabled?: boolean;
}

export function useKeyboardNav({ keyMap, enabled = true }: Options): void {
  const keyMapRef = useRef(keyMap);
  keyMapRef.current = keyMap;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow Escape through always, but skip other keys when in inputs
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (e.key !== 'Escape' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
        return;
      }

      const composite =
        (e.ctrlKey ? 'Ctrl+' : '') +
        (e.metaKey ? 'Meta+' : '') +
        (e.altKey ? 'Alt+' : '') +
        (e.shiftKey ? 'Shift+' : '') +
        e.key;

      const handler = keyMapRef.current[composite];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
