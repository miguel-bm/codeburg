import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Trash2, Plus, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Project, ProjectSecretFile } from '../../api';
import type { ProjectSecretFileStatus } from '../../api/projects';
import { SectionCard, SectionHeader, SectionBody, Toggle } from '../ui/settings';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

const inputClass =
  'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';

interface SecretsProps {
  project: Project;
}

export function SecretsSection({ project }: SecretsProps) {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState<ProjectSecretFile[]>(project.secretFiles ?? []);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingContent, setEditingContent] = useState<{ path: string; content: string } | null>(null);
  const [resolveResult, setResolveResult] = useState<string | null>(null);

  // New secret form
  const [newPath, setNewPath] = useState('');
  const [newMode, setNewMode] = useState<'copy' | 'symlink'>('copy');
  const [newSource, setNewSource] = useState('');

  useEffect(() => {
    setSecrets(project.secretFiles ?? []);
    setDirty(false);
  }, [project]);

  const statusQuery = useQuery({
    queryKey: ['project-secrets', project.id],
    queryFn: () => projectsApi.getSecrets(project.id),
  });

  const statusMap = new Map<string, ProjectSecretFileStatus>();
  if (statusQuery.data) {
    for (const s of statusQuery.data.secretFiles) {
      statusMap.set(s.path, s);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => projectsApi.updateSecrets(project.id, secrets),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['project-secrets', project.id] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => projectsApi.resolveSecrets(project.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project-secrets', project.id] });
      const resolved = data.results.filter((r) => r.resolvedSource);
      const failed = data.results.filter((r) => !r.resolvedSource && r.enabled);
      setResolveResult(`Resolved ${resolved.length} file${resolved.length !== 1 ? 's' : ''}${failed.length ? `, ${failed.length} unresolved` : ''}`);
      setTimeout(() => setResolveResult(null), 5000);
    },
  });

  const contentMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      projectsApi.putSecretContent(project.id, path, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-secrets', project.id] });
      setEditingContent(null);
    },
  });

  const handleAdd = () => {
    if (!newPath.trim()) return;
    const entry: ProjectSecretFile = {
      path: newPath.trim(),
      mode: newMode,
      sourcePath: newSource.trim() || undefined,
      enabled: true,
    };
    setSecrets((prev) => [...prev, entry]);
    setDirty(true);
    setNewPath('');
    setNewMode('copy');
    setNewSource('');
    setShowAdd(false);
  };

  const handleRemove = (index: number) => {
    setSecrets((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleToggle = (index: number) => {
    setSecrets((prev) =>
      prev.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s)),
    );
    setDirty(true);
  };

  const openEditContent = async (path: string) => {
    try {
      const resp = await projectsApi.getSecretContent(project.id, path);
      setEditingContent({ path, content: resp.content });
    } catch {
      setEditingContent({ path, content: '' });
    }
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Secret files"
        description="Manage secret files copied or symlinked into worktrees"
        icon={<KeyRound size={15} />}
        action={
          <Button variant="secondary" size="xs" onClick={() => setShowAdd(true)}>
            <Plus size={12} /> Add secret
          </Button>
        }
      />

      <SectionBody bordered>
        {secrets.length === 0 && !showAdd && (
          <p className="text-sm text-dim">No secret files configured.</p>
        )}

        {secrets.length > 0 && (
          <div className="space-y-0">
            {secrets.map((secret, i) => {
              const fileStatus = statusMap.get(secret.path);
              return (
                <div
                  key={`${secret.path}-${i}`}
                  className="flex items-center gap-3 py-2.5 border-b border-subtle last:border-b-0"
                >
                  {/* Status indicator */}
                  <div className="shrink-0">
                    {!secret.enabled ? (
                      <div className="w-2 h-2 rounded-full bg-[var(--color-text-dim)]" title="Disabled" />
                    ) : fileStatus?.managedExists ? (
                      <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" title="Resolved" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-yellow-500" title="Not resolved" />
                    )}
                  </div>

                  {/* Path and info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-[var(--color-text-primary)] truncate">
                        {secret.path}
                      </span>
                      <Badge variant="label" color={secret.mode === 'copy' ? 'blue' : 'purple'}>
                        {secret.mode}
                      </Badge>
                    </div>
                    {secret.sourcePath && (
                      <span className="text-xs text-dim truncate block mt-0.5">
                        Source: {secret.sourcePath}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Toggle checked={secret.enabled} onChange={() => handleToggle(i)} />
                    {secret.mode === 'copy' && (
                      <button
                        onClick={() => openEditContent(secret.path)}
                        className="p-1 text-dim hover:text-[var(--color-text-primary)] transition-colors rounded hover:bg-tertiary"
                        title="Edit content"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(i)}
                      className="p-1 text-dim hover:text-[var(--color-error)] transition-colors rounded hover:bg-tertiary"
                      title="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline add form */}
        {showAdd && (
          <div className="mt-3 p-3 border border-subtle rounded-md bg-primary space-y-3">
            <div>
              <label className="block text-sm text-dim mb-1">Path</label>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className={inputClass}
                placeholder=".env"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-dim mb-1">Mode</label>
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as 'copy' | 'symlink')}
                className={inputClass}
              >
                <option value="copy">Copy</option>
                <option value="symlink">Symlink</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-dim mb-1">Source path (optional)</label>
              <input
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className={inputClass}
                placeholder="/path/to/source/.env"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="xs" onClick={handleAdd} disabled={!newPath.trim()}>
                Add
              </Button>
              <Button variant="secondary" size="xs" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SectionBody>

      <SectionBody>
        {/* Resolve button */}
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => resolveMutation.mutate()}
            loading={resolveMutation.isPending}
            disabled={resolveMutation.isPending || secrets.length === 0}
          >
            <RefreshCw size={13} /> Resolve secrets
          </Button>
          {resolveResult && (
            <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
              <CheckCircle2 size={12} />
              {resolveResult}
            </span>
          )}
          {resolveMutation.isError && (
            <span className="text-xs text-[var(--color-error)] flex items-center gap-1">
              <AlertTriangle size={12} />
              {resolveMutation.error instanceof Error ? resolveMutation.error.message : 'Failed to resolve'}
            </span>
          )}
        </div>

        {/* Save */}
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Secrets saved
          </div>
        )}
        {saveMutation.isError && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save'}
          </div>
        )}
        <Button
          variant="primary"
          size="md"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
          loading={saveMutation.isPending}
        >
          Save
        </Button>
      </SectionBody>

      {/* Edit content modal */}
      <Modal
        open={!!editingContent}
        onClose={() => setEditingContent(null)}
        title={editingContent ? `Edit ${editingContent.path}` : ''}
        size="lg"
      >
        {editingContent && (
          <>
            <div className="px-5 py-4">
              <textarea
                value={editingContent.content}
                onChange={(e) => setEditingContent({ ...editingContent, content: e.target.value })}
                className={`${inputClass} font-mono text-xs resize-none`}
                rows={15}
                spellCheck={false}
              />
            </div>
            <div className="px-5 py-3 border-t border-subtle flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditingContent(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => contentMutation.mutate({ path: editingContent.path, content: editingContent.content })}
                loading={contentMutation.isPending}
              >
                Save content
              </Button>
            </div>
          </>
        )}
      </Modal>
    </SectionCard>
  );
}
