import { FolderOpen, Search, GitBranch, Wrench, RefreshCw, Check, AlertCircle, MonitorPlay } from 'lucide-react';
import { motion } from 'motion/react';
import type { ActivityPanel } from '../../stores/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspaceRefresh } from '../../hooks/useWorkspaceRefresh';

const TABS: { id: ActivityPanel | null; icon: typeof FolderOpen; label: string }[] = [
  { id: null, icon: MonitorPlay, label: 'Sessions' },
  { id: 'files', icon: FolderOpen, label: 'Files' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'tools', icon: Wrench, label: 'Tools' },
];

export function MobileBottomBar() {
  const { activePanel, setActivePanel } = useWorkspaceStore();
  const { refreshState, refreshWorkspace, refreshTooltip } = useWorkspaceRefresh();

  return (
    <div className="flex items-center justify-around bg-canvas border-t border-subtle shrink-0 pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ id, icon: Icon, label }) => {
        const isActive = activePanel === id;
        return (
          <button
            key={id ?? 'sessions'}
            onClick={() => setActivePanel(id)}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-0 flex-1 transition-colors ${
              isActive ? 'text-accent' : 'text-dim'
            }`}
            aria-label={label}
          >
            {isActive && (
              <motion.div
                layoutId="mobile-bottom-bar-indicator"
                className="absolute top-0 left-2 right-2 h-0.5 rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <Icon size={18} />
            <span className="text-[10px] leading-none">{label}</span>
          </button>
        );
      })}

      {/* Refresh button */}
      <button
        onClick={refreshWorkspace}
        disabled={refreshState === 'loading'}
        className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-0 flex-1 transition-colors ${
          refreshState === 'done'
            ? 'text-[var(--color-success)]'
            : refreshState === 'error'
              ? 'text-[var(--color-error)]'
              : refreshState === 'loading'
                ? 'text-accent'
                : 'text-dim'
        }`}
        title={refreshTooltip}
        aria-label="Refresh workspace"
      >
        {refreshState === 'done' ? (
          <Check size={18} />
        ) : refreshState === 'error' ? (
          <AlertCircle size={18} />
        ) : (
          <RefreshCw size={18} className={refreshState === 'loading' ? 'animate-spin' : ''} />
        )}
        <span className="text-[10px] leading-none">Refresh</span>
      </button>
    </div>
  );
}
