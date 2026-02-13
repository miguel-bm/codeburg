import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Dashboard } from './Dashboard';
import { Panel } from '../components/layout/Panel';
import { HeaderProvider, Header } from '../components/layout/Header';
import { usePanelNavigation } from '../hooks/usePanelNavigation';
import { useMobile } from '../hooks/useMobile';

export function DashboardWithPanels() {
  const isRoot = useMatch('/');
  const { isExpanded } = usePanelNavigation();
  const isMobile = useMobile();

  const panelOpen = !isRoot;
  const [panelExiting, setPanelExiting] = useState(false);
  const prevPanelOpen = useRef(panelOpen);

  // Track panel open→close transitions for hideDashboard in full mode
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (panelOpen) {
      timer = setTimeout(() => setPanelExiting(false), 0);
    } else if (prevPanelOpen.current) {
      timer = setTimeout(() => setPanelExiting(true), 0);
    }
    prevPanelOpen.current = panelOpen;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [panelOpen]);

  const handleExitComplete = useCallback(() => {
    setPanelExiting(false);
  }, []);

  // On mobile, panel is a full-screen overlay — dashboard always renders underneath.
  // On desktop half-mode, both are visible side by side.
  // On desktop full-mode, only panel is visible (including during exit animation).
  const hideDashboard = (panelOpen || panelExiting) && !isMobile && isExpanded;

  return (
    <div className="flex h-full overflow-hidden">
      {!hideDashboard && (
        <HeaderProvider>
          <div className="flex-1 min-w-0 h-full flex flex-col">
            <Header />
            <div className="flex-1 overflow-auto">
              <Dashboard panelOpen={panelOpen} />
            </div>
          </div>
        </HeaderProvider>
      )}

      <AnimatePresence onExitComplete={handleExitComplete}>
        {panelOpen && (
          <Panel key="panel">
            <Outlet />
          </Panel>
        )}
      </AnimatePresence>
    </div>
  );
}
