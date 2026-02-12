import { useState, useEffect, useCallback, useRef } from 'react';

interface UseHoverTooltipOptions {
  /** When true, hover events are ignored and no tooltip will show */
  disabled?: boolean;
  /** Delay in ms before showing tooltip (default: 800) */
  delay?: number;
}

interface TooltipPosition {
  x: number;
  y: number;
}

export function useHoverTooltip(options: UseHoverTooltipOptions = {}) {
  const { disabled = false, delay = 800 } = options;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    return () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      setTooltip({ x: rect.right + 8, y: rect.top });
    }, delay);
  }, [disabled, delay]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setTooltip(null);
  }, []);

  /** Immediately dismiss tooltip and cancel pending timer */
  const dismiss = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setTooltip(null);
  }, []);

  return { tooltip, handleMouseEnter, handleMouseLeave, dismiss };
}
