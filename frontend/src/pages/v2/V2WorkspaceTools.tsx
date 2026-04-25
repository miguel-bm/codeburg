import type { ReactNode } from 'react';
import { Files, GitCommitHorizontal, PanelRightClose, Search } from 'lucide-react';
import { FileExplorer } from '../../components/workspace/FileExplorer';
import { FileSearchPanel } from '../../components/workspace/FileSearchPanel';
import { GitPanel } from '../../components/workspace/GitPanel';
import { V2ToolbarButton } from './v2-ui';

export type V2HelperTab = 'files' | 'search' | 'git';

export function V2WorkspaceTools({
  helperTab,
  onSelectHelperTab,
  onClose,
}: {
  helperTab: V2HelperTab;
  onSelectHelperTab: (tab: V2HelperTab) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 items-center justify-between px-2">
        <div className="flex items-center gap-1">
          <HelperButton active={helperTab === 'files'} icon={<Files size={14} />} onClick={() => onSelectHelperTab('files')}>Files</HelperButton>
          <HelperButton active={helperTab === 'search'} icon={<Search size={14} />} onClick={() => onSelectHelperTab('search')}>Search</HelperButton>
          <HelperButton active={helperTab === 'git'} icon={<GitCommitHorizontal size={14} />} onClick={() => onSelectHelperTab('git')}>Git</HelperButton>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]">
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {helperTab === 'files' && <FileExplorer />}
        {helperTab === 'search' && <FileSearchPanel />}
        {helperTab === 'git' && <GitPanel />}
      </div>
    </div>
  );
}

function HelperButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <V2ToolbarButton active={active} onClick={onClick}>
      {icon}
      {children}
    </V2ToolbarButton>
  );
}
