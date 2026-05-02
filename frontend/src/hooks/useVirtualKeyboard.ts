import { useState, useEffect } from 'react';

interface VirtualKeyboardState {
  keyboardVisible: boolean;
  keyboardHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
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
    viewportOffsetTop: typeof window !== 'undefined'
      ? (window.visualViewport?.offsetTop ?? 0)
      : 0,
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const fullHeight = window.innerHeight;
      const vpHeight = vv.height;
      const offsetTop = vv.offsetTop || 0;
      const bottomOcclusion = Math.max(0, fullHeight - vpHeight - offsetTop);
      const visible = bottomOcclusion > threshold;

      setState({
        keyboardVisible: visible,
        keyboardHeight: visible ? bottomOcclusion : 0,
        viewportHeight: vpHeight,
        viewportOffsetTop: offsetTop,
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
