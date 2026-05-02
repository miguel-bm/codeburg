import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ShortcutTooltipProps {
  shortcut?: string;
  label?: string;
  show?: boolean;
}

const SHORTCUT_TOOLTIP_DELAY_MS = 300;

export function ShortcutTooltip({ shortcut, show }: ShortcutTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [delayedShow, setDelayedShow] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!show || !shortcut) {
      setDelayedShow(false);
      return;
    }

    const timer = window.setTimeout(() => setDelayedShow(true), SHORTCUT_TOOLTIP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [show, shortcut]);

  useLayoutEffect(() => {
    if (!delayedShow || !shortcut) {
      setPosition(null);
      return;
    }

    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: rect.left + rect.width / 2,
        top: rect.bottom + 6,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [delayedShow, shortcut]);

  return (
    <span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {delayedShow && shortcut && position && createPortal(
        <span
          className="pointer-events-none fixed z-[90] inline-flex -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--color-text-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-card)] shadow-[0_8px_24px_oklch(0_0_0_/_0.18)] ring-1 ring-[var(--color-card-border)]"
          style={{ left: position.left, top: position.top }}
        >
          <kbd className="rounded bg-[var(--color-card)]/16 px-1.5 py-0.5 font-mono text-[10px]">{shortcut}</kbd>
        </span>,
        document.body,
      )}
    </span>
  );
}
