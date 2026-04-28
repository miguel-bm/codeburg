import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Minus,
  Undo2,
  GitBranch,
  GitCommit,
  ArrowDown,
  ArrowUp,
  MoreVertical,
  RotateCcw,
  Package,
  PackageOpen,
  X,
  ExternalLink,
  Rocket,
  Hammer,
  CheckCircle2,
  History,
} from 'lucide-react';
import { useWorkspaceGit } from '../../hooks/useWorkspaceGit';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { parseDiffFiles } from '../git/diffFiles';
import { useWorkspaceStore } from '../../stores/workspace';
import { ContextMenu } from '../ui/ContextMenu';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { GitFileStatus, GitLogEntry } from '../../api/git';
import type { ContextMenuItem } from '../ui/ContextMenu';
import {
  WorkbenchButton,
  WorkbenchEmpty,
  WorkbenchFrame,
  WorkbenchIconButton,
  WorkbenchMeta,
  WorkbenchRow,
  WorkbenchSearchInput,
  WorkbenchSection,
} from './WorkspaceWorkbench';

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

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 5) return `${diffWeek}w ago`;
  return `${diffMonth}mo ago`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ConfirmAction {
  title: string;
  message: string;
  onConfirm: () => void;
}

export function GitPanel() {
  const git = useWorkspaceGit();
  const { openDiff } = useWorkspaceNav();
  const activeDiffTab = useWorkspaceStore((state) => {
    const activeTab = state.tabs[state.activeTabIndex];
    return activeTab?.type === 'diff' ? activeTab : null;
  });
  const activeDiffTabIndex = useWorkspaceStore((state) => {
    const activeTab = state.tabs[state.activeTabIndex];
    return activeTab?.type === 'diff' ? state.activeTabIndex : -1;
  });
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const [commitMsg, setCommitMsg] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    branch: true,
    staged: true,
    unstaged: true,
    untracked: true,
    history: false,
  });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const {
    status, stage, unstage, revert, commit, pull, push, stash,
    isCommitting, isPulling, isPushing, isStashing,
    error, clearErrors, baseDiff, log,
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

  const activeDiffFile = activeDiffTab?.file;
  const isBaseDiffTab = activeDiffTab?.base === true && !activeDiffTab.commit;
  const isStagedDiffTab = activeDiffTab?.staged === true && !activeDiffTab.base && !activeDiffTab.commit;
  const isUnstagedDiffTab = !!activeDiffTab && activeDiffTab.base !== true && activeDiffTab.staged !== true && !activeDiffTab.commit;
  const isDiffActive = useCallback((opts: { file?: string; staged?: boolean; base?: boolean; commit?: string }) => (
    !!activeDiffTab &&
    activeDiffTab.file === opts.file &&
    activeDiffTab.staged === opts.staged &&
    activeDiffTab.base === opts.base &&
    activeDiffTab.commit === opts.commit
  ), [activeDiffTab]);
  const selectDiff = useCallback((opts: { file?: string; staged?: boolean; base?: boolean; commit?: string }) => {
    if (isDiffActive(opts) && activeDiffTabIndex >= 0) {
      closeTab(activeDiffTabIndex);
      return;
    }
    openDiff(opts.file, opts.staged, opts.base, opts.commit);
  }, [activeDiffTabIndex, closeTab, isDiffActive, openDiff]);

  // Keep the relevant section open when a diff tab becomes active from the tab strip.
  useEffect(() => {
    if (!status || !activeDiffFile || activeDiffTab?.commit) return;
    const branchDiffFiles = parseDiffFiles(baseDiff?.diff || '');

    setExpandedSections((current) => {
      let target: string | null = null;
      if (activeDiffTab.base) {
        target = 'branch';
      } else if (activeDiffTab.staged) {
        target = 'staged';
      } else if (status.untracked.includes(activeDiffFile)) {
        target = 'untracked';
      } else if (status.unstaged.some((f) => f.path === activeDiffFile)) {
        target = 'unstaged';
      } else if (status.staged.some((f) => f.path === activeDiffFile)) {
        target = 'staged';
      } else if (branchDiffFiles.some((f) => f.path === activeDiffFile)) {
        target = 'branch';
      }

      if (!target || current[target]) return current;
      return { ...current, [target]: true };
    });
  }, [activeDiffFile, activeDiffTab?.base, activeDiffTab?.staged, activeDiffTab?.commit, status, baseDiff?.diff]);

  if (!status) {
    return <WorkbenchFrame><WorkbenchEmpty compact icon={<GitBranch size={18} />} title="Loading changes" /></WorkbenchFrame>;
  }

  const branchName = status.branch.trim();
  const isDetachedHead = branchName === 'HEAD' || branchName.startsWith('HEAD ');
  const showPublish = !isDetachedHead && !status.hasUpstream;
  const hasChanges = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;
  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
  const baseDiffFiles = parseDiffFiles(baseDiff?.diff || '');
  const commits = log?.commits ?? [];

  const allUnstagedFiles = [
    ...status.unstaged.map((f) => f.path),
    ...status.untracked,
  ];

  const handleStageCommitPush = async () => {
    if (!commitMsg.trim()) return;
    if (allUnstagedFiles.length > 0) await stage(allUnstagedFiles);
    await commit({ message: commitMsg.trim() });
    setCommitMsg('');
    await push({});
  };

  const handleAmendForcePush = async () => {
    if (allUnstagedFiles.length > 0) await stage(allUnstagedFiles);
    await commit({ message: '', amend: true });
    await push({ force: true });
  };

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Stage, commit, push',
      description: 'Stages unstaged files first',
      icon: Rocket,
      onClick: handleStageCommitPush,
      disabled: isCommitting || isPushing || !commitMsg.trim(),
    },
    {
      label: 'Amend and force push',
      description: 'Stages everything, amends HEAD, then force pushes',
      icon: Hammer,
      onClick: handleAmendForcePush,
      disabled: isCommitting || isPushing,
      danger: true,
    },
    { label: '', onClick: () => {}, divider: true },
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
    <WorkbenchFrame>
      <div className="shrink-0 px-2 py-2">
        <div className="flex items-center gap-1.5">
          <WorkbenchSearchInput
            icon={<GitCommit size={13} />}
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Commit message"
          />
          <WorkbenchButton
            variant="primary"
            icon={<GitCommit size={13} />}
            onClick={handleCommit}
            disabled={!commitMsg.trim() || status.staged.length === 0 || isCommitting}
            title={status.staged.length === 0 ? 'Stage changes before committing' : 'Commit staged changes'}
          >
            {isCommitting ? 'Committing' : 'Commit'}
          </WorkbenchButton>
          <button
            ref={menuBtnRef}
            type="button"
            onClick={openMenu}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] md:h-8 md:w-8"
            title="More git actions"
            aria-label="More git actions"
          >
            <MoreVertical size={15} />
          </button>
        </div>

        {error && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--color-error)]/10 px-2 py-1.5 text-xs text-[var(--color-error)]">
            <span className="min-w-0 flex-1 truncate">
              {error instanceof Error ? error.message : String(error)}
            </span>
            <button type="button" onClick={clearErrors} className="shrink-0 rounded p-0.5 hover:bg-[var(--color-error)]/10" aria-label="Dismiss git error">
              <X size={12} />
            </button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
          <WorkbenchMeta>
            <GitBranch size={11} />
            <span className="min-w-0 max-w-40 truncate font-mono">{status.branch}</span>
          </WorkbenchMeta>
          <WorkbenchMeta className={hasChanges ? '' : 'text-[var(--color-success)]'}>
            {hasChanges ? `${totalChanges} changed` : 'Clean'}
          </WorkbenchMeta>
          {status.operation && <WorkbenchMeta>{status.operation}</WorkbenchMeta>}
          {status.behind > 0 && (
            <WorkbenchButton
              className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
              icon={<ArrowDown size={10} />}
              onClick={() => pull()}
              disabled={isPulling}
            >
              {isPulling ? 'Pulling' : status.behind}
            </WorkbenchButton>
          )}
          {status.ahead > 0 && (
            <WorkbenchButton
              className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
              icon={<ArrowUp size={10} />}
              onClick={() => push({})}
              disabled={isPushing}
            >
              {isPushing ? 'Pushing' : status.ahead}
            </WorkbenchButton>
          )}
          {showPublish && (
            <WorkbenchButton
              className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
              icon={<ArrowUp size={10} />}
              onClick={() => push({})}
              disabled={isPushing}
              title="Publish branch to remote"
            >
              {isPushing ? 'Publishing' : 'Publish'}
            </WorkbenchButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        <WorkbenchSection
          title="Branch changes"
          count={baseDiffFiles.length}
          expanded={expandedSections.branch}
          onToggle={() => toggleSection('branch')}
          actions={
            <WorkbenchButton
              className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
              icon={<ExternalLink size={10} />}
              onClick={() => selectDiff({ base: true })}
              disabled={!baseDiff?.diff}
              title="Open full branch diff"
            >
              Full diff
            </WorkbenchButton>
          }
        >
          {baseDiffFiles.length > 0 ? (
            baseDiffFiles.map((f) => (
              <BranchFileEntry
                key={f.path}
                path={f.path}
                additions={f.additions}
                deletions={f.deletions}
                active={isBaseDiffTab && activeDiffFile === f.path}
                onClick={() => selectDiff({ file: f.path, base: true })}
              />
            ))
          ) : (
            <WorkbenchEmpty compact title="No branch changes" />
          )}
        </WorkbenchSection>

        {!hasChanges && (
          <WorkbenchEmpty compact icon={<CheckCircle2 size={18} />} title="Working tree clean" />
        )}

        {status.staged.length > 0 && (
          <WorkbenchSection
            title="Staged"
            count={status.staged.length}
            expanded={expandedSections.staged}
            onToggle={() => toggleSection('staged')}
            actions={
              <WorkbenchButton
                className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
                icon={<Minus size={10} />}
                onClick={() => unstage(status.staged.map((f) => f.path))}
                title="Unstage all"
              >
                Unstage all
              </WorkbenchButton>
            }
          >
            {status.staged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="staged"
                onUnstage={() => unstage([f.path])}
                onClick={() => selectDiff({ file: f.path, staged: true })}
                active={isStagedDiffTab && activeDiffFile === f.path}
              />
            ))}
          </WorkbenchSection>
        )}

        {status.unstaged.length > 0 && (
          <WorkbenchSection
            title="Changes"
            count={status.unstaged.length}
            expanded={expandedSections.unstaged}
            onToggle={() => toggleSection('unstaged')}
            actions={
              <>
                <WorkbenchButton
                  className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
                  icon={<Plus size={10} />}
                  onClick={() => stage(status.unstaged.map((f) => f.path))}
                  title="Stage all"
                >
                  Stage all
                </WorkbenchButton>
                <WorkbenchIconButton
                  className="h-6 w-6 md:h-6 md:w-6"
                  danger
                  label="Discard all unstaged changes"
                  onClick={() =>
                    confirmRevert(
                      status.unstaged.map((f) => f.path),
                      [],
                      `${status.unstaged.length} file${status.unstaged.length !== 1 ? 's' : ''}`,
                    )
                  }
                >
                  <Undo2 size={12} />
                </WorkbenchIconButton>
              </>
            }
          >
            {status.unstaged.map((f) => (
              <FileEntry
                key={f.path}
                file={f}
                section="unstaged"
                onStage={() => stage([f.path])}
                onRevert={() => confirmRevert([f.path], [], f.path)}
                onClick={() => selectDiff({ file: f.path, staged: false })}
                active={isUnstagedDiffTab && activeDiffFile === f.path}
              />
            ))}
          </WorkbenchSection>
        )}

        {status.untracked.length > 0 && (
          <WorkbenchSection
            title="Untracked"
            count={status.untracked.length}
            expanded={expandedSections.untracked}
            onToggle={() => toggleSection('untracked')}
            actions={
              <>
                <WorkbenchButton
                  className="h-6 px-1.5 text-[10px] md:h-6 md:px-1.5"
                  icon={<Plus size={10} />}
                  onClick={() => stage(status.untracked)}
                  title="Stage all"
                >
                  Stage all
                </WorkbenchButton>
                <WorkbenchIconButton
                  className="h-6 w-6 md:h-6 md:w-6"
                  danger
                  label="Delete all untracked files"
                  onClick={() =>
                    confirmRevert(
                      [],
                      status.untracked,
                      `${status.untracked.length} untracked file${status.untracked.length !== 1 ? 's' : ''}`,
                    )
                  }
                >
                  <Undo2 size={12} />
                </WorkbenchIconButton>
              </>
            }
          >
            {status.untracked.map((path) => (
              <FileEntry
                key={path}
                file={{ path, status: 'A' }}
                section="untracked"
                onStage={() => stage([path])}
                onRevert={() => confirmRevert([], [path], path)}
                onClick={() => selectDiff({ file: path, staged: false })}
                active={isUnstagedDiffTab && activeDiffFile === path}
              />
            ))}
          </WorkbenchSection>
        )}

        <WorkbenchSection
          title="Recent commits"
          count={commits.length}
          expanded={expandedSections.history}
          onToggle={() => toggleSection('history')}
        >
          {commits.length > 0 ? (
            commits.map((c) => (
              <CommitEntry
                key={c.hash}
                commit={c}
                onOpenDiff={(hash) => selectDiff({ commit: hash })}
                isActive={activeDiffTab?.commit === c.hash}
              />
            ))
          ) : (
            <WorkbenchEmpty compact icon={<History size={18} />} title="No commits yet" />
          )}
        </WorkbenchSection>
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
        <div className="px-5 py-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => confirmAction?.onConfirm()}>
            Discard
          </Button>
        </div>
      </Modal>
    </WorkbenchFrame>
  );
}

