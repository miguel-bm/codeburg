import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PatchDiff } from '@pierre/diffs/react';
import { useWorkspace } from './WorkspaceContext';
import { useMobile } from '../../hooks/useMobile';
import { parseDiffFiles, splitDiffIntoFilePatches } from '../git/diffFiles';

interface DiffTabProps {
  file?: string;
  staged?: boolean;
  base?: boolean;
}

export function DiffTab({ file, staged, base }: DiffTabProps) {
  const { api, scopeType, scopeId } = useWorkspace();
  const isMobile = useMobile();

  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace-diff', scopeType, scopeId, file, staged, base],
    queryFn: () => api.git.diff({ file, staged, base }),
  });

  const filePatches = useMemo(
    () => splitDiffIntoFilePatches(data?.diff || ''),
    [data?.diff],
  );
  const fileSummaries = useMemo(
    () => parseDiffFiles(data?.diff || ''),
    [data?.diff],
  );

  const options = useMemo(() => ({
    diffStyle: isMobile ? 'unified' as const : 'split' as const,
    diffIndicators: 'bars' as const,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'word' as const,
    overflow: 'scroll' as const,
    themeType: 'system' as const,
  }), [isMobile]);

  if (isLoading) {
    return <div className="p-4 text-xs text-dim">loading diff...</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-[var(--color-error)]">{(error as Error).message}</div>;
  }

  if (!data?.diff) {
    return <div className="p-4 text-xs text-dim">no changes</div>;
  }

  if (!file && filePatches.length > 1) {
    return (
      <div className="p-2 min-h-full space-y-3 overflow-auto">
        {filePatches.map((patch, idx) => (
          <section key={`${fileSummaries[idx]?.path || 'patch'}-${idx}`} className="border border-subtle rounded-md overflow-hidden">
            <div className="px-3 py-1.5 bg-secondary border-b border-subtle text-[11px] font-mono text-dim">
              {fileSummaries[idx]?.path || `file ${idx + 1}`}
            </div>
            <PatchDiff patch={patch} options={options} />
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="p-2 min-h-full overflow-auto">
      <PatchDiff patch={data.diff} options={options} />
    </div>
  );
}
