import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePanelStore, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, PANEL_WIDTH_DEFAULT } from '../../stores/panel';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { useMobile } from '../../hooks/useMobile';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useSessionShortcutSettings, resolveLayout } from '../../stores/keyboard';
import { HeaderProvider, Header } from './Header';

interface PanelProps {
  children: ReactNode;
}

export function Panel({ children }: PanelProps) {
  const { width, setWidth } = usePanelStore();
  const { isExpanded, toggleExpanded } = usePanelNavigation();
  const isMobile = useMobile();
  const navigate = useNavigate();
  const isFullMode = isMobile || isExpanded;
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Determine the toggle key based on keyboard layout
  const layout = useSessionShortcutSettings((s) => s.layout);
  const toggleKey = useMemo(() => {
    const resolved = resolveLayout(layout);
    return resolved === 'es' ? '\u00BA' : '`';
  }, [layout]);

  // Keyboard shortcut: º (Spanish) / ` (intl) toggles expanded/collapsed
  useKeyboardNav({
    keyMap: useMemo(() => ({
      [toggleKey]: toggleExpanded,
    }), [toggleKey, toggleExpanded]),
    enabled: !isMobile,
  });

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

  const targetWidth = width || PANEL_WIDTH_DEFAULT;
  const ease: [number, number, number, number] = [0.4, 0, 0.2, 1];

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <HeaderProvider>
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.2, ease }}
          className="fixed inset-0 z-10 bg-secondary flex flex-col"
        >
          <Header />
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </motion.div>
      </HeaderProvider>
    );
  }

  // Desktop: flex child alongside dashboard, slides in from the right
  return (
    <HeaderProvider>
      <motion.div
        ref={panelRef}
        initial={isFullMode
          ? { opacity: 0, x: 96 }
          : { width: 0, opacity: 0 }}
        animate={isFullMode
          ? { opacity: 1, x: 0 }
          : { width: targetWidth, opacity: 1 }}
        exit={isFullMode
          ? { opacity: 0, x: 96 }
          : { width: 0, opacity: 0 }}
        transition={{
          duration: 0.2,
          ease,
          ...(!isFullMode ? {
            width: {
              duration: dragging.current ? 0 : 0.2,
              ease,
            },
          } : {}),
        }}
        className={[
          'relative flex flex-col bg-secondary overflow-hidden',
          isFullMode ? 'flex-1' : 'flex-shrink-0 border-l border-subtle',
        ].join(' ')}
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        {/* Left edge: drag handle + collapse button */}
        {!isFullMode && (
          <div className="group/edge absolute top-0 left-0 bottom-0 w-3 z-20">
            {/* Drag handle strip */}
            <div
              onMouseDown={onDragStart}
              onDoubleClick={() => setWidth(PANEL_WIDTH_DEFAULT)}
              className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
            />
            {/* Expand + Collapse buttons — appear on edge hover */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 flex flex-col opacity-0 group-hover/edge:opacity-100 transition-opacity duration-150">
              <button
                onClick={toggleExpanded}
                onMouseDown={(e) => e.stopPropagation()}
                className={[
                  'w-3.5 h-5 flex items-center justify-center',
                  'rounded-tr-lg',
                  'bg-transparent group-hover/edge:bg-tertiary hover:!bg-accent/20',
                  'transition-colors duration-150',
                  'cursor-pointer',
                ].join(' ')}
                title="Expand panel"
              >
                <ChevronLeft size={11} className="text-dim" />
              </button>
              <button
                onClick={handleClose}
                onMouseDown={(e) => e.stopPropagation()}
                className={[
                  'w-3.5 h-5 flex items-center justify-center',
                  'rounded-br-lg',
                  'bg-transparent group-hover/edge:bg-tertiary hover:!bg-accent/20',
                  'transition-colors duration-150',
                  'cursor-pointer',
                ].join(' ')}
                title="Close panel"
              >
                <ChevronRight size={11} className="text-dim" />
              </button>
            </div>
          </div>
        )}

        <Header />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </motion.div>
    </HeaderProvider>
  );
}
