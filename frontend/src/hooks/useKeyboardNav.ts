import { useEffect, useRef } from 'react';

interface KeyMap {
  [key: string]: () => void;
}

interface Options {
  keyMap: KeyMap;
  enabled?: boolean;
  allowInInputs?: string[];
}

export function useKeyboardNav({ keyMap, enabled = true, allowInInputs = [] }: Options): void {
  const keyMapRef = useRef(keyMap);
  const allowInInputsRef = useRef<Set<string>>(new Set(allowInInputs));

  useEffect(() => {
    keyMapRef.current = keyMap;
  }, [keyMap]);

  useEffect(() => {
    allowInInputsRef.current = new Set(allowInInputs);
  }, [allowInInputs]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const composite =
        (e.ctrlKey ? 'Ctrl+' : '') +
        (e.metaKey ? 'Meta+' : '') +
        (e.altKey ? 'Alt+' : '') +
        (e.shiftKey ? 'Shift+' : '') +
        e.key;

      // Allow Escape through always, but skip other keys when in inputs/terminals
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? '').toUpperCase();
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || active?.isContentEditable
        || !!active?.closest('.xterm');
      if (e.key !== 'Escape' && inInput && !allowInInputsRef.current.has(composite)) {
        return;
      }

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
