import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePenLine, X } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { DiffContent } from './DiffContent';
import { parseDiffFiles } from '../git/diffFiles';
import { useWorkspaceStore } from '../../stores/workspace';
import { StyledPath } from './StyledPath';

const MAX_AUTO_EXPANDED_FILES = 12;
const LARGE_DIFF_LINE_LIMIT = 900;

interface DiffTabProps {
  file?: string;
  staged?: boolean;
  base?: boolean;
  commit?: string;
  onClose?: () => void;
}

export function DiffTab({ file, staged, base, commit, onClose }: DiffTabProps) {
  const { api, scopeType, scopeId } = useWorkspace();
  const { openDiff, openFile } = useWorkspaceStore();
  const [showAllFiles, setShowAllFiles] = useState(false);

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
  const allFiles = useMemo(() => {
    const files: { path: string; status: string; additions: number; deletions: number }[] = [];

    if (commit) {
      for (const d of diffFiles) {
        files.push({ path: d.path, status: 'M', additions: d.additions, deletions: d.deletions });
      }
    } else if (statusData) {
      if (staged) {
        for (const f of statusData.staged) {
          const stats = diffFiles.find((d) => d.path === f.path);
          files.push({
            path: f.path,
            status: f.status,
            additions: stats?.additions ?? f.additions ?? 0,
            deletions: stats?.deletions ?? f.deletions ?? 0,
          });
        }
      } else if (base) {
        for (const d of diffFiles) {
          files.push({ path: d.path, status: 'M', additions: d.additions, deletions: d.deletions });
        }
      } else {
        for (const f of statusData.unstaged) {
          const stats = diffFiles.find((d) => d.path === f.path);
          files.push({
            path: f.path,
            status: f.status,
            additions: stats?.additions ?? f.additions ?? 0,
            deletions: stats?.deletions ?? f.deletions ?? 0,
          });
        }
        for (const f of statusData.untracked) {
          files.push({ path: f, status: '?', additions: 0, deletions: 0 });
        }
      }
    }

    return files;
  }, [base, commit, diffFiles, staged, statusData]);

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
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-subtle bg-canvas shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <StyledPath path={file} />
            <FileStatusBadge file={file} staged={staged} base={base} />
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={() => openFile(file, undefined, { ephemeral: false, forceNew: true })}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-dim hover:text-accent hover:bg-accent/10 transition-colors"
              title="Open in editor tab"
            >
              <FilePenLine size={11} />
              <span>Open in editor</span>
            </button>
            {fileStats && (fileStats.additions > 0 || fileStats.deletions > 0) && (
              <div className="text-xs">
                <span className="text-[var(--color-success)]">+{fileStats.additions}</span>
                {' '}
                <span className="text-[var(--color-error)]">-{fileStats.deletions}</span>
              </div>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-dim hover:bg-tertiary hover:text-[var(--color-text-primary)]"
                title="Close diff"
                aria-label="Close diff"
              >
                <X size={13} />
              </button>
            )}
          </div>
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

  if (allFiles.length === 0) {
    return <div className="p-4 text-xs text-dim">no changes</div>;
  }

  const visibleFiles = showAllFiles ? allFiles : allFiles.slice(0, MAX_AUTO_EXPANDED_FILES);
  const remainingFiles = allFiles.length - visibleFiles.length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 text-[11px] font-medium text-dim shadow-[inset_0_-1px_0_var(--color-card-border)]">
        <span>{allFiles.length} changed file{allFiles.length !== 1 ? 's' : ''} expanded</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dim hover:bg-tertiary hover:text-[var(--color-text-primary)]"
            title="Close diff"
            aria-label="Close diff"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visibleFiles.map((f) => (
          <ExpandedDiffFile
            key={`${f.path}:${staged ? 'staged' : ''}:${base ? 'base' : ''}:${commit ?? ''}`}
            file={f}
            staged={staged}
            base={base}
            commit={commit}
            onOpenFile={() => openFile(f.path, undefined, { ephemeral: false, forceNew: true })}
            onOpenFocusedDiff={() => openDiff(f.path, staged, base, commit)}
          />
        ))}
        {remainingFiles > 0 && (
          <div className="flex items-center justify-center px-3 py-5">
            <button
              type="button"
              onClick={() => setShowAllFiles(true)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
            >
              Show {remainingFiles} more changed file{remainingFiles !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandedDiffFile({
  file,
  staged,
  base,
  commit,
  onOpenFile,
  onOpenFocusedDiff,
}: {
  file: { path: string; status: string; additions: number; deletions: number };
  staged?: boolean;
  base?: boolean;
  commit?: string;
  onOpenFile: () => void;
  onOpenFocusedDiff: () => void;
}) {
  const { api, scopeType, scopeId } = useWorkspace();
  const [showLargeDiff, setShowLargeDiff] = useState(false);
  const { data: diffContent, isLoading, error } = useQuery({
    queryKey: ['workspace-diff-content', scopeType, scopeId, file.path, staged, base, commit],
    queryFn: () => api.git.diffContent({ file: file.path, staged, base, commit }),
  });
  const lineCount = countLines(diffContent?.original ?? '') + countLines(diffContent?.modified ?? '');
  const isLargeDiff = lineCount > LARGE_DIFF_LINE_LIMIT;
  const shouldRenderDiff = diffContent && diffContent.original !== diffContent.modified && (!isLargeDiff || showLargeDiff);
  const diffHeight = Math.min(520, Math.max(180, lineCount * 18 + 36));

  return (
    <section className="shadow-[inset_0_-1px_0_var(--color-card-border)]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onOpenFocusedDiff}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-[var(--color-card)]"
        >
          <StatusBadge status={file.status} />
          <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
          {(file.additions > 0 || file.deletions > 0) && (
            <span className="shrink-0 text-[10px]">
              <span className="text-[var(--color-success)]">+{file.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{file.deletions}</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenFile}
          className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-dim transition-colors hover:bg-[var(--color-card)] hover:text-accent"
        >
          Open
        </button>
      </div>
      {isLoading ? (
        <div className="px-4 pb-4 text-xs text-dim">loading diff...</div>
      ) : error ? (
        <div className="px-4 pb-4 text-xs text-[var(--color-error)]">{(error as Error).message}</div>
      ) : !diffContent || diffContent.original === diffContent.modified ? (
        <div className="px-4 pb-4 text-xs text-dim">no changes</div>
      ) : isLargeDiff && !showLargeDiff ? (
        <div className="flex items-center justify-between gap-3 px-4 pb-4 text-xs text-dim">
          <span>{lineCount.toLocaleString()} lines. Large files stay collapsed until opened.</span>
          <button
            type="button"
            onClick={() => setShowLargeDiff(true)}
            className="shrink-0 rounded-md px-2 py-1 font-medium transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
          >
            Show diff
          </button>
        </div>
      ) : shouldRenderDiff ? (
        <div className="px-3 pb-3" style={{ height: diffHeight }}>
          <div className="h-full overflow-hidden rounded-md bg-[var(--color-inset)]">
            <DiffContent original={diffContent.original} modified={diffContent.modified} path={file.path} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
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
