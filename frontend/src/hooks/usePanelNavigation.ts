import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Search params that belong to the dashboard and should survive panel navigation */
const DASHBOARD_PARAMS = new Set(['view', 'project', 'status', 'priority', 'type', 'label']);

function normalizeSearch(search: string): string {
  const normalized = [...new URLSearchParams(search).entries()]
    .sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(normalized).toString();
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

    // "Same element" = same pathname (search params like ?session= are sub-selections
    // within the same panel, not different elements)
    const sameElement = targetPath === location.pathname;

    if (sameElement) {
      // Same element — apply target sub-selection params explicitly.
      // Start from dashboard params only to avoid carrying stale sub-selection state.
      const params = new URLSearchParams();
      for (const [key, value] of new URLSearchParams(location.search)) {
        if (DASHBOARD_PARAMS.has(key)) params.set(key, value);
      }
      for (const [key, value] of new URLSearchParams(targetSearch)) {
        params.set(key, value);
      }
      if (isExpanded) {
        params.set('expanded', '1');
      }
      const qs = params.toString();
      const nextSearch = qs ? `?${qs}` : '';
      if (normalizeSearch(nextSearch) !== normalizeSearch(location.search)) {
        navigate(targetPath + nextSearch, { replace: options?.replace ?? true });
      }
    } else {
      // Different element — carry over dashboard params, then apply target params
      const params = new URLSearchParams();
      for (const [key, value] of new URLSearchParams(location.search)) {
        if (DASHBOARD_PARAMS.has(key)) params.set(key, value);
      }
      for (const [key, value] of new URLSearchParams(targetSearch)) {
        params.set(key, value);
      }
      if (isExpanded) {
        params.set('expanded', '1');
      }
      const qs = params.toString();
      navigate(targetPath + (qs ? `?${qs}` : ''), options);
    }
  }, [location.pathname, location.search, isExpanded, navigate]);

  const closePanel = useCallback(() => {
    const params = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(location.search)) {
      if (DASHBOARD_PARAMS.has(key)) params.set(key, value);
    }
    const qs = params.toString();
    navigate('/' + (qs ? `?${qs}` : ''));
  }, [location.search, navigate]);

  return { isExpanded, toggleExpanded, setExpanded, navigateToPanel, closePanel };
}
