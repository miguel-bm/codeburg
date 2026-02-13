import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Archive, CheckCircle2, Trash2 } from 'lucide-react';
import { projectsApi } from '../../../api';
import type { ArchiveInfo } from '../../../api';
import { SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';

export function ArchivesSection() {
  const queryClient = useQueryClient();

  const { data: archives = [], isLoading } = useQuery({
    queryKey: ['archives'],
    queryFn: () => projectsApi.listArchives(),
  });

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => projectsApi.unarchive(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archives'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => projectsApi.deleteArchive(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archives'] });
    },
  });

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Archives"
        description="Restore or delete archived projects"
        icon={<Archive size={15} />}
      />
      <SectionBody>
        {isLoading ? (
          <p className="text-sm text-dim">Loading...</p>
        ) : archives.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-dim text-center">
            <Archive size={32} className="text-dim" />
            <p className="text-sm">No archived projects.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {archives.map((archive: ArchiveInfo) => (
              <div
                key={archive.filename}
                className="flex items-center justify-between gap-3 py-3 border-b border-subtle last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-[var(--color-text-primary)]">{archive.projectName || archive.filename}</span>
                  <span className="block text-xs text-dim mt-0.5">
                    {formatDate(archive.archivedAt)}
                    {archive.size > 0 && ` · ${formatSize(archive.size)}`}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => restoreMutation.mutate(archive.filename)}
                    disabled={restoreMutation.isPending}
                    className="px-2.5 py-1.5 text-xs text-accent hover:text-accent-dim bg-accent/10 hover:bg-accent/15 rounded-md transition-colors disabled:opacity-50"
                    title="Restore"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(archive.filename)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-dim hover:text-[var(--color-error)] transition-colors rounded"
                    title="Delete archive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {restoreMutation.isError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mt-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {restoreMutation.error instanceof Error ? restoreMutation.error.message : 'Failed to restore'}
          </div>
        )}
        {restoreMutation.isSuccess && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mt-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Project restored successfully
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}
