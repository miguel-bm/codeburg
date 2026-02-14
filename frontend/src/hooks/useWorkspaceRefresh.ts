import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../components/workspace/WorkspaceContext';

export type RefreshState = 'idle' | 'loading' | 'done' | 'error';

function formatRelativeRefreshTime(timestamp: number, now: number): string {
  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSeconds < 3) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function useWorkspaceRefresh() {
  const queryClient = useQueryClient();
  const { scopeType, scopeId } = useWorkspace();
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const stateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (stateTimerRef.current !== null) {
        window.clearTimeout(stateTimerRef.current);
      }
    };
  }, []);

  const scheduleIdleState = useCallback((delayMs: number) => {
    if (stateTimerRef.current !== null) {
      window.clearTimeout(stateTimerRef.current);
    }
    stateTimerRef.current = window.setTimeout(() => {
      setRefreshState('idle');
      stateTimerRef.current = null;
    }, delayMs);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (refreshState === 'loading') return;
    setRefreshState('loading');

    const queryKeys: readonly (readonly unknown[])[] = [
      ['workspace-files', scopeType, scopeId],
      ['workspace-sessions', scopeType, scopeId],
      ['workspace-git-status', scopeType, scopeId],
      ['workspace-git-basediff', scopeType, scopeId],
      ['workspace-git-log', scopeType, scopeId],
      ['workspace-diff', scopeType, scopeId],
      ['workspace-diff-content', scopeType, scopeId],
    ];

    const refreshResults = await Promise.allSettled(
      queryKeys.map(async (queryKey) => {
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.refetchQueries({ queryKey, type: 'active' });
      }),
    );

    const hasFailure = refreshResults.some((result) => result.status === 'rejected');
    window.dispatchEvent(new Event('codeburg:workspace-refresh'));

    if (hasFailure) {
      setRefreshState('error');
      scheduleIdleState(1800);
      return;
    }

    const refreshedAt = Date.now();
    setLastRefreshedAt(refreshedAt);
    setTimeTick(refreshedAt);
    setRefreshState('done');
    scheduleIdleState(1200);
  }, [queryClient, refreshState, scheduleIdleState, scopeType, scopeId]);

  const refreshTooltip = useMemo(() => {
    if (refreshState === 'loading') return 'Refreshing workspace...';
    if (refreshState === 'done') {
      if (!lastRefreshedAt) return 'Refresh complete';
      return `Refresh complete. Last refreshed ${formatRelativeRefreshTime(lastRefreshedAt, timeTick)}.`;
    }
    if (refreshState === 'error') return 'Refresh failed';
    if (!lastRefreshedAt) return 'Refresh workspace';
    return `Refresh workspace. Last refreshed ${formatRelativeRefreshTime(lastRefreshedAt, timeTick)}.`;
  }, [lastRefreshedAt, refreshState, timeTick]);

  return { refreshState, refreshWorkspace, refreshTooltip };
}
