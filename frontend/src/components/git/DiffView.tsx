import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../../api';
import type { GitDiffContent } from '../../api/git';
import { api } from '../../api/client';
import { DiffContent } from '../workspace/DiffContent';
import { parseDiffFiles, splitDiffIntoFilePatches } from './diffFiles';

interface DiffViewProps {
  taskId: string;
  file?: string;
  staged?: boolean;
  base?: boolean;
}

export function DiffView({ taskId, file, staged, base }: DiffViewProps) {
  // Use diff-content endpoint for single-file views
  const { data: diffContent, isLoading: contentLoading, error: contentError } = useQuery({
    queryKey: ['git-diff-content', taskId, file, staged, base],
    queryFn: () => {
      const params = new URLSearchParams({ file: file! });
      if (staged) params.set('staged', 'true');
      if (base) params.set('base', 'true');
      return api.get<GitDiffContent>(`/tasks/${taskId}/git/diff-content?${params}`);
    },
    enabled: !!file,
  });

  // Fall back to raw diff for multi-file overview
  const { data, isLoading, error } = useQuery({
    queryKey: ['git-diff', taskId, file, staged, base],
    queryFn: () => gitApi.diff(taskId, { file, staged, base }),
    enabled: !file,
  });

  const filePatches = useMemo(
    () => splitDiffIntoFilePatches(data?.diff || ''),
    [data?.diff],
  );
  const fileSummaries = useMemo(
    () => parseDiffFiles(data?.diff || ''),
    [data?.diff],
  );

  // Single file view using DiffContent
  if (file) {
    if (contentLoading) {
      return <div className="p-4 text-xs text-dim">loading diff...</div>;
    }
    if (contentError) {
      return <div className="p-4 text-xs text-[var(--color-error)]">{(contentError as Error).message}</div>;
    }
    if (!diffContent || diffContent.original === diffContent.modified) {
      return <div className="p-4 text-xs text-dim">no changes</div>;
    }
    return (
      <div className="h-full overflow-hidden">
        <DiffContent original={diffContent.original} modified={diffContent.modified} path={file} />
      </div>
    );
  }

  // Multi-file overview
  if (isLoading) {
    return <div className="p-4 text-xs text-dim">loading diff...</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-[var(--color-error)]">{(error as Error).message}</div>;
  }

  if (!data?.diff) {
    return <div className="p-4 text-xs text-dim">no changes</div>;
  }

  // Show file summaries with +/- counts
  return (
    <div className="p-2 min-h-full space-y-2 overflow-auto">
      {fileSummaries.map((summary, idx) => (
        <section key={`${summary.path}-${idx}`} className="border border-subtle rounded-md overflow-hidden">
          <div className="px-3 py-1.5 bg-secondary border-b border-subtle text-[11px] font-mono text-dim flex items-center justify-between">
            <span className="truncate">{summary.path}</span>
            <span className="text-[10px] shrink-0 ml-2">
              <span className="text-[var(--color-success)]">+{summary.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{summary.deletions}</span>
            </span>
          </div>
          <div className="text-[11px] font-mono text-dim p-2 whitespace-pre overflow-x-auto max-h-64">
            {filePatches[idx]?.split('\n').slice(0, 30).map((line, i) => {
              let color = '';
              if (line.startsWith('+') && !line.startsWith('+++')) color = 'text-[var(--color-success)]';
              else if (line.startsWith('-') && !line.startsWith('---')) color = 'text-[var(--color-error)]';
              else if (line.startsWith('@@')) color = 'text-accent';
              return <div key={i} className={color}>{line || ' '}</div>;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