/* ── Branch entry ────────────────────────────────────────────────── */

function BranchFileEntry({
  path,
  additions,
  deletions,
  active,
  onClick,
}: {
  path: string;
  additions: number;
  deletions: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <WorkbenchRow active={active} onClick={onClick} className="group">
      <span className="w-5 shrink-0 text-center font-mono text-[11px] text-dim">&Delta;</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{path}</span>
      {additions > 0 && <span className="shrink-0 font-mono text-[11px] text-[var(--color-success)]">+{additions}</span>}
      {deletions > 0 && <span className="shrink-0 font-mono text-[11px] text-[var(--color-error)]">-{deletions}</span>}
    </WorkbenchRow>
  );
}

/* ── Commit entry with hover tooltip ─────────────────────────────── */

function CommitEntry({
  commit,
  onOpenDiff,
  isActive,
}: {
  commit: GitLogEntry;
  onOpenDiff: (hash: string) => void;
  isActive?: boolean;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback(() => {
    if (!rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setTooltip({ x: rect.right + 8, y: rect.top });
    }, 250);
  }, []);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <>
      <div
        ref={rowRef}
        className={`group mx-1.5 flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
          isActive ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'hover:bg-[var(--color-card)]'
        }`}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onClick={() => onOpenDiff(commit.hash)}
      >
        <GitCommit size={10} className="text-dim shrink-0" />
        <span className="truncate text-[var(--color-text-primary)]">{commit.message}</span>
        <span className="text-[10px] text-dim shrink-0 ml-auto">{relativeTime(commit.date)}</span>
      </div>

      {/* Tooltip portal */}
      {tooltip && <CommitTooltip commit={commit} position={tooltip} />}
    </>
  );
}

