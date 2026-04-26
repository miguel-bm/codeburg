import type { ReactNode } from 'react';
import { Files, GitBranch, Search } from 'lucide-react';
import { FileExplorer } from '../../components/workspace/FileExplorer';
import { FileSearchPanel } from '../../components/workspace/FileSearchPanel';
import { GitPanel } from '../../components/workspace/GitPanel';
import { V2ToolbarButton } from './v2-ui';

export type V2HelperTab = 'files' | 'search' | 'git';

export function V2WorkspaceToolTabs({
  helperTab,
  toolsOpen,
  onToggleHelperTab,
  disabled,
}: {
  helperTab: V2HelperTab;
  toolsOpen: boolean;
  onToggleHelperTab: (tab: V2HelperTab) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-l border-[var(--color-card-border)] pl-1.5">
      <HelperButton disabled={disabled} active={toolsOpen && helperTab === 'files'} icon={<Files size={14} />} onClick={() => onToggleHelperTab('files')}>Files</HelperButton>
      <HelperButton disabled={disabled} active={toolsOpen && helperTab === 'search'} icon={<Search size={14} />} onClick={() => onToggleHelperTab('search')}>Search</HelperButton>
      <HelperButton disabled={disabled} active={toolsOpen && helperTab === 'git'} icon={<GitBranch size={14} />} onClick={() => onToggleHelperTab('git')}>Git</HelperButton>
    </div>
  );
}

export function V2WorkspaceTools({ helperTab }: { helperTab: V2HelperTab }) {
  return (
    <div className="h-full min-h-0 overflow-hidden">
      {helperTab === 'files' && <FileExplorer />}
      {helperTab === 'search' && <FileSearchPanel />}
      {helperTab === 'git' && <GitPanel />}
    </div>
  );
}

function HelperButton({
  active,
  disabled,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <V2ToolbarButton active={active} disabled={disabled} onClick={onClick}>
      {icon}
      {children}
    </V2ToolbarButton>
  );
}
