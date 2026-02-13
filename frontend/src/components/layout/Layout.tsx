import type { ReactNode } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useMobile } from '../../hooks/useMobile';
import { useSidebarStore, selectIsExpanded } from '../../stores/sidebar';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 288;
const COLLAPSED_WIDTH = 48;

const ease: [number, number, number, number] = [0.4, 0, 0.2, 1];

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const store = useSidebarStore();
  const isExpanded = useSidebarStore(selectIsExpanded);
  const sidebarWidth = store.width;

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth.current + delta));
      store.setWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
      dragging.current = false;
    };
  }, [store]);

  return (
    <div className="flex h-screen bg-canvas">
      {isMobile ? (
        <>
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-4 left-4 z-40 p-2 border border-subtle bg-secondary hover:bg-tertiary rounded-md transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <AnimatePresence>
            {sidebarOpen && (
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm z-40"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            {sidebarOpen && (
              <motion.div
                key="drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.2, ease }}
                className="fixed inset-y-0 left-0 z-50"
              >
                <Sidebar onClose={() => setSidebarOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <motion.div
          className="relative flex-shrink-0 overflow-hidden"
          animate={{ width: isExpanded ? sidebarWidth : COLLAPSED_WIDTH }}
          transition={{
            width: { duration: isDragging ? 0 : 0.2, ease },
          }}
        >
          <Sidebar width={isExpanded ? sidebarWidth : COLLAPSED_WIDTH} collapsed={!isExpanded} />
          {isExpanded && (
            <div
              onMouseDown={onMouseDown}
              onDoubleClick={() => store.setWidth(SIDEBAR_DEFAULT)}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors z-10"
            />
          )}
        </motion.div>
      )}

      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {children}
      </div>
    </div>
  );
}
