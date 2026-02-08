import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../../api';
import type { GitFileStatus } from '../../api';

interface GitPanelProps {
  taskId: string;
  onFileClick: (file: string, staged: boolean) => void;
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

export function GitPanel({ taskId, onFileClick }: GitPanelProps) {
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
    return <div className="p-3 text-xs text-dim">loading git...</div>;
  }

  if (!status) {
    return <div className="p-3 text-xs text-dim">no git info</div>;
  }

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
  const canCommit = commitMsg.trim() && status.staged.length > 0 && !commitMutation.isPending;

  return (
    <div className="flex flex-col overflow-y-auto text-xs">
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
          placeholder="commit message..."
          className="flex-1 min-w-0 bg-primary border border-subtle px-2 py-1 text-xs focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => commitMutation.mutate({ message: commitMsg.trim() })}
          disabled={!canCommit}
          className="px-2 py-1 border border-accent text-accent hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-accent shrink-0"
        >
          {commitMutation.isPending ? '...' : 'commit'}
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-1.5 py-1 border border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors shrink-0"
            title="More actions"
          >
            ...
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-secondary border border-subtle z-10 min-w-[100px]">
              <button
                onClick={() => {
                  commitMutation.mutate({ message: commitMsg.trim(), amend: true });
                  setShowMenu(false);
                }}
                disabled={commitMutation.isPending}
                className="w-full text-left px-3 py-1.5 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30"
              >
                amend
              </button>
              <button
                onClick={() => {
                  stashMutation.mutate('push');
                  setShowMenu(false);
                }}
                disabled={stashMutation.isPending || totalChanges === 0}
                className="w-full text-left px-3 py-1.5 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30"
              >
                stash
              </button>
              <button
                onClick={() => {
                  stashMutation.mutate('pop');
                  setShowMenu(false);
                }}
                disabled={stashMutation.isPending}
                className="w-full text-left px-3 py-1.5 text-xs text-dim hover:text-[var(--color-text-primary)] hover:bg-accent/5 transition-colors disabled:opacity-30"
              >
                pop
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {(commitMutation.error || stashMutation.error) && (
        <div className="px-3 py-1 text-[var(--color-error)] text-xs border-b border-subtle">
          {commitMutation.error?.message || stashMutation.error?.message}
        </div>
      )}

      {/* Branch bar */}
      <div className="px-3 py-1.5 border-b border-subtle flex items-center justify-between">
        <span className="font-mono text-accent truncate">{status.branch}</span>
        <div className="flex items-center gap-2 text-dim shrink-0">
          {status.ahead > 0 && <span>&uarr;{status.ahead}</span>}
          {status.behind > 0 && <span>&darr;{status.behind}</span>}
        </div>
      </div>

      {totalChanges === 0 && (
        <div className="p-3 text-dim text-center">clean working tree</div>
      )}

      {/* Staged */}
      {status.staged.length > 0 && (
        <Section
          title={`staged (${status.staged.length})`}
          open={showStaged}
          onToggle={() => setShowStaged(!showStaged)}
        >
          {status.staged.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              action="unstage"
              onAction={() => unstageMutation.mutate([f.path])}
              onClick={() => onFileClick(f.path, true)}
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
        >
          {status.unstaged.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              action="stage"
              onAction={() => stageMutation.mutate([f.path])}
              onClick={() => onFileClick(f.path, false)}
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
        >
          {status.untracked.map((path) => (
            <FileRow
              key={path}
              file={{ path, status: '?' }}
              action="stage"
              onAction={() => stageMutation.mutate([path])}
              onClick={() => onFileClick(path, false)}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-subtle">
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left text-dim hover:text-[var(--color-text-primary)] transition-colors flex items-center gap-1"
      >
        <span className="text-xs">{open ? '\u25BC' : '\u25B6'}</span>
        <span>{title}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function FileRow({ file, action, onAction, onClick }: {
  file: GitFileStatus;
  action: 'stage' | 'unstage';
  onAction: () => void;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-0.5 hover:bg-accent/5 group">
      <span className="text-accent font-mono w-4 text-center shrink-0">
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
        <span className="text-accent shrink-0">+{file.additions}</span>
      )}
      {file.deletions != null && file.deletions > 0 && (
        <span className="text-[var(--color-error)] shrink-0">-{file.deletions}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onAction(); }}
        className="opacity-0 group-hover:opacity-100 text-dim hover:text-accent transition-all shrink-0"
        title={action === 'stage' ? 'Stage file' : 'Unstage file'}
      >
        {action === 'stage' ? '+' : '\u2212'}
      </button>
    </div>
  );
}
