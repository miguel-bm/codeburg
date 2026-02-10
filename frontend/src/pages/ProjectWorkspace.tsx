import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileText, Folder, FolderUp, Funnel, Plus, Settings } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { OpenInEditorButton } from '../components/common/OpenInEditorButton';
import { projectsApi } from '../api';
import type { ProjectSecretFile, ProjectSecretResolveResult, ProjectSecretFileStatus } from '../api';
import { useMobile } from '../hooks/useMobile';

type MobilePanel = 'files' | 'preview' | 'secrets';

function normalizeSecretRows(rows: ProjectSecretFile[]): ProjectSecretFile[] {
  return rows.map((row) => ({
    path: row.path,
    mode: row.mode || 'copy',
    sourcePath: row.sourcePath || undefined,
    enabled: row.enabled ?? true,
  }));
}

function parentPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  parts.pop();
  return parts.join('/');
}

export function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const [currentDir, setCurrentDir] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('files');

  const [secretRows, setSecretRows] = useState<ProjectSecretFile[]>([]);
  const [secretsDirty, setSecretsDirty] = useState(false);
  const [resolveOverrides, setResolveOverrides] = useState<Record<string, ProjectSecretResolveResult>>({});
  const [secretEditorPath, setSecretEditorPath] = useState<string | null>(null);
  const [secretEditorContent, setSecretEditorContent] = useState('');
  const [secretEditorLoading, setSecretEditorLoading] = useState(false);
  const [secretEditorSaving, setSecretEditorSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [leftPanelPct, setLeftPanelPct] = useState(30);
  const [previewPanelPct, setPreviewPanelPct] = useState(58);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: fileTree, isLoading: filesLoading } = useQuery({
    queryKey: ['project-files', id, currentDir],
    queryFn: () => projectsApi.listFiles(id!, { path: currentDir, depth: 1 }),
    enabled: !!id,
  });

  const { data: fileContent, isLoading: fileLoading } = useQuery({
    queryKey: ['project-file', id, selectedFile],
    queryFn: () => projectsApi.readFile(id!, selectedFile!),
    enabled: !!id && !!selectedFile,
  });

  const { data: secretsData, isLoading: secretsLoading } = useQuery({
    queryKey: ['project-secrets', id],
    queryFn: () => projectsApi.getSecrets(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (!secretsData || secretsDirty) return;
    setSecretRows(normalizeSecretRows(secretsData.secretFiles));
    setResolveOverrides({});
  }, [secretsData, secretsDirty]);

  const saveSecretsMutation = useMutation({
    mutationFn: (rows: ProjectSecretFile[]) => {
      const compact = rows
        .map((row) => ({
          path: row.path.trim(),
          mode: row.mode || 'copy',
          sourcePath: row.sourcePath?.trim() || undefined,
          enabled: row.enabled,
        }))
        .filter((row) => row.path.length > 0);
      return projectsApi.updateSecrets(id!, compact);
    },
    onSuccess: () => {
      setSecretsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['project-secrets', id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const onMainDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPanelPct(Math.max(18, Math.min(60, pct)));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const onRightDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!rightRef.current) return;
      const rect = rightRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setPreviewPanelPct(Math.max(25, Math.min(75, pct)));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const openSecretEditor = async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || !id) return;
    setSecretEditorPath(trimmed);
    setSecretEditorLoading(true);
    setSecretEditorContent('');
    try {
      const res = await projectsApi.getSecretContent(id, trimmed);
      setSecretEditorContent(res.content);
    } catch {
      setSecretEditorContent('');
    } finally {
      setSecretEditorLoading(false);
    }
  };

  const saveSecretContent = async () => {
    if (!id || !secretEditorPath) return;
    setSecretEditorSaving(true);
    setError(null);
    try {
      await projectsApi.putSecretContent(id, secretEditorPath, secretEditorContent);
      queryClient.invalidateQueries({ queryKey: ['project-secrets', id] });
      setSecretEditorPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret content');
    } finally {
      setSecretEditorSaving(false);
    }
  };

  const resolveOneSecret = async (path: string) => {
    if (!id || !path.trim()) return;
    try {
      const res = await projectsApi.resolveSecrets(id, [path.trim()]);
      if (res.results[0]) {
        setResolveOverrides((prev) => ({ ...prev, [path.trim()]: res.results[0] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve secret');
    }
  };

  const secretStatusByPath = useMemo(() => {
    const map = new Map<string, ProjectSecretFileStatus>();
    for (const row of secretsData?.secretFiles ?? []) {
      map.set(row.path, row);
    }
    return map;
  }, [secretsData]);

  if (projectLoading) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center text-dim">Loading...</div>
      </Layout>
    );
  }

  if (!project || !id) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center text-dim">Project not found</div>
      </Layout>
    );
  }

  const filesPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Files</span>
        <button
          onClick={() => setCurrentDir(parentPath(currentDir))}
          disabled={!currentDir}
          className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
        >
          <FolderUp size={12} />
          Up
        </button>
      </div>
      <div className="px-3 py-1 text-[11px] text-dim border-b border-subtle font-mono truncate">
        /{currentDir || ''}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filesLoading ? (
          <div className="p-3 text-xs text-dim">Loading files...</div>
        ) : (
          <div className="p-1">
            {fileTree?.entries.length ? fileTree.entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => {
                  if (entry.type === 'dir') {
                    setCurrentDir(entry.path);
                    return;
                  }
                  setSelectedFile(entry.path);
                  if (isMobile) setMobilePanel('preview');
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                  selectedFile === entry.path ? 'bg-accent/10 text-accent' : 'hover:bg-tertiary'
                }`}
                title={entry.path}
              >
                {entry.type === 'dir' ? (
                  <Folder size={14} className="text-dim shrink-0" />
                ) : (
                  <FileText size={14} className="text-dim shrink-0" />
                )}
                <span className="truncate text-xs">{entry.name}</span>
                {entry.type === 'dir' && <ChevronRight size={12} className="ml-auto text-dim shrink-0" />}
              </button>
            )) : (
              <div className="p-3 text-xs text-dim">Empty directory</div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const previewPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-subtle flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Preview</span>
        {selectedFile && <span className="text-[11px] font-mono text-dim truncate max-w-[60%]">{selectedFile}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {!selectedFile ? (
          <div className="h-full flex items-center justify-center text-dim text-sm">Select a file to preview</div>
        ) : fileLoading ? (
          <div className="p-3 text-xs text-dim">Loading file...</div>
        ) : fileContent?.binary ? (
          <div className="p-3 text-xs text-dim">Binary file preview is not supported</div>
        ) : (
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-words">{fileContent?.content || ''}</pre>
        )}
      </div>
    </div>
  );

  const secretsPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Secrets</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSecretRows((prev) => [...prev, { path: '', mode: 'copy', enabled: true }]);
              setSecretsDirty(true);
            }}
            className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
          >
            <Plus size={12} />
            Add
          </button>
          <button
            onClick={() => saveSecretsMutation.mutate(secretRows)}
            disabled={saveSecretsMutation.isPending || !secretsDirty}
            className="px-2 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-dim transition-colors disabled:opacity-40"
          >
            {saveSecretsMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {secretsLoading ? (
          <div className="p-2 text-xs text-dim">Loading secrets...</div>
        ) : secretRows.length === 0 ? (
          <div className="p-2 text-xs text-dim">No secret mappings yet</div>
        ) : secretRows.map((row, idx) => {
          const status = secretStatusByPath.get(row.path.trim());
          const override = resolveOverrides[row.path.trim()];
          const resolvedSource = override?.resolvedSource ?? status?.resolvedSource;
          const resolvedKind = override?.resolvedKind ?? status?.resolvedKind;
          return (
            <div key={`${idx}-${row.path}`} className="border border-subtle rounded-md p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => {
                    const next = [...secretRows];
                    next[idx] = { ...row, enabled: e.target.checked };
                    setSecretRows(next);
                    setSecretsDirty(true);
                  }}
                />
                <input
                  value={row.path}
                  onChange={(e) => {
                    const next = [...secretRows];
                    next[idx] = { ...row, path: e.target.value };
                    setSecretRows(next);
                    setSecretsDirty(true);
                  }}
                  placeholder=".env"
                  className="flex-1 bg-primary border border-subtle rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                />
                <select
                  value={row.mode}
                  onChange={(e) => {
                    const next = [...secretRows];
                    next[idx] = { ...row, mode: e.target.value as 'copy' | 'symlink' };
                    setSecretRows(next);
                    setSecretsDirty(true);
                  }}
                  className="bg-primary border border-subtle rounded-md px-2 py-1 text-xs focus:outline-none focus:border-[var(--color-text-secondary)]"
                >
                  <option value="copy">copy</option>
                  <option value="symlink">symlink</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={row.sourcePath || ''}
                  onChange={(e) => {
                    const next = [...secretRows];
                    next[idx] = { ...row, sourcePath: e.target.value || undefined };
                    setSecretRows(next);
                    setSecretsDirty(true);
                  }}
                  placeholder="source path (optional)"
                  className="flex-1 bg-primary border border-subtle rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                />
                <button
                  onClick={() => resolveOneSecret(row.path)}
                  disabled={!row.path.trim()}
                  className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40"
                >
                  Resolve
                </button>
                <button
                  onClick={() => openSecretEditor(row.path)}
                  disabled={!row.path.trim()}
                  className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40"
                >
                  Edit Source
                </button>
                <button
                  onClick={() => {
                    const next = secretRows.filter((_, i) => i !== idx);
                    setSecretRows(next);
                    setSecretsDirty(true);
                  }}
                  className="px-2 py-1 text-xs text-[var(--color-error)] hover:underline"
                >
                  Remove
                </button>
              </div>
              <div className="text-[11px] text-dim space-y-1">
                <div>Managed source: {status?.managedExists ? 'present' : 'missing'}</div>
                {resolvedSource ? (
                  <div className="font-mono truncate" title={resolvedSource}>
                    Resolved ({resolvedKind || 'unknown'}): {resolvedSource}
                  </div>
                ) : (
                  <div>No source resolved. Worktree creation will create an empty file.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <header className="px-4 py-3 border-b border-subtle bg-secondary flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{project.name}</h1>
            <p className="text-[11px] text-dim font-mono truncate">{project.path}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <OpenInEditorButton worktreePath={project.path} />
            <button
              onClick={() => navigate(`/?project=${project.id}`)}
              className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
              title="Filter dashboard by this project"
            >
              <Funnel size={13} />
              <span className="hidden sm:inline">Filter</span>
            </button>
            <button
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
            >
              <Settings size={13} />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="px-4 py-2 text-xs text-[var(--color-error)] border-b border-subtle">
            {error}
          </div>
        )}

        {isMobile ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b border-subtle bg-secondary">
              <select
                value={mobilePanel}
                onChange={(e) => setMobilePanel(e.target.value as MobilePanel)}
                className="bg-primary border border-subtle rounded-md text-sm px-2 py-1 focus:outline-none focus:border-[var(--color-text-secondary)]"
              >
                <option value="files">Files</option>
                <option value="preview">Preview</option>
                <option value="secrets">Secrets</option>
              </select>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mobilePanel === 'files' ? filesPanel : mobilePanel === 'preview' ? previewPanel : secretsPanel}
            </div>
          </div>
        ) : (
          <div ref={bodyRef} className="flex-1 min-h-0 flex overflow-hidden">
            <div style={{ width: `${leftPanelPct}%` }} className="shrink-0 border-r border-subtle overflow-hidden">
              {filesPanel}
            </div>
            <div
              onMouseDown={onMainDividerMouseDown}
              className="w-1 shrink-0 cursor-col-resize border-x border-subtle hover:bg-accent/40 transition-colors"
            />
            <div ref={rightRef} className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div style={{ height: `${previewPanelPct}%` }} className="overflow-hidden min-h-0">
                {previewPanel}
              </div>
              <div
                onMouseDown={onRightDividerMouseDown}
                className="h-1 shrink-0 cursor-row-resize border-y border-subtle hover:bg-accent/40 transition-colors"
              />
              <div className="flex-1 min-h-0 overflow-hidden border-t border-subtle">
                {secretsPanel}
              </div>
            </div>
          </div>
        )}
      </div>

      {secretEditorPath && (
        <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b border-subtle">
              <h3 className="text-sm font-medium">Managed Secret Source</h3>
              <p className="text-[11px] text-dim font-mono mt-1">{secretEditorPath}</p>
            </div>
            <div className="p-4 flex-1 min-h-0 overflow-auto">
              {secretEditorLoading ? (
                <div className="text-xs text-dim">Loading...</div>
              ) : (
                <textarea
                  value={secretEditorContent}
                  onChange={(e) => setSecretEditorContent(e.target.value)}
                  rows={18}
                  className="w-full bg-primary border border-subtle rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                />
              )}
            </div>
            <div className="px-4 py-3 border-t border-subtle flex justify-end gap-2">
              <button
                onClick={() => setSecretEditorPath(null)}
                className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSecretContent}
                disabled={secretEditorSaving || secretEditorLoading}
                className="px-3 py-1.5 bg-accent text-white rounded-md text-xs hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {secretEditorSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
