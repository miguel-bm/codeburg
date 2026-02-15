import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { usePanelNavigation } from './usePanelNavigation';

const navigateMock = vi.fn();
let locationMock: { pathname: string; search: string } = { pathname: '/', search: '' };

vi.mock('react-router-dom', () => ({
  useLocation: () => locationMock,
  useNavigate: () => navigateMock,
}));

function Harness({ onReady }: { onReady: (fn: ReturnType<typeof usePanelNavigation>['navigateToPanel']) => void }) {
  const { navigateToPanel } = usePanelNavigation();
  useEffect(() => {
    onReady(navigateToPanel);
  }, [navigateToPanel, onReady]);
  return null;
}

describe('usePanelNavigation.navigateToPanel', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    locationMock = {
      pathname: '/tasks/task-1',
      search: '?expanded=1&session=old-session&project=proj-1',
    };
  });

  it('updates same-path session query selection', () => {
    let navigateToPanel!: ReturnType<typeof usePanelNavigation>['navigateToPanel'];
    render(<Harness onReady={(fn) => { navigateToPanel = fn; }} />);

    act(() => {
      navigateToPanel('/tasks/task-1?session=new-session');
    });

    expect(navigateMock).toHaveBeenCalledWith(
      '/tasks/task-1?project=proj-1&session=new-session&expanded=1',
      { replace: true },
    );
  });

  it('clears stale same-path sub-selection when target has no query', () => {
    let navigateToPanel!: ReturnType<typeof usePanelNavigation>['navigateToPanel'];
    render(<Harness onReady={(fn) => { navigateToPanel = fn; }} />);

    act(() => {
      navigateToPanel('/tasks/task-1');
    });

    expect(navigateMock).toHaveBeenCalledWith(
      '/tasks/task-1?project=proj-1&expanded=1',
      { replace: true },
    );
  });
});
