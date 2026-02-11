import { FolderOpen, Search, GitBranch, Wrench } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import type { ActivityPanel } from '../../stores/workspace';

const PANELS: { id: ActivityPanel; icon: typeof FolderOpen; label: string }[] = [
  { id: 'files', icon: FolderOpen, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'tools', icon: Wrench, label: 'Tools' },
];

export function ActivityBar() {
  const { activePanel, togglePanel } = useWorkspaceStore();

  return (
    <div className="flex flex-col items-center w-10 bg-secondary flex-shrink-0">
      {PANELS.map(({ id, icon: Icon, label }) => {
        const isActive = activePanel === id;
        return (
          <button
            key={id}
            onClick={() => togglePanel(id)}
            className={`relative w-10 h-10 flex items-center justify-center transition-colors ${
              isActive
                ? 'text-accent'
                : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
            title={label}
            aria-label={label}
          >
            {isActive && (
              <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />
            )}
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  );
}
