import type { ReactNode } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useMobile } from '../../hooks/useMobile';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 288; // 18rem = w-72
const SIDEBAR_STORAGE_KEY = 'sidebar-width';

function loadSidebarWidth(): number {
  const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
  }
  return SIDEBAR_DEFAULT;
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
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
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // persist on release
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [sidebarWidth]);

  return (
    <div className="flex h-screen bg-primary">
      {/* Mobile hamburger button */}
      {isMobile && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-40 p-2 border border-subtle bg-secondary hover:bg-tertiary rounded-md transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Sidebar - always visible on desktop, overlay on mobile */}
      {isMobile ? (
        <>
          {/* Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm z-40"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* Sliding sidebar */}
          <div
            className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </>
      ) : (
        <div className="relative flex-shrink-0" style={{ width: sidebarWidth }}>
          <Sidebar width={sidebarWidth} />
          {/* Drag handle — double-click to reset */}
          <div
            onMouseDown={onMouseDown}
            onDoubleClick={() => {
              setSidebarWidth(SIDEBAR_DEFAULT);
              localStorage.setItem(SIDEBAR_STORAGE_KEY, String(SIDEBAR_DEFAULT));
            }}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors z-10"
          />
        </div>
      )}

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
