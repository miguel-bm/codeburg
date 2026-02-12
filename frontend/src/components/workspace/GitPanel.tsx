import { useState, useRef, useEffect } from 'react';
import {
  ChevronRight,
  Plus,
  Minus,
  Undo2,
  GitBranch,
  ArrowDown,
  ArrowUp,
  MoreVertical,
  RotateCcw,
  Package,
  PackageOpen,
  X,
  ExternalLink,
} from 'lucide-react';
import { useWorkspaceGit } from '../../hooks/useWorkspaceGit';
import { useWorkspaceStore } from '../../stores/workspace';
import { parseDiffFiles } from '../git/diffFiles';
import { ContextMenu } from '../ui/ContextMenu';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { GitFileStatus } from '../../api/git';
import type { ContextMenuItem } from '../ui/ContextMenu';

function statusLabel(s: string): string {
  switch (s) {
    case 'M': return 'M';
    case 'A': return 'A';
    case 'D': return 'D';
    case 'R': return 'R';
    case 'C': return 'C';
    default: return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'M': return 'text-yellow-500';
    case 'A': return 'text-green-500';
    case 'D': return 'text-red-500';
    default: return 'text-dim';
  }
}

interface ConfirmAction {
  title: string;
  message: string;
  onConfirm: () => void;
}

