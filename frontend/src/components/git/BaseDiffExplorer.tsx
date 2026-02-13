import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../../api';
import { useMobile } from '../../hooks/useMobile';
import { DiffView } from './DiffView';
import { parseDiffFiles } from './diffFiles';

interface BaseDiffExplorerProps {
  taskId: string;
  onFileCountChange?: (count: number) => void;
}

export function BaseDiffExplorer({ taskId, onFileCountChange }: BaseDiffExplorerProps) {
  const isMobile = useMobile();
  const [selectedFile, setSelectedFile] = useState<string | undefined>();

  const { data: baseDiff } = useQuery({
    queryKey: ['git-diff', taskId, undefined, undefined, true],
    queryFn: () => gitApi.diff(taskId, { base: true }),
  });

  const diffFiles = useMemo(() => parseDiffFiles(baseDiff?.diff || ''), [baseDiff?.diff]);

  useEffect(() => {
    onFileCountChange?.(diffFiles.length);
  }, [diffFiles.length, onFileCountChange]);

  const effectiveSelectedFile = selectedFile && diffFiles.some((file) => file.path === selectedFile)
    ? selectedFile
    : undefined;

  if (isMobile) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {diffFiles.length > 0 && (
          <div className="px-3 py-2 border-b border-subtle bg-secondary">
            <select
              value={effectiveSelectedFile || ''}
              onChange={(e) => setSelectedFile(e.target.value || undefined)}
              className="w-full bg-primary border border-subtle rounded-md px-2 py-1 text-xs font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-accent"
            >
              <option value="">All files ({diffFiles.length})</option>
              {diffFiles.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path} (+{file.additions}/-{file.deletions})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          <DiffView taskId={taskId} base file={effectiveSelectedFile} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex overflow-hidden">
      {diffFiles.length > 0 && (
        <div className="w-56 shrink-0 border-r border-subtle overflow-y-auto bg-secondary">
          <button
            onClick={() => setSelectedFile(undefined)}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${!effectiveSelectedFile ? 'bg-accent/10 text-accent' : 'text-dim hover:bg-tertiary'}`}
          >
            All files ({diffFiles.length})
          </button>
          {diffFiles.map((file) => (
            <button
              key={file.path}
              onClick={() => setSelectedFile(file.path)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${effectiveSelectedFile === file.path ? 'bg-accent/10 text-accent' : 'text-dim hover:bg-tertiary'}`}
              title={file.path}
            >
              <span className="font-mono">{file.path.split('/').pop()}</span>
              <span className="ml-1 text-[var(--color-success)]">+{file.additions}</span>
              <span className="ml-0.5 text-[var(--color-error)]">-{file.deletions}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <DiffView taskId={taskId} base file={effectiveSelectedFile} />
      </div>
    </div>
  );
}
