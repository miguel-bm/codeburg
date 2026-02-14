import { useState, useEffect } from 'react';

interface VirtualKeyboardState {
  keyboardVisible: boolean;
  keyboardHeight: number;
  viewportHeight: number;
}

/**
 * Detects virtual keyboard visibility and height using the visualViewport API.
 * When the keyboard opens, visualViewport.height shrinks while window.innerHeight stays the same.
 */
export function useVirtualKeyboard(threshold = 150): VirtualKeyboardState {
  const [state, setState] = useState<VirtualKeyboardState>(() => ({
    keyboardVisible: false,
    keyboardHeight: 0,
    viewportHeight: typeof window !== 'undefined'
      ? (window.visualViewport?.height ?? window.innerHeight)
      : 0,
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const fullHeight = window.innerHeight;
      const vpHeight = vv.height;
      const diff = fullHeight - vpHeight;
      const visible = diff > threshold;

      setState({
        keyboardVisible: visible,
        keyboardHeight: visible ? diff : 0,
        viewportHeight: vpHeight,
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [threshold]);

  return state;
}
