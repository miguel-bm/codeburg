import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../../api';
import type { GitFileStatus } from '../../api';

interface GitPanelProps {
  taskId: string;
  onFileClick: (file: string, staged: boolean) => void;
  selectedFile?: string;
  selectedStaged?: boolean;
  scrollable?: boolean;
}

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

function Icon({ children, className, viewBox = '0 0 20 20' }: { children: React.ReactNode; className?: string; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      className={className || 'w-4 h-4'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="4" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="10" cy="16" r="1.6" />
    </svg>
  );
}

export function GitPanel({ taskId, onFileClick, selectedFile, selectedStaged, scrollable = true }: GitPanelProps) {
  const queryClient = useQueryClient();
  const [commitMsg, setCommitMsg] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showStaged, setShowStaged] = useState(true);
  const [showUnstaged, setShowUnstaged] = useState(true);
  const [showUntracked, setShowUntracked] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['git-status', taskId],
    queryFn: () => gitApi.status(taskId),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['git-status', taskId] });
  };

  const stageMutation = useMutation({
    mutationFn: (files: string[]) => gitApi.stage(taskId, files),
    onSuccess: invalidateGit,
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => gitApi.unstage(taskId, files),
    onSuccess: invalidateGit,
  });

  const revertMutation = useMutation({
    mutationFn: (payload: { tracked?: string[]; untracked?: string[] }) => gitApi.revert(taskId, payload),
    onSuccess: invalidateGit,
  });

  const commitMutation = useMutation({
    mutationFn: ({ message, amend }: { message: string; amend?: boolean }) =>
      gitApi.commit(taskId, message, amend),
    onSuccess: () => {
      invalidateGit();
      setCommitMsg('');
    },
  });

  const stashMutation = useMutation({
    mutationFn: (action: 'push' | 'pop') => gitApi.stash(taskId, action),
    onSuccess: invalidateGit,
  });

  const pullMutation = useMutation({
    mutationFn: () => gitApi.pull(taskId),
    onSuccess: invalidateGit,
  });

  const pushMutation = useMutation({
    mutationFn: () => gitApi.push(taskId),
    onSuccess: invalidateGit,
  });

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  if (isLoading) {
    return <div className="p-3 text-xs text-dim">Loading git...</div>;
  }

  if (!status) {
    return <div className="p-3 text-xs text-dim">No git info</div>;
  }

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
  const canCommit = commitMsg.trim() && status.staged.length > 0 && !commitMutation.isPending;
  const stageAllFiles = [...status.unstaged.map((f) => f.path), ...status.untracked];
  const canStageAll = stageAllFiles.length > 0 && !stageMutation.isPending;
  const canRevertAny = totalChanges > 0 && !revertMutation.isPending;

  const handleRevert = (tracked: string[], untracked: string[], label: string) => {
    if (!tracked.length && !untracked.length) return;
    if (!window.confirm(`Discard changes for ${label}? This cannot be undone.`)) return;
    revertMutation.mutate({ tracked, untracked });
  };

  return (
    <div className={`flex flex-col text-xs ${scrollable ? 'h-full min-h-0' : ''}`}>
      {/* Commit row (top) */}
      <div className="px-3 py-2 border-b border-subtle flex items-center gap-1">
        <input
          type="text"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCommit) {
              commitMutation.mutate({ message: commitMsg.trim() });
            }
          }}
          placeholder="Commit message..."
          className="flex-1 min-w-0 bg-primary border border-subtle rounded-md px-2 py-1 text-xs focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
        <button
          onClick={() => commitMutation.mutate({ message: commitMsg.trim() })}
          disabled={!canCommit}
          className="px-2 py-1 bg-accent text-white rounded-md font-medium hover:bg-accent-dim transition-colors disabled:opacity-30 shrink-0"
        >
          {commitMutation.isPending ? '...' : 'Commit'}
        </button>
        <button
          onClick={() => stageMutation.mutate(stageAllFiles)}
          disabled={!canStageAll}
          className="px-2 py-1 bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-30 shrink-0 flex items-center gap-1"
          title="Stage all changes"
        >
          <Icon className="w-3.5 h-3.5">
            <path d="M10 4v12M4 10h12" />
          </Icon>
          Stage all
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-1.5 py-1 bg-tertiary text-dim rounded-md hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors shrink-0"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            <DotsIcon />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-elevated border border-subtle rounded-md shadow-md z-10 min-w-[140px] overflow-hidden">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-dim bg-secondary">Actions</div>
              <button
                onClick={() => {
                  commitMutation.mutate({ message: commitMsg.trim(), amend: true });
                  setShowMenu(false);
                }}
                disabled={commitMutation.isPending}
                className="w-full text-left px-3 py-2 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30 flex items-center gap-2"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M4 10a6 6 0 1 0 2-4.5" />
                  <path d="M3 4v4h4" />
                </Icon>
                Amend last commit
              </button>
              <button
                onClick={() => {
                  stashMutation.mutate('push');
                  setShowMenu(false);
                }}
                disabled={stashMutation.isPending || totalChanges === 0}
                className="w-full text-left px-3 py-2 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30 flex items-center gap-2"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M4 7h12v9H4z" />
                  <path d="M7 7V4h6v3" />
                </Icon>
                Stash changes
              </button>
              <button
                onClick={() => {
                  stashMutation.mutate('pop');
                  setShowMenu(false);
                }}
                disabled={stashMutation.isPending}
                className="w-full text-left px-3 py-2 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30 flex items-center gap-2"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M4 7h12v9H4z" />
                  <path d="M10 12V8" />
                  <path d="M8 10l2-2 2 2" />
                </Icon>
                Pop stash
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {(commitMutation.error || stashMutation.error || revertMutation.error || stageMutation.error || unstageMutation.error || pullMutation.error || pushMutation.error) && (
        <div className="px-3 py-1 text-[var(--color-error)] text-xs border-b border-subtle">
          {commitMutation.error?.message
            || stashMutation.error?.message
            || revertMutation.error?.message
            || stageMutation.error?.message
            || unstageMutation.error?.message
            || pullMutation.error?.message
            || pushMutation.error?.message}
        </div>
      )}

      {/* Branch bar */}
      <div className="px-3 py-1.5 border-b border-subtle flex items-center justify-between gap-2">
        <span className="font-mono text-accent truncate">{status.branch}</span>
        <div className="flex items-center gap-2 text-dim shrink-0">
          {status.ahead > 0 && <span>&uarr;{status.ahead}</span>}
          {status.behind > 0 && <span>&darr;{status.behind}</span>}
        </div>
      </div>

      <div className={`${scrollable ? 'flex-1 min-h-0 overflow-y-auto' : ''}`}>
        {(status.ahead > 0 || status.behind > 0) && (
          <div className="px-3 py-2 border-b border-subtle bg-secondary">
            <div className="flex items-center gap-2 text-dim text-[11px]">
              <span className="uppercase tracking-wide">Sync</span>
              <span>
                {status.behind > 0 && `${status.behind} to pull`}
                {status.behind > 0 && status.ahead > 0 && ' · '}
                {status.ahead > 0 && `${status.ahead} to push`}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => pullMutation.mutate()}
                disabled={status.behind === 0 || pullMutation.isPending}
                className="px-2 py-1 bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-30 shrink-0 flex items-center gap-1 text-xs"
                title="Pull (fast-forward only)"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M7 4v8" />
                  <path d="M5 10l2 2 2-2" />
                  <path d="M13 16V8" />
                  <path d="M11 8l2-2 2 2" />
                </Icon>
                Pull
              </button>
              <button
                onClick={() => pushMutation.mutate()}
                disabled={status.ahead === 0 || pushMutation.isPending}
                className="px-2 py-1 bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-30 shrink-0 flex items-center gap-1 text-xs"
                title="Push current branch"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M7 16V8" />
                  <path d="M5 8l2-2 2 2" />
                  <path d="M13 4v8" />
                  <path d="M11 10l2 2 2-2" />
                </Icon>
                Push
              </button>
            </div>
            <div className="mt-1 text-[10px] text-dim">
              Pull is fast-forward only. Push uses the current branch.
            </div>
          </div>
        )}
        {totalChanges === 0 && (
          <div className="p-3 text-dim text-center">Clean working tree</div>
        )}

        {/* Staged */}
        {status.staged.length > 0 && (
          <Section
            title={`staged (${status.staged.length})`}
            open={showStaged}
            onToggle={() => setShowStaged(!showStaged)}
            actions={(
              <button
                onClick={() => handleRevert(status.staged.map((f) => f.path), [], `${status.staged.length} staged file${status.staged.length !== 1 ? 's' : ''}`)}
                disabled={!canRevertAny}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-1"
                title="Discard all staged changes"
              >
                <Icon className="w-3.5 h-3.5">
                  <path d="M6 6h7a4 4 0 1 1 0 8H7" />
                  <path d="M7 8l-2 2 2 2" />
                </Icon>
                Revert all
              </button>
            )}
          >
            {status.staged.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                action="unstage"
                onAction={() => unstageMutation.mutate([f.path])}
                onClick={() => onFileClick(f.path, true)}
                onRevert={() => handleRevert([f.path], [], f.path)}
                selected={selectedFile === f.path && selectedStaged === true}
              />
            ))}
          </Section>
        )}

        {/* Unstaged */}
        {status.unstaged.length > 0 && (
          <Section
            title={`changes (${status.unstaged.length})`}
            open={showUnstaged}
            onToggle={() => setShowUnstaged(!showUnstaged)}
            actions={(
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stageMutation.mutate(status.unstaged.map((f) => f.path))}
                  disabled={status.unstaged.length === 0 || stageMutation.isPending}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-1"
                  title="Stage all changes"
                >
                  <Icon className="w-3.5 h-3.5">
                    <path d="M10 4v12M4 10h12" />
                  </Icon>
                  Stage all
                </button>
                <button
                  onClick={() => handleRevert(status.unstaged.map((f) => f.path), [], `${status.unstaged.length} file${status.unstaged.length !== 1 ? 's' : ''}`)}
                  disabled={!canRevertAny}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-1"
                  title="Discard all unstaged changes"
                >
                  <Icon className="w-3.5 h-3.5">
                    <path d="M6 6h7a4 4 0 1 1 0 8H7" />
                    <path d="M7 8l-2 2 2 2" />
                  </Icon>
                  Revert all
                </button>
              </div>
            )}
          >
            {status.unstaged.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                action="stage"
                onAction={() => stageMutation.mutate([f.path])}
                onClick={() => onFileClick(f.path, false)}
                onRevert={() => handleRevert([f.path], [], f.path)}
                selected={selectedFile === f.path && selectedStaged === false}
              />
            ))}
          </Section>
        )}

        {/* Untracked */}
        {status.untracked.length > 0 && (
          <Section
            title={`untracked (${status.untracked.length})`}
            open={showUntracked}
            onToggle={() => setShowUntracked(!showUntracked)}
            actions={(
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stageMutation.mutate(status.untracked)}
                  disabled={status.untracked.length === 0 || stageMutation.isPending}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-1"
                  title="Stage all untracked files"
                >
                  <Icon className="w-3.5 h-3.5">
                    <path d="M10 4v12M4 10h12" />
                  </Icon>
                  Stage all
                </button>
                <button
                  onClick={() => handleRevert([], status.untracked, `${status.untracked.length} untracked file${status.untracked.length !== 1 ? 's' : ''}`)}
                  disabled={!canRevertAny}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] disabled:opacity-40 flex items-center gap-1"
                  title="Delete all untracked files"
                >
                  <Icon className="w-3.5 h-3.5">
                    <path d="M6 6h7a4 4 0 1 1 0 8H7" />
                    <path d="M7 8l-2 2 2 2" />
                  </Icon>
                  Revert all
                </button>
              </div>
            )}
          >
            {status.untracked.map((path) => (
              <FileRow
                key={path}
                file={{ path, status: '?' }}
                action="stage"
                onAction={() => stageMutation.mutate([path])}
                onClick={() => onFileClick(path, false)}
                onRevert={() => handleRevert([], [path], path)}
                selected={selectedFile === path && selectedStaged === false}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, open, onToggle, actions, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-subtle">
      <div className="flex items-center justify-between px-3 py-1.5 text-dim">
        <button
          onClick={onToggle}
          className="text-left hover:text-[var(--color-text-primary)] transition-colors flex items-center gap-1"
        >
          <Icon className="w-3.5 h-3.5">
            {open ? <path d="M5 7l5 6 5-6" /> : <path d="M7 5l6 5-6 5" />}
          </Icon>
          <span>{title}</span>
        </button>
        {actions}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

function FileRow({ file, action, onAction, onClick, onRevert, selected }: {
  file: GitFileStatus;
  action: 'stage' | 'unstage';
  onAction: () => void;
  onClick: () => void;
  onRevert: () => void;
  selected: boolean;
}) {
  return (
    <div className={`flex items-center gap-1 px-3 py-0.5 hover:bg-accent/5 group ${selected ? 'bg-accent/10' : ''}`}>
      <span className="text-[var(--color-success)] font-mono w-4 text-center shrink-0">
        {statusLabel(file.status)}
      </span>
      <button
        onClick={onClick}
        className="flex-1 text-left truncate font-mono text-[var(--color-text-primary)] hover:text-accent transition-colors"
        title={file.path}
      >
        {file.path}
      </button>
      {file.additions != null && file.additions > 0 && (
        <span className="text-[var(--color-success)] shrink-0">+{file.additions}</span>
      )}
      {file.deletions != null && file.deletions > 0 && (
        <span className="text-[var(--color-error)] shrink-0">-{file.deletions}</span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          className="text-dim hover:text-accent transition-colors"
          title={action === 'stage' ? 'Stage file' : 'Unstage file'}
          aria-label={action === 'stage' ? 'Stage file' : 'Unstage file'}
        >
          <Icon className="w-3.5 h-3.5">
            {action === 'stage'
              ? <path d="M10 4v12M4 10h12" />
              : <path d="M4 10h12" />}
          </Icon>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRevert(); }}
          className="text-dim hover:text-[var(--color-error)] transition-colors"
          title="Discard changes"
          aria-label="Discard changes"
        >
          <Icon className="w-3.5 h-3.5">
            <path d="M6 6h7a4 4 0 1 1 0 8H7" />
            <path d="M7 8l-2 2 2 2" />
          </Icon>
        </button>
      </div>
    </div>
  );
}