export function GitPanel() {
  const git = useWorkspaceGit();
  const { openDiff } = useWorkspaceStore();
  const [commitMsg, setCommitMsg] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    branch: true,
    staged: true,
    unstaged: true,
    untracked: true,
  });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const {
    status, stage, unstage, revert, commit, pull, push, stash,
    isCommitting, isPulling, isPushing, isStashing,
    error, clearErrors, baseDiff,
  } = git;

  const toggleSection = (key: string) =>
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }));

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    await commit({ message: commitMsg.trim() });
    setCommitMsg('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCommit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [commitMsg]);

  const confirmRevert = (tracked: string[], untracked: string[], label: string) => {
    if (!tracked.length && !untracked.length) return;
    setConfirmAction({
      title: 'Discard changes',
      message: `Discard changes for ${label}? This cannot be undone.`,
      onConfirm: () => {
        revert({ tracked, untracked });
        setConfirmAction(null);
      },
    });
  };

  const openMenu = () => {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    }
  };

  if (!status) {
    return <div className="flex items-center justify-center h-20 text-xs text-dim">Loading git status...</div>;
  }

  const hasChanges = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;
  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
  const baseDiffFiles = parseDiffFiles(baseDiff?.diff || '');

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Amend last commit',
      icon: RotateCcw,
      onClick: () => {
        if (commitMsg.trim()) {
          commit({ message: commitMsg.trim(), amend: true });
        } else {
          commit({ message: '', amend: true });
        }
      },
      disabled: isCommitting,
    },
    { label: '', onClick: () => {}, divider: true },
    {
      label: 'Stash changes',
      icon: Package,
      onClick: () => stash('push'),
      disabled: isStashing || totalChanges === 0,
    },
    {
      label: 'Pop stash',
      icon: PackageOpen,
      onClick: () => stash('pop'),
      disabled: isStashing,
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Commit section */}
      <div className="px-2 py-2 border-b border-subtle space-y-1.5">
        <textarea
          ref={textareaRef}
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={1}
          className="w-full px-2 py-1.5 text-xs bg-primary border border-subtle rounded-md resize-none focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || status.staged.length === 0 || isCommitting}
            className="flex-1 px-2 py-1 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
          >
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
          <button
            ref={menuBtnRef}
            onClick={openMenu}
            className="px-1.5 py-1 text-dim bg-secondary rounded-md hover:text-[var(--color-text-primary)] hover:bg-tertiary transition-colors"
            title="More actions"
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-2 py-1.5 border-b border-subtle flex items-center gap-1.5 text-xs text-[var(--color-error)] bg-[var(--color-error)]/5">
          <span className="flex-1 truncate">
            {error instanceof Error ? error.message : String(error)}
          </span>
          <button onClick={clearErrors} className="shrink-0 p-0.5 hover:bg-[var(--color-error)]/10 rounded">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Branch + sync */}
      <div className="px-2 py-1.5 border-b border-subtle flex items-center gap-2 text-xs">
        <GitBranch size={12} className="text-dim shrink-0" />
        <span className="font-mono text-dim truncate">{status.branch}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <div className="flex items-center gap-1 ml-auto">
            {status.behind > 0 && (
              <button
                onClick={() => pull()}
                disabled={isPulling}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-tertiary text-dim"
              >
                <ArrowDown size={10} />
                {isPulling ? '...' : status.behind}
              </button>
            )}
            {status.ahead > 0 && (
              <button
                onClick={() => push()}
                disabled={isPushing}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-tertiary text-dim"
              >
                <ArrowUp size={10} />
                {isPushing ? '...' : status.ahead}
              </button>
            )}
          </div>
        )}
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-auto">
        {/* Branch changes */}
        <Section
          title={`Branch Changes (${baseDiffFiles.length})`}
          expanded={expandedSections.branch}
          onToggle={() => toggleSection('branch')}
          actions={
            <button
              onClick={() => openDiff(undefined, undefined, true)}
              disabled={!baseDiff?.diff}
              className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-0.5"
              title="Open full branch diff"
            >
              <ExternalLink size={10} />
              Full diff
            </button>
          }
        >
          {baseDiffFiles.length > 0 ? (
            baseDiffFiles.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-1 px-2 py-0.5 group hover:bg-tertiary cursor-pointer text-xs"
                onClick={() => openDiff(f.path, undefined, true)}
              >
                <span className="w-4 text-center text-[10px] font-mono text-dim">Δ</span>
                <span className="flex-1 truncate">{f.path}</span>
                {f.additions > 0 && <span className="text-[10px] text-green-500">+{f.additions}</span>}
                {f.deletions > 0 && <span className="text-[10px] text-red-500">-{f.deletions}</span>}
              </div>
            ))
          ) : (
            <div className="px-2 py-2 text-[11px] text-dim">No branch changes</div>
          )}
        </Section>

        {!hasChanges && (
          <div className="flex items-center justify-center h-16 text-xs text-dim">No changes</div>
        )}

        {/* Staged */}
        {status.staged.length > 0 && (
          <Section
            title={`Staged (${status.staged.length})`}
            expanded={expandedSections.staged}
            onToggle={() => toggleSection('staged')}
            actions={
              <button
                onClick={() => unstage(status.staged.map((f) => f.path))}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] flex items-center gap-0.5"
                title="Unstage all"
              >
                <Minus size={10} />
                Unstage all
              </button>
            }
          >
            {status.staged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="staged"
                onUnstage={() => unstage([f.path])}
                onClick={() => openDiff(f.path, true)}
              />
            ))}
          </Section>
        )}

        {/* Unstaged */}
        {status.unstaged.length > 0 && (
          <Section
            title={`Changes (${status.unstaged.length})`}
            expanded={expandedSections.unstaged}
            onToggle={() => toggleSection('unstaged')}
            actions={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stage(status.unstaged.map((f) => f.path))}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] flex items-center gap-0.5"
                  title="Stage all"
                >
                  <Plus size={10} />
                  Stage all
                </button>
                <button
                  onClick={() =>
                    confirmRevert(
                      status.unstaged.map((f) => f.path),
                      [],
                      `${status.unstaged.length} file${status.unstaged.length !== 1 ? 's' : ''}`,
                    )
                  }
                  className="text-[10px] text-dim hover:text-[var(--color-error)] flex items-center gap-0.5"
                  title="Revert all"
                >
                  <Undo2 size={10} />
                  Revert all
                </button>
              </div>
            }
          >
            {status.unstaged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="unstaged"
                onStage={() => stage([f.path])}
                onRevert={() => confirmRevert([f.path], [], f.path)}
                onClick={() => openDiff(f.path, false)}
              />
            ))}
          </Section>
        )}

        {/* Untracked */}
        {status.untracked.length > 0 && (
          <Section
            title={`Untracked (${status.untracked.length})`}
            expanded={expandedSections.untracked}
            onToggle={() => toggleSection('untracked')}
            actions={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stage(status.untracked)}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] flex items-center gap-0.5"
                  title="Stage all"
                >
                  <Plus size={10} />
                  Stage all
                </button>
                <button
                  onClick={() =>
                    confirmRevert(
                      [],
                      status.untracked,
                      `${status.untracked.length} untracked file${status.untracked.length !== 1 ? 's' : ''}`,
                    )
                  }
                  className="text-[10px] text-dim hover:text-[var(--color-error)] flex items-center gap-0.5"
                  title="Delete all untracked"
                >
                  <Undo2 size={10} />
                  Revert all
                </button>
              </div>
            }
          >
            {status.untracked.map((path) => (
              <FileEntry
                key={path}
                file={{ path, status: 'A' }}
                section="untracked"
                onStage={() => stage([path])}
                onRevert={() => confirmRevert([], [path], path)}
                onClick={() => openDiff(path, false)}
              />
            ))}
          </Section>
        )}
      </div>

      {/* Context menu for three-dot */}
      {menuPos && (
        <ContextMenu
          items={menuItems}
          position={menuPos}
          onClose={() => setMenuPos(null)}
        />
      )}

      {/* Confirm modal for destructive actions */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.title ?? ''}
        size="sm"
      >
        <div className="px-5 py-4">
          <p className="text-sm text-dim">{confirmAction?.message}</p>
        </div>
        <div className="px-5 py-3 border-t border-subtle flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => confirmAction?.onConfirm()}>
            Discard
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function FileEntry({
  file,
  section,
  onStage,
  onUnstage,
  onRevert,
  onClick,
}: {
  file: GitFileStatus;
  section: 'staged' | 'unstaged' | 'untracked';
  onStage?: () => void;
  onUnstage?: () => void;
  onRevert?: () => void;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 group hover:bg-tertiary cursor-pointer text-xs" onClick={onClick}>
      <span className={`w-4 text-center text-[10px] font-mono ${statusColor(file.status)}`}>
        {statusLabel(file.status)}
      </span>
      <span className="flex-1 truncate">{file.path}</span>
      {file.additions !== undefined && file.additions > 0 && (
        <span className="text-[10px] text-green-500">+{file.additions}</span>
      )}
      {file.deletions !== undefined && file.deletions > 0 && (
        <span className="text-[10px] text-red-500">-{file.deletions}</span>
      )}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        {section === 'staged' && onUnstage && (
          <button onClick={(e) => { e.stopPropagation(); onUnstage(); }} className="p-0.5 text-dim hover:text-accent" title="Unstage">
            <Minus size={14} />
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onStage && (
          <button onClick={(e) => { e.stopPropagation(); onStage(); }} className="p-0.5 text-dim hover:text-accent" title="Stage">
            <Plus size={14} />
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onRevert && (
          <button onClick={(e) => { e.stopPropagation(); onRevert(); }} className="p-0.5 text-dim hover:text-[var(--color-error)]" title="Revert">
            <Undo2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  expanded,
  onToggle,
  actions,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1 bg-secondary">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-dim hover:text-[var(--color-text-primary)]"
        >
          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {title}
        </button>
        {actions}
      </div>
      {expanded && children}
    </div>
  );
}
