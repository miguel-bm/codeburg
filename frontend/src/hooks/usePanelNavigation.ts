import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

function stripExpanded(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('expanded');
  const result = params.toString();
  return result ? `?${result}` : '';
}

function pathWithoutExpanded(pathname: string, search: string): string {
  return pathname + stripExpanded(search);
}

export function usePanelNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const isExpanded = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('expanded') === '1';
  }, [location.search]);

  const toggleExpanded = useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('expanded') === '1') {
      params.delete('expanded');
    } else {
      params.set('expanded', '1');
    }
    const qs = params.toString();
    navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: true });
  }, [location.pathname, location.search, navigate]);

  const setExpanded = useCallback((value: boolean) => {
    const params = new URLSearchParams(location.search);
    const current = params.get('expanded') === '1';
    if (current === value) return;
    if (value) {
      params.set('expanded', '1');
    } else {
      params.delete('expanded');
    }
    const qs = params.toString();
    navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: true });
  }, [location.pathname, location.search, navigate]);

  const navigateToPanel = useCallback((to: string, options?: { replace?: boolean }) => {
    // Parse the target URL
    const [targetPath, targetSearch = ''] = to.split('?');
    const targetClean = pathWithoutExpanded(targetPath, targetSearch ? `?${targetSearch}` : '');

    // Compare with current URL (ignoring expanded param)
    const currentClean = pathWithoutExpanded(location.pathname, location.search);

    if (currentClean === targetClean) {
      // Same element — if not expanded, expand; if already expanded, no-op
      if (!isExpanded) {
        const params = new URLSearchParams(targetSearch);
        params.set('expanded', '1');
        const qs = params.toString();
        navigate(targetPath + (qs ? `?${qs}` : ''), { replace: true });
      }
    } else {
      // Different element — carry expanded state if currently expanded
      const params = new URLSearchParams(targetSearch);
      if (isExpanded) {
        params.set('expanded', '1');
      }
      const qs = params.toString();
      navigate(targetPath + (qs ? `?${qs}` : ''), options);
    }
  }, [location.pathname, location.search, isExpanded, navigate]);

  return { isExpanded, toggleExpanded, setExpanded, navigateToPanel };
}
