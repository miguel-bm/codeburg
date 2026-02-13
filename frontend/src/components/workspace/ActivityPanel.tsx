import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Search, GitBranch, Wrench, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import type { ActivityPanel as ActivityPanelType } from '../../stores/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspace } from './WorkspaceContext';
import { FileExplorer } from './FileExplorer';
import { FileSearchPanel } from './FileSearchPanel';
import { GitPanel } from './GitPanel';
import { ToolsPanel } from './ToolsPanel';

const PANELS: { id: ActivityPanelType; icon: typeof FolderOpen; label: string }[] = [
  { id: 'files', icon: FolderOpen, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'tools', icon: Wrench, label: 'Tools' },
];

type RefreshState = 'idle' | 'loading' | 'done' | 'error';

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

/** Always-visible icon strip for toggling the activity panel */
export function ActivityBar() {
  const queryClient = useQueryClient();
  const { scopeType, scopeId } = useWorkspace();
  const { activePanel, togglePanel } = useWorkspaceStore();
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

  return (
    <div className="flex flex-col items-center justify-between gap-0.5 py-2 px-1 shrink-0 h-full">
      <div className="flex flex-col items-center gap-0.5">
        {PANELS.map(({ id, icon: Icon, label }) => {
          const isActive = activePanel === id;
          return (
            <button
              key={id}
              onClick={() => togglePanel(id)}
              className={`relative inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                isActive
                  ? 'text-accent'
                  : 'text-dim hover:text-[var(--color-text-primary)]'
              }`}
              title={label}
              aria-label={label}
            >
              {isActive && (
                <motion.div
                  layoutId="activity-bar-indicator"
                  className="absolute inset-0 rounded-md bg-accent/15"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <Icon size={14} className="relative z-[1]" />
            </button>
          );
        })}
      </div>

      <button
        onClick={refreshWorkspace}
        disabled={refreshState === 'loading'}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors mb-1 ${
          refreshState === 'done'
            ? 'text-[var(--color-success)] bg-tertiary'
            : refreshState === 'error'
              ? 'text-[var(--color-error)] bg-tertiary'
              : 'text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        } ${refreshState === 'loading' ? 'text-accent cursor-wait' : ''}`}
        title={refreshTooltip}
        aria-label="Refresh workspace"
      >
        {refreshState === 'done' ? (
          <Check size={14} />
        ) : refreshState === 'error' ? (
          <AlertCircle size={14} />
        ) : (
          <RefreshCw size={14} className={refreshState === 'loading' ? 'animate-spin' : ''} />
        )}
      </button>
    </div>
  );
}

interface ActivityPanelContentProps {
  panel: ActivityPanelType;
  style?: React.CSSProperties;
}

/** Panel content (file explorer, search, git, tools) — only rendered when a panel is active */
export function ActivityPanelContent({ panel, style }: ActivityPanelContentProps) {
  return (
    <div className="flex flex-col pb-3 h-full min-h-0" style={style}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-card rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-card)]">
        <div className="flex-1 overflow-hidden">
          {panel === 'files' && <FileExplorer />}
          {panel === 'search' && <FileSearchPanel />}
          {panel === 'git' && <GitPanel />}
          {panel === 'tools' && <ToolsPanel />}
        </div>
      </div>
    </div>
  );
}
