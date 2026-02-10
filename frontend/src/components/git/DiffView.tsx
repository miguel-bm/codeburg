import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PatchDiff } from '@pierre/diffs/react';
import { gitApi } from '../../api';
import { useMobile } from '../../hooks/useMobile';

interface DiffViewProps {
  taskId: string;
  file?: string;
  staged?: boolean;
  base?: boolean;
}

export function DiffView({ taskId, file, staged, base }: DiffViewProps) {
  const isMobile = useMobile();
  const { data, isLoading, error } = useQuery({
    queryKey: ['git-diff', taskId, file, staged, base],
    queryFn: () => gitApi.diff(taskId, { file, staged, base }),
  });

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

  return (
    <div className="p-2 min-h-full">
      <PatchDiff patch={data.diff} options={options} />
    </div>
  );
}
