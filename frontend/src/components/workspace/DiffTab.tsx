import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from './WorkspaceContext';
import { DiffContent } from './DiffContent';
import { parseDiffFiles } from '../git/diffFiles';
import { useWorkspaceStore } from '../../stores/workspace';
import { StyledPath } from './StyledPath';

interface DiffTabProps {
  file?: string;
  staged?: boolean;
  base?: boolean;
  commit?: string;
}

export function DiffTab({ file, staged, base, commit }: DiffTabProps) {
  const { api, scopeType, scopeId } = useWorkspace();
  const { openDiff } = useWorkspaceStore();

  // When a specific file is provided, fetch its diff content
  const { data: diffContent, isLoading: contentLoading, error: contentError } = useQuery({
    queryKey: ['workspace-diff-content', scopeType, scopeId, file, staged, base, commit],
    queryFn: () => api.git.diffContent({ file: file!, staged, base, commit }),
    enabled: !!file,
  });

  // Also fetch raw diff for file-specific +/- stats
  const { data: fileDiff } = useQuery({
    queryKey: ['workspace-diff', scopeType, scopeId, file, staged, base, commit],
    queryFn: () => api.git.diff({ file, staged, base, commit }),
    enabled: !!file,
  });

  const fileStats = !file || !fileDiff?.diff
    ? null
    : (parseDiffFiles(fileDiff.diff)[0] ?? null);

  // Fetch git status (always needed — for file badge when file is set, for overview otherwise)
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['workspace-git-status', scopeType, scopeId],
    queryFn: () => api.git.status(),
  });

  // Also fetch full diff for overview +/- counts
  const { data: overviewDiff } = useQuery({
    queryKey: ['workspace-diff', scopeType, scopeId, undefined, staged, base, commit],
    queryFn: () => api.git.diff({ staged, base, commit }),
    enabled: !file,
  });

  const diffFiles = useMemo(
    () => parseDiffFiles(overviewDiff?.diff || ''),
    [overviewDiff?.diff],
  );

  // File-specific diff view
  if (file) {
    if (contentLoading) {
      return <div className="p-4 text-xs text-dim">loading diff...</div>;
    }

    if (contentError) {
      return <div className="p-4 text-xs text-[var(--color-error)]">{(contentError as Error).message}</div>;
    }

    if (!diffContent) {
      return <div className="p-4 text-xs text-dim">no changes</div>;
    }

    if (diffContent.original === diffContent.modified) {
      return <div className="p-4 text-xs text-dim">no changes</div>;
    }

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-subtle bg-secondary shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <StyledPath path={file} />
            <FileStatusBadge file={file} staged={staged} base={base} />
          </div>
          {fileStats && (fileStats.additions > 0 || fileStats.deletions > 0) && (
            <div className="text-xs shrink-0 ml-2">
              <span className="text-[var(--color-success)]">+{fileStats.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{fileStats.deletions}</span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <DiffContent original={diffContent.original} modified={diffContent.modified} path={file} />
        </div>
      </div>
    );
  }

  // Overview: file list
  if (!commit && statusLoading) {
    return <div className="p-4 text-xs text-dim">loading...</div>;
  }

  const allFiles: { path: string; status: string; additions: number; deletions: number }[] = [];

  if (commit) {
    // For commit diffs, use parsed diff files
    for (const d of diffFiles) {
      allFiles.push({ path: d.path, status: 'M', additions: d.additions, deletions: d.deletions });
    }
  } else if (statusData) {
    if (staged) {
      for (const f of statusData.staged) {
        const stats = diffFiles.find((d) => d.path === f.path);
        allFiles.push({
          path: f.path,
          status: f.status,
          additions: stats?.additions ?? f.additions ?? 0,
          deletions: stats?.deletions ?? f.deletions ?? 0,
        });
      }
    } else if (base) {
      // For base diffs, use parsed diff files directly
      for (const d of diffFiles) {
        allFiles.push({ path: d.path, status: 'M', additions: d.additions, deletions: d.deletions });
      }
    } else {
      for (const f of statusData.unstaged) {
        const stats = diffFiles.find((d) => d.path === f.path);
        allFiles.push({
          path: f.path,
          status: f.status,
          additions: stats?.additions ?? f.additions ?? 0,
          deletions: stats?.deletions ?? f.deletions ?? 0,
        });
      }
      for (const f of statusData.untracked) {
        allFiles.push({ path: f, status: '?', additions: 0, deletions: 0 });
      }
    }
  }

  if (allFiles.length === 0) {
    return <div className="p-4 text-xs text-dim">no changes</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="px-3 py-2 text-[11px] font-medium text-dim border-b border-subtle bg-secondary">
        {allFiles.length} changed file{allFiles.length !== 1 ? 's' : ''}
      </div>
      {allFiles.map((f) => (
        <button
          key={f.path}
          onClick={() => openDiff(f.path, staged, base, commit)}
          className="w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-tertiary border-b border-subtle flex items-center gap-2"
        >
          <StatusBadge status={f.status} />
          <span className="font-mono truncate flex-1">{f.path}</span>
          {(f.additions > 0 || f.deletions > 0) && (
            <span className="text-[10px] shrink-0">
              <span className="text-[var(--color-success)]">+{f.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{f.deletions}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function FileStatusBadge({ file, staged, base }: { file: string; staged?: boolean; base?: boolean }) {
  const { api, scopeType, scopeId } = useWorkspace();
  const { data: status } = useQuery({
    queryKey: ['workspace-git-status', scopeType, scopeId],
    queryFn: () => api.git.status(),
  });

  if (!status) return null;

  let fileStatus: string | undefined;
  if (base) {
    fileStatus = 'M';
  } else if (staged) {
    fileStatus = status.staged.find((f) => f.path === file)?.status;
  } else {
    fileStatus = status.unstaged.find((f) => f.path === file)?.status;
    if (!fileStatus && status.untracked.includes(file)) fileStatus = '?';
  }

  if (!fileStatus) return null;
  return <StatusBadge status={fileStatus} />;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    M: 'text-yellow-500',
    A: 'text-[var(--color-success)]',
    D: 'text-[var(--color-error)]',
    R: 'text-purple-500',
    '?': 'text-[var(--color-success)]',
  };

  return (
    <span className={`text-[10px] font-bold w-3 shrink-0 ${colors[status] || 'text-dim'}`}>
      {status === '?' ? 'U' : status}
    </span>
  );
}
