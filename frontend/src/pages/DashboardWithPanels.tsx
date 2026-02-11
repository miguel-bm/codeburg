import { Outlet, useMatch } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { Panel } from '../components/layout/Panel';

export function DashboardWithPanels() {
  const isRoot = useMatch('/');

  return (
    <div className="relative h-full overflow-hidden">
      {/* Dashboard always renders underneath */}
      <div className={`h-full overflow-auto ${!isRoot ? 'pointer-events-none' : ''}`}>
        <Dashboard panelOpen={!isRoot} />
      </div>

      {/* Panel overlay when a child route is active */}
      {!isRoot && (
        <Panel>
          <Outlet />
        </Panel>
      )}
    </div>
  );
}
