import { GitPullRequest } from 'lucide-react';
import type { Task, GitStatus } from '../../api';

interface TaskGitMetaBarProps {
  task: Task;
  gitStatus?: Pick<GitStatus, 'ahead' | 'behind'>;
  onCreatePr?: () => void;
  createPrPending?: boolean;
  createPrLabel?: string;
  createPrPendingLabel?: string;
  className?: string;
  prLinkClassName?: string;
}

export function TaskGitMetaBar({
  task,
  gitStatus,
  onCreatePr,
  createPrPending = false,
  createPrLabel = 'Push & Create PR',
  createPrPendingLabel = 'Creating PR...',
  className,
  prLinkClassName,
}: TaskGitMetaBarProps) {
  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const hasLeadingInfo = !!task.branch || !!task.diffStats || ahead > 0 || behind > 0;
  const hasTrailingInfo = !!task.prUrl || !!onCreatePr;

  if (!hasLeadingInfo && !hasTrailingInfo) {
    return null;
  }

  return (
    <div className={className || 'flex items-center gap-3 px-4 py-1.5 border-b border-subtle bg-secondary text-xs'}>
      {task.branch && <span className="font-mono text-dim">{task.branch}</span>}
      {task.diffStats && (
        <span>
          <span className="text-[var(--color-success)]">+{task.diffStats.additions}</span>{' '}
          <span className="text-[var(--color-error)]">-{task.diffStats.deletions}</span>
        </span>
      )}
      {(ahead > 0 || behind > 0) && (
        <span className="text-dim">
          {ahead > 0 && <span>{ahead} ahead</span>}
          {ahead > 0 && behind > 0 && ', '}
          {behind > 0 && <span>{behind} behind</span>}
        </span>
      )}

      {hasTrailingInfo && <span className="ml-auto" />}

      {task.prUrl ? (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={prLinkClassName || 'text-accent hover:underline font-mono truncate'}
        >
          {task.prUrl.replace(/^https?:\/\/github\.com\//, '')}
        </a>
      ) : (
        onCreatePr && (
          <button
            onClick={onCreatePr}
            disabled={createPrPending}
            className="px-2 py-1 bg-accent text-white rounded text-xs hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            <GitPullRequest size={12} />
            {createPrPending ? createPrPendingLabel : createPrLabel}
          </button>
        )
      )}
    </div>
  );
}
