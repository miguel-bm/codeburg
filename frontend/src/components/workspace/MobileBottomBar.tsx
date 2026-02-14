import { FolderOpen, Search, GitBranch, Wrench, RefreshCw, Check, AlertCircle, MonitorPlay } from 'lucide-react';
import { motion } from 'motion/react';
import type { ActivityPanel } from '../../stores/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspaceRefresh } from '../../hooks/useWorkspaceRefresh';
import { haptic } from '../../lib/haptics';

const TABS: { id: ActivityPanel | null; icon: typeof FolderOpen; label: string }[] = [
  { id: null, icon: MonitorPlay, label: 'Sessions' },
  { id: 'files', icon: FolderOpen, label: 'Files' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'tools', icon: Wrench, label: 'Tools' },
];

export function MobileWorkspaceNav() {
  const { activePanel, setActivePanel } = useWorkspaceStore();
  const { refreshState, refreshWorkspace, refreshTooltip } = useWorkspaceRefresh();

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-canvas border-b border-subtle shrink-0 overflow-x-auto scrollbar-none">
      {TABS.map(({ id, icon: Icon, label }) => {
        const isActive = activePanel === id;
        return (
          <button
            key={id ?? 'sessions'}
            onClick={() => { haptic(); setActivePanel(id); }}
            className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors shrink-0 ${
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-dim hover:text-[var(--color-text-secondary)] hover:bg-tertiary'
            }`}
            aria-label={label}
          >
            {isActive && (
              <motion.div
                layoutId="mobile-workspace-nav-indicator"
                className="absolute inset-0 rounded-md bg-accent/15"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <Icon size={14} className="relative" />
            <span className="relative">{label}</span>
          </button>
        );
      })}

      {/* Refresh button */}
      <button
        onClick={() => { haptic(); refreshWorkspace(); }}
        disabled={refreshState === 'loading'}
        className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors ${
          refreshState === 'done'
            ? 'text-[var(--color-success)]'
            : refreshState === 'error'
              ? 'text-[var(--color-error)]'
              : refreshState === 'loading'
                ? 'text-accent'
                : 'text-dim hover:text-[var(--color-text-secondary)] hover:bg-tertiary'
        }`}
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

/** @deprecated Use MobileWorkspaceNav instead */
export const MobileBottomBar = MobileWorkspaceNav;
