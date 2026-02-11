import { useCallback, useRef } from 'react';

interface DividerProps {
  axis: 'horizontal' | 'vertical';
  onDrag: (delta: number) => void;
  onDragEnd?: () => void;
  className?: string;
}

export function Divider({ axis, onDrag, onDragEnd, className = '' }: DividerProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = axis === 'vertical' ? e.clientX : e.clientY;

      document.body.style.cursor = axis === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const current = axis === 'vertical' ? ev.clientX : ev.clientY;
        const delta = current - lastPos.current;
        lastPos.current = current;
        if (delta !== 0) onDrag(delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        onDragEnd?.();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [axis, onDrag, onDragEnd],
  );

  const isVertical = axis === 'vertical';

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`${isVertical ? 'h-full w-1 cursor-col-resize' : 'w-full h-1 cursor-row-resize'} hover:bg-accent/40 active:bg-accent/60 transition-colors flex-shrink-0 ${className}`}
    />
  );
}