function CommitTooltip({ commit, position }: { commit: GitLogEntry; position: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);

  // Adjust position if it would go off-screen
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const el = ref.current;
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${position.x - rect.width - 16}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [position]);

  const statsLine = [
    commit.filesChanged > 0 && `${commit.filesChanged} file${commit.filesChanged !== 1 ? 's' : ''} changed`,
    commit.additions > 0 && `${commit.additions} insertion${commit.additions !== 1 ? 's' : ''}`,
    commit.deletions > 0 && `${commit.deletions} deletion${commit.deletions !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ');

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] w-72 overflow-hidden rounded-lg bg-card shadow-[var(--shadow-card-hover)] pointer-events-none"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2">
          <GitCommit size={12} className="text-accent shrink-0" />
          <span className="font-mono text-xs text-accent">{commit.shortHash}</span>
          <span className="font-mono text-[10px] text-dim truncate">{commit.hash}</span>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-primary)] leading-snug">{commit.message}</p>
          {commit.body && (
            <p className="text-[11px] text-dim mt-1 leading-relaxed whitespace-pre-wrap line-clamp-4">{commit.body}</p>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div
            className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-medium shrink-0"
          >
            {commit.author.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <span className="text-[var(--color-text-primary)]">{commit.author}</span>
            <span className="text-dim ml-1">&lt;{commit.authorEmail}&gt;</span>
          </div>
        </div>
        <div className="text-[11px] text-dim">
          {formatDate(commit.date)}
          <span className="ml-1.5 text-[10px]">({relativeTime(commit.date)})</span>
        </div>

        {statsLine && (
          <div className="flex items-center gap-1.5 pt-1 text-[11px]">
            {commit.additions > 0 && (
              <span className="font-mono text-[var(--color-success)]">+{commit.additions}</span>
            )}
            {commit.deletions > 0 && (
              <span className="font-mono text-[var(--color-error)]">-{commit.deletions}</span>
            )}
            <span className="text-dim">{statsLine}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── File entry ──────────────────────────────────────────────────── */

function FileEntry({
  file,
  section,
  onStage,
  onUnstage,
  onRevert,
  onClick,
  active,
}: {
  file: GitFileStatus;
  section: 'staged' | 'unstaged' | 'untracked';
  onStage?: () => void;
  onUnstage?: () => void;
  onRevert?: () => void;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <WorkbenchRow active={active} onClick={onClick} className="group text-[13px]">
      <span className={`w-5 shrink-0 text-center font-mono text-[11px] ${statusColor(file.status)}`}>
        {statusLabel(file.status)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path}</span>
      {file.additions !== undefined && file.additions > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-success)]">+{file.additions}</span>
      )}
      {file.deletions !== undefined && file.deletions > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-error)]">-{file.deletions}</span>
      )}
      <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100">
        {section === 'staged' && onUnstage && (
          <button onClick={(e) => { e.stopPropagation(); onUnstage(); }} className="rounded p-1 text-dim hover:bg-[var(--color-card-hover)] hover:text-accent" title="Unstage">
            <Minus size={13} />
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onStage && (
          <button onClick={(e) => { e.stopPropagation(); onStage(); }} className="rounded p-1 text-dim hover:bg-[var(--color-card-hover)] hover:text-accent" title="Stage">
            <Plus size={13} />
          </button>
        )}
        {(section === 'unstaged' || section === 'untracked') && onRevert && (
          <button onClick={(e) => { e.stopPropagation(); onRevert(); }} className="rounded p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]" title="Revert">
            <Undo2 size={13} />
          </button>
        )}
      </div>
    </WorkbenchRow>
  );
}
