import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Dashboard } from './Dashboard';
import { Panel } from '../components/layout/Panel';
import { HeaderProvider, Header } from '../components/layout/Header';
import { usePanelStore } from '../stores/panel';
import { useMobile } from '../hooks/useMobile';

export function DashboardWithPanels() {
  const isRoot = useMatch('/');
  const { size } = usePanelStore();
  const isMobile = useMobile();

  const panelOpen = !isRoot;
  const [panelExiting, setPanelExiting] = useState(false);
  const cachedContent = useRef<ReactNode>(null);
  const prevPanelOpen = useRef(panelOpen);

  // Track panel open→close transitions for hideDashboard in full mode
  useEffect(() => {
    if (panelOpen) {
      setPanelExiting(false);
    } else if (prevPanelOpen.current) {
      setPanelExiting(true);
    }
    prevPanelOpen.current = panelOpen;
  }, [panelOpen]);

  // Cache outlet content so it persists during the exit animation
  const outlet = panelOpen ? <Outlet /> : null;
  if (outlet) {
    cachedContent.current = outlet;
  }

  const handleExitComplete = useCallback(() => {
    setPanelExiting(false);
    cachedContent.current = null;
  }, []);

  // On mobile, panel is a full-screen overlay — dashboard always renders underneath.
  // On desktop half-mode, both are visible side by side.
  // On desktop full-mode, only panel is visible (including during exit animation).
  const hideDashboard = (panelOpen || panelExiting) && !isMobile && size === 'full';

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
            {outlet || cachedContent.current}
          </Panel>
        )}
      </AnimatePresence>
    </div>
  );
}
