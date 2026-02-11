import { useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { usePanelStore, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, PANEL_WIDTH_DEFAULT } from '../../stores/panel';
import { useMobile } from '../../hooks/useMobile';
import { HeaderProvider, Header } from './Header';

interface PanelProps {
  children: ReactNode;
  closing?: boolean;
  onExitComplete?: () => void;
}

export function Panel({ children, closing, onExitComplete }: PanelProps) {
  const { size, width, setWidth } = usePanelStore();
  const isMobile = useMobile();
  const navigate = useNavigate();
  const effectiveSize = isMobile ? 'full' : size;
  const [mounted, setMounted] = useState(false);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Entry animation: set mounted=true on the next frame after mount
  useEffect(() => {
    if (!closing) {
      const frame = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [closing]);

  // Exit animation: set mounted=false, then fire callback after transition ends
  useEffect(() => {
    if (closing) {
      setMounted(false);
      const timer = setTimeout(() => {
        onExitComplete?.();
      }, 220); // slightly longer than duration-200 to ensure transition finishes
      return () => clearTimeout(timer);
    }
  }, [closing, onExitComplete]);

  // Escape key handler — close the panel
  const handleClose = useCallback(() => {
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't close if a modal overlay is open (fixed inset-0 elements)
      const modals = document.querySelectorAll('.fixed.inset-0');
      if (modals.length > 0) return;
      // Don't close if focus is in an input-like element
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Don't close if a terminal session has focus
      const target = e.target as HTMLElement;
      if (target.closest('.xterm')) return;
      handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Drag resize from left edge
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = panelRef.current?.parentElement;
    if (!container) return;

    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.right - ev.clientX;
      setWidth(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, newWidth)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setWidth]);

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <HeaderProvider>
        <div className={[
          'fixed inset-0 z-10 bg-secondary flex flex-col',
          'transition-transform duration-200 ease-out',
          mounted ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}>
          <Header />
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </div>
      </HeaderProvider>
    );
  }

  // Desktop: flex child alongside dashboard, slides in from the right
  return (
    <HeaderProvider>
      <div
        ref={panelRef}
        className={[
          'relative flex-shrink-0 flex flex-col bg-secondary border-l border-subtle overflow-hidden',
          'transition-[transform,opacity] duration-200 ease-out',
          mounted ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
        ].join(' ')}
        style={{
          ...(effectiveSize === 'full' ? { flex: 1 } : { width: width || PANEL_WIDTH_DEFAULT }),
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        {/* Left edge: drag handle + collapse button */}
        {effectiveSize !== 'full' && (
          <div className="group/edge absolute top-0 left-0 bottom-0 w-3 z-20">
            {/* Drag handle strip */}
            <div
              onMouseDown={onDragStart}
              onDoubleClick={() => setWidth(PANEL_WIDTH_DEFAULT)}
              className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
            />
            {/* Collapse button — appears on edge hover */}
            <button
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              className={[
                'absolute top-1/2 -translate-y-1/2 left-0',
                'w-3.5 h-9 flex items-center justify-center',
                'rounded-r-lg',
                'opacity-0 group-hover/edge:opacity-100',
                'bg-transparent group-hover/edge:bg-tertiary hover:!bg-accent/20',
                'transition-all duration-150',
                'cursor-pointer',
              ].join(' ')}
              title="Close panel"
            >
              <ChevronRight size={11} className="text-dim" />
            </button>
          </div>
        )}

        <Header />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </HeaderProvider>
  );
}
