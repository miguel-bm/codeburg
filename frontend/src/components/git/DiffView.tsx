import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../../api';

interface DiffViewProps {
  taskId: string;
  file?: string;
  staged?: boolean;
  base?: boolean;
}

export function DiffView({ taskId, file, staged, base }: DiffViewProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['git-diff', taskId, file, staged, base],
    queryFn: () => gitApi.diff(taskId, { file, staged, base }),
  });

  if (isLoading) {
    return <div className="p-4 text-xs text-dim">loading diff...</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-[var(--color-error)]">{(error as Error).message}</div>;
  }

  if (!data?.diff) {
    return <div className="p-4 text-xs text-dim">no changes</div>;
  }

  const lines = data.diff.split('\n');

  return (
    <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto">
      {lines.map((line, i) => (
        <div key={i} className={getDiffLineClass(line)}>
          {line}
        </div>
      ))}
    </pre>
  );
}

function getDiffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'text-[var(--color-success)]';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'text-[var(--color-error)]';
  }
  if (line.startsWith('@@')) {
    return 'text-dim';
  }
  if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
    return 'text-dim';
  }
  return '';
}
