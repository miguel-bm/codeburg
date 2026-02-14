import { FolderOpen, Search, GitBranch, Wrench, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import type { ActivityPanel as ActivityPanelType } from '../../stores/workspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspaceRefresh } from '../../hooks/useWorkspaceRefresh';
import { useHoverTooltip } from '../../hooks/useHoverTooltip';
import { HoverInfoTooltip } from '../ui/HoverInfoTooltip';
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

/** Always-visible icon strip for toggling the activity panel (desktop only) */
export function ActivityBar() {
  const { activePanel, togglePanel } = useWorkspaceStore();
  const { refreshState, refreshWorkspace, refreshTooltip } = useWorkspaceRefresh();
  const { tooltip, handleMouseEnter, handleMouseLeave } = useHoverTooltip();

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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={refreshState === 'loading'}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors mb-1 ${
          refreshState === 'done'
            ? 'text-[var(--color-success)] bg-tertiary'
            : refreshState === 'error'
              ? 'text-[var(--color-error)] bg-tertiary'
              : 'text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        } ${refreshState === 'loading' ? 'text-accent cursor-wait' : ''}`}
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

      {tooltip && <HoverInfoTooltip x={tooltip.x} y={tooltip.y} text={refreshTooltip} />}
    </div>
  );
}

interface ActivityPanelContentProps {
  panel: ActivityPanelType;
  style?: React.CSSProperties;
  /** When true, renders full-width without card chrome (mobile layout) */
  mobile?: boolean;
}

/** Panel content (file explorer, search, git, tools) — only rendered when a panel is active */
export function ActivityPanelContent({ panel, style, mobile }: ActivityPanelContentProps) {
  if (mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {panel === 'files' && <FileExplorer />}
        {panel === 'search' && <FileSearchPanel />}
        {panel === 'git' && <GitPanel />}
        {panel === 'tools' && <ToolsPanel />}
      </div>
    );
  }

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
