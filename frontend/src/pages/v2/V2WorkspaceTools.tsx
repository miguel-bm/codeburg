import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Files, GitBranch, Search, X } from 'lucide-react';
import { FileExplorer } from '../../components/workspace/FileExplorer';
import { FileSearchPanel } from '../../components/workspace/FileSearchPanel';
import { GitPanel } from '../../components/workspace/GitPanel';
import { useMobile } from '../../hooks/useMobile';
import { V2ToolbarButton } from './v2-ui';

export type V2HelperTab = 'files' | 'search' | 'git';

export function V2WorkspaceToolTabs({
  helperTab,
  toolsOpen,
  onToggleHelperTab,
  disabled,
  placement = 'inline',
}: {
  helperTab: V2HelperTab;
  toolsOpen: boolean;
  onToggleHelperTab: (tab: V2HelperTab) => void;
  disabled?: boolean;
  placement?: 'inline' | 'panel';
}) {
  return (
    <div className={`flex shrink-0 items-center gap-1 ${
      placement === 'inline' ? 'border-l border-[var(--color-card-border)] pl-1.5' : ''
    }`}>
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

export function V2WorkspaceToolsSurface({
  open,
  width,
  resizing,
  helperTab,
  disabled,
  onToggleHelperTab,
  onResizeStart,
  children,
}: {
  open: boolean;
  width: number;
  resizing: boolean;
  helperTab: V2HelperTab;
  disabled?: boolean;
  onToggleHelperTab: (tab: V2HelperTab) => void;
  onResizeStart: (event: ReactMouseEvent) => void;
  children: ReactNode;
}) {
  const isMobile = useMobile();

  if (isMobile) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="workspace-tools-mobile"
            className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] top-0 z-50 flex min-h-0 flex-col bg-canvas text-[var(--color-text-primary)]"
            initial={{ y: '100%', opacity: 0.96 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-card-border)] px-3 pt-[env(safe-area-inset-top)]">
              <V2WorkspaceToolTabs
                helperTab={helperTab}
                toolsOpen={open}
                disabled={disabled}
                placement="panel"
                onToggleHelperTab={onToggleHelperTab}
              />
              <button
                type="button"
                onClick={() => onToggleHelperTab(helperTab)}
                className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
                aria-label="Close workspace tools"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="workspace-tools"
          className="flex min-h-0 shrink-0 overflow-hidden bg-canvas"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: width + 6, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{
            width: { duration: resizing ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.12 },
          }}
        >
          <div className="w-1.5 shrink-0 cursor-col-resize bg-canvas hover:bg-accent/30" onMouseDown={onResizeStart} />
          <aside className="flex min-h-0 shrink-0 flex-col border-l border-[var(--color-card-border)] bg-canvas" style={{ width }}>
            <div className="flex h-9 shrink-0 items-center px-2">
              <V2WorkspaceToolTabs
                helperTab={helperTab}
                toolsOpen={open}
                disabled={disabled}
                placement="panel"
                onToggleHelperTab={onToggleHelperTab}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {children}
            </div>
          </aside>
        </motion.div>
      )}
    </AnimatePresence>
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
