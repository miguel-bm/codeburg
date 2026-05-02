import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowBigUp, Command, Option } from 'lucide-react';
import { shortcutDisplay, shortcutHasKey, shortcutPrimaryKey, type MacShortcutDefinition } from '../../shortcuts/registry';

interface ShortcutTooltipProps {
  shortcut?: MacShortcutDefinition;
  show?: boolean;
}

const SHORTCUT_TOOLTIP_DELAY_MS = 300;

export function ShortcutTooltip({ shortcut, show }: ShortcutTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [delayedShow, setDelayedShow] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);

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
      const estimatedWidth = Math.max(34, shortcutDisplay(shortcut).length * 13 + 16);
      const margin = 8;
      const centeredLeft = rect.left + rect.width / 2;
      const left = Math.min(
        Math.max(centeredLeft, margin + estimatedWidth / 2),
        window.innerWidth - margin - estimatedWidth / 2,
      );
      const above = rect.bottom + 34 > window.innerHeight && rect.top > 40;
      setPosition({
        left,
        top: above ? rect.top - 6 : rect.bottom + 6,
        above,
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
          className="pointer-events-none fixed z-[90] inline-flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-lg bg-[var(--color-text-primary)] px-1.5 py-1 text-[11px] font-medium text-[var(--color-card)] shadow-[0_8px_24px_oklch(0_0_0_/_0.18)] ring-1 ring-[var(--color-card-border)]"
          style={{ left: position.left, top: position.top, transform: position.above ? 'translate(-50%, -100%)' : 'translateX(-50%)' }}
        >
          <ShortcutGlyphs shortcut={shortcut} />
        </span>,
        document.body,
      )}
    </span>
  );
}

function ShortcutGlyphs({ shortcut }: { shortcut: MacShortcutDefinition }) {
  return (
    <kbd className="inline-flex items-center gap-0.5 rounded bg-[var(--color-card)]/12 px-1 py-0.5 font-mono text-[10px] leading-none" aria-label={shortcut.label}>
      {shortcutHasKey(shortcut, 'Control') && <span className="min-w-2 text-center text-[10px] font-semibold leading-none">⌃</span>}
      {shortcutHasKey(shortcut, 'Meta') && <Command size={12} strokeWidth={2.2} />}
      {shortcutHasKey(shortcut, 'Alt') && <Option size={12} strokeWidth={2.1} />}
      {shortcutHasKey(shortcut, 'Shift') && <ArrowBigUp size={13} strokeWidth={2.1} />}
      <span className="min-w-2 text-center text-[10px] font-semibold leading-none">{shortcutPrimaryKey(shortcut).toUpperCase()}</span>
    </kbd>
  );
}
