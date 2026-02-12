import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
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
} from 'lucide-react';
import { useWorkspaceGit } from '../../hooks/useWorkspaceGit';
import { useWorkspaceStore } from '../../stores/workspace';
import { parseDiffFiles } from '../git/diffFiles';
import { ContextMenu } from '../ui/ContextMenu';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { GitFileStatus, GitLogEntry } from '../../api/git';
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

  // Draggable divider state — stored as fraction (0..1) of available height
  const [splitFraction, setSplitFraction] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Horizontal divider drag
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const startFraction = splitFraction;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const newFraction = startFraction + delta / containerRect.height;
      setSplitFraction(Math.max(0.15, Math.min(0.85, newFraction)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [splitFraction]);

  if (!status) {
    return <div className="flex items-center justify-center h-20 text-xs text-dim">Loading git status...</div>;
  }

  const hasChanges = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;
  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
  const baseDiffFiles = parseDiffFiles(baseDiff?.diff || '');
  const commits = log?.commits ?? [];

  const allUnstagedFiles = [
    ...status.unstaged.map((f) => f.path),
    ...status.untracked,
  ];

  const handleYeet = async () => {
    if (!commitMsg.trim()) return;
    if (allUnstagedFiles.length > 0) await stage(allUnstagedFiles);
    await commit({ message: commitMsg.trim() });
    setCommitMsg('');
    await push({});
  };

  const handleStomp = async () => {
    if (allUnstagedFiles.length > 0) await stage(allUnstagedFiles);
    await commit({ message: '', amend: true });
    await push({ force: true });
  };

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Yeet',
      description: 'Stage all, commit with message, push',
      icon: Rocket,
      onClick: handleYeet,
      disabled: isCommitting || isPushing || !commitMsg.trim(),
    },
    {
      label: 'Stomp',
      description: 'Stage all, amend last commit, force push',
      icon: Hammer,
      onClick: handleStomp,
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Split area: changes (top) + commits (bottom) */}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0">
        {/* Changes pane */}
        <div className="overflow-auto" style={{ height: `${splitFraction * 100}%` }}>
          {/* Sticky header: commit input + error + branch */}
          <div className="sticky top-0 z-10 bg-card">
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
                      onClick={() => push({})}
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
          </div>

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
                  <span className="w-4 text-center text-[10px] font-mono text-dim">&Delta;</span>
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

        {/* Draggable horizontal divider */}
        <div
          className="h-[3px] shrink-0 cursor-row-resize bg-[var(--color-border-subtle)] hover:bg-accent active:bg-accent transition-colors"
          onMouseDown={handleDividerMouseDown}
        />

        {/* Commits pane */}
        <div className="overflow-auto min-h-0" style={{ height: `${(1 - splitFraction) * 100}%` }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 bg-secondary">
            <span className="text-[11px] font-medium text-dim">
              Commits {commits.length > 0 && <span className="text-[10px]">({commits.length})</span>}
            </span>
          </div>
          {commits.length > 0 ? (
            commits.map((c) => (
              <CommitEntry key={c.hash} commit={c} onOpenDiff={(hash) => openDiff(undefined, undefined, undefined, hash)} />
            ))
          ) : (
            <div className="px-2 py-3 text-[11px] text-dim">No commits</div>
          )}
        </div>
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

/* ── Commit entry with hover tooltip ─────────────────────────────── */

function CommitEntry({ commit, onOpenDiff }: { commit: GitLogEntry; onOpenDiff: (hash: string) => void }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback(() => {
    if (!rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setTooltip({ x: rect.right + 8, y: rect.top });
    }, 400);
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
        className="flex items-center gap-1.5 px-2 py-1 group hover:bg-tertiary cursor-pointer text-xs"
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
      className="fixed z-[200] w-80 bg-card rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-card-hover)] overflow-hidden pointer-events-none"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-subtle bg-secondary">
        <div className="flex items-center gap-2">
          <GitCommit size={12} className="text-accent shrink-0" />
          <span className="font-mono text-xs text-accent">{commit.shortHash}</span>
          <span className="font-mono text-[10px] text-dim truncate">{commit.hash}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Message */}
        <div>
          <p className="text-xs font-medium text-[var(--color-text-primary)] leading-snug">{commit.message}</p>
          {commit.body && (
            <p className="text-[11px] text-dim mt-1 leading-relaxed whitespace-pre-wrap line-clamp-4">{commit.body}</p>
          )}
        </div>

        {/* Author & date */}
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

        {/* Stats */}
        {statsLine && (
          <div className="flex items-center gap-1.5 text-[11px] pt-1 border-t border-subtle">
            {commit.additions > 0 && (
              <span className="text-green-500 font-mono">+{commit.additions}</span>
            )}
            {commit.deletions > 0 && (
              <span className="text-red-500 font-mono">-{commit.deletions}</span>
            )}
            <span className="text-dim">{statsLine}</span>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-subtle bg-secondary text-[10px] text-dim">
        Click to view diff
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
      <div className="sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-0.5">
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

/* ── Collapsible section ─────────────────────────────────────────── */

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
          className="flex items-center gap-1 text-[11px] font-medium text-dim hover:text-[var(--color-text-primary)]"
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
