import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  x: number;
  y: number;
  text: string;
}

export function HoverInfoTooltip({ x, y, text }: Props) {
  const [pos, setPos] = useState({ x, y });
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y + 30; // default: below hovered control

    if (nx + rect.width > window.innerWidth - 12) {
      nx = window.innerWidth - rect.width - 12;
    }
    if (nx < 12) nx = 12;
    if (ny + rect.height > window.innerHeight - 12) {
      ny = y - rect.height - 10; // fallback: above
    }
    if (ny < 12) ny = 12;

    const timer = window.setTimeout(() => setPos({ x: nx, y: ny }), 0);
    return () => window.clearTimeout(timer);
  }, [el, x, y]);

  return createPortal(
    <div
      ref={setEl}
      className="fixed z-[200] bg-elevated border border-subtle rounded-lg shadow-lg max-w-xs w-72 text-xs animate-fadeIn pointer-events-none px-3 py-2"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>,
    document.body,
  );
}

