import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { Panel } from '../components/layout/Panel';
import { usePanelStore } from '../stores/panel';
import { useMobile } from '../hooks/useMobile';

export function DashboardWithPanels() {
  const isRoot = useMatch('/');
  const { size } = usePanelStore();
  const isMobile = useMobile();

  const panelOpen = !isRoot;
  const [isClosing, setIsClosing] = useState(false);
  const cachedContent = useRef<ReactNode>(null);
  const prevPanelOpen = useRef(panelOpen);

  // Detect open→close transition to trigger exit animation
  useEffect(() => {
    if (prevPanelOpen.current && !panelOpen) {
      setIsClosing(true);
    }
    if (!prevPanelOpen.current && panelOpen) {
      setIsClosing(false);
    }
    prevPanelOpen.current = panelOpen;
  }, [panelOpen]);

  // Cache outlet content when panel is open so we can show it during close animation
  const outlet = panelOpen ? <Outlet /> : null;
  if (outlet) {
    cachedContent.current = outlet;
  }

  const handleExitComplete = useCallback(() => {
    setIsClosing(false);
    cachedContent.current = null;
  }, []);

  const showPanel = panelOpen || isClosing;
  // On mobile, panel is a full-screen overlay — dashboard always renders underneath.
  // On desktop half-mode, both are visible side by side.
  // On desktop full-mode, only panel is visible.
  const hideDashboard = showPanel && !isMobile && size === 'full';

  return (
    <div className="flex h-full overflow-hidden">
      {!hideDashboard && (
        <div className="flex-1 min-w-0 h-full overflow-auto">
          <Dashboard panelOpen={showPanel} />
        </div>
      )}

      {showPanel && (
        <Panel closing={isClosing} onExitComplete={handleExitComplete}>
          {panelOpen ? <Outlet /> : cachedContent.current}
        </Panel>
      )}
    </div>
  );
}
