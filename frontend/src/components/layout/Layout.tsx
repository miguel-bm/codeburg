import type { ReactNode } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Sidebar, countWaiting } from './Sidebar';
import { MobileTabBar } from './MobileTabBar';
import { useMobile } from '../../hooks/useMobile';
import { useSidebarData } from '../../hooks/useSidebarData';
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
  const location = useLocation();
  const navigate = useNavigate();

  const store = useSidebarStore();
  const isExpanded = useSidebarStore(selectIsExpanded);
  const sidebarWidth = store.width;

  const { data: sidebarData } = useSidebarData();
  const waitingCount = countWaiting(sidebarData);

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

  // Mobile tab bar handlers
  const handleHome = useCallback(() => {
    setSidebarOpen(false);
    if (location.pathname !== '/') navigate('/');
  }, [location.pathname, navigate]);

  const handleProjects = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSettings = useCallback(() => {
    setSidebarOpen(false);
    if (location.pathname !== '/settings') navigate('/settings');
  }, [location.pathname, navigate]);

  // Determine active tab
  const activeTab = sidebarOpen
    ? 'projects' as const
    : location.pathname === '/settings'
      ? 'settings' as const
      : 'home' as const;

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-canvas">
        <div className="flex-1 min-w-0 overflow-hidden">
          {sidebarOpen ? (
            <Sidebar onClose={() => setSidebarOpen(false)} />
          ) : (
            children
          )}
        </div>
        <MobileTabBar
          activeTab={activeTab}
          onHome={handleHome}
          onProjects={handleProjects}
          onSettings={handleSettings}
          waitingCount={waitingCount}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas">
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

      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {children}
      </div>
    </div>
  );
}
