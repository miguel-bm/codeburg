import type { ReactNode } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header, HeaderProvider } from './Header';
import { useMobile } from '../../hooks/useMobile';
import { useSidebarStore, selectIsExpanded } from '../../stores/sidebar';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 288;
const COLLAPSED_WIDTH = 48;

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const store = useSidebarStore();
  const isExpanded = useSidebarStore(selectIsExpanded);
  const sidebarWidth = store.width;

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
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
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [store]);

  if (isMobile) {
    return (
      <HeaderProvider>
        <div className="flex h-screen bg-canvas">
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-4 left-4 z-40 p-2 border border-subtle bg-secondary hover:bg-tertiary rounded-md transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm z-40"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            <Header />
            <main className="flex-1 overflow-auto">
              {children}
            </main>
          </div>
        </div>
      </HeaderProvider>
    );
  }

  // Desktop: expanded or collapsed, always visible
  return (
    <HeaderProvider>
      <div className="flex h-screen bg-canvas">
        <div
          className="relative flex-shrink-0 transition-[width] duration-200 ease-out"
          style={{ width: isExpanded ? sidebarWidth : COLLAPSED_WIDTH }}
        >
          <Sidebar width={isExpanded ? sidebarWidth : COLLAPSED_WIDTH} collapsed={!isExpanded} />
          {/* Drag handle (expanded only) */}
          {isExpanded && (
            <div
              onMouseDown={onMouseDown}
              onDoubleClick={() => store.setWidth(SIDEBAR_DEFAULT)}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors z-10"
            />
          )}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </HeaderProvider>
  );
}
