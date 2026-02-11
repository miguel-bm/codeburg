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
  // On mobile, panel is a full-screen overlay — dashboard always renders underneath.
  // On desktop half-mode, both are visible side by side.
  // On desktop full-mode, only panel is visible.
  const hideDashboard = panelOpen && !isMobile && size === 'full';

  return (
    <div className="flex h-full overflow-hidden">
      {!hideDashboard && (
        <div className="flex-1 min-w-0 h-full overflow-auto">
          <Dashboard panelOpen={panelOpen} />
        </div>
      )}

      {panelOpen && (
        <Panel>
          <Outlet />
        </Panel>
      )}
    </div>
  );
}
