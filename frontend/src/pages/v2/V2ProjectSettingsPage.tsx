import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bolt,
  FileKey2,
  Hammer,
  PackagePlus,
  PlugZap,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
  Wrench,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { ProjectSecretFile } from '../../api/types';
import type { ProjectSecretFileStatus } from '../../api/projects';
import { Button, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';

export function V2ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: secretStatus } = useQuery({
    queryKey: ['project-secrets', id],
    queryFn: () => projectsApi.getSecrets(id!),
    enabled: !!id,
  });

  const [setupScript, setSetupScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [bootstrapFiles, setBootstrapFiles] = useState<ProjectSecretFile[]>([]);
  const [bootstrapPath, setBootstrapPath] = useState('');
  const [bootstrapMode, setBootstrapMode] = useState<'copy' | 'symlink'>('copy');
  const [bootstrapSource, setBootstrapSource] = useState('');
  const [resolvedNotice, setResolvedNotice] = useState<string | null>(null);

  useEffect(() => {
    setSetupScript(project?.setupScript ?? '');
    setTeardownScript(project?.teardownScript ?? '');
    setBootstrapFiles(project?.secretFiles ?? []);
  }, [project]);

  const setupDirty = setupScript !== (project?.setupScript ?? '') || teardownScript !== (project?.teardownScript ?? '');
  const bootstrapDirty = useMemo(
    () => JSON.stringify(normalizeBootstrapFiles(bootstrapFiles)) !== JSON.stringify(normalizeBootstrapFiles(project?.secretFiles ?? [])),
    [bootstrapFiles, project?.secretFiles],
  );

  const statusByPath = useMemo(() => {
    const map = new Map<string, ProjectSecretFileStatus>();
    for (const entry of secretStatus?.secretFiles ?? []) {
      map.set(entry.path, entry);
    }
    return map;
  }, [secretStatus]);

  const saveSetup = useMutation({
    mutationFn: () => projectsApi.update(id!, {
      setupScript: setupScript.trim() || undefined,
      teardownScript: teardownScript.trim() || undefined,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
      ]);
    },
  });

  const saveBootstrapFiles = useMutation({
    mutationFn: () => projectsApi.updateSecrets(id!, normalizeBootstrapFiles(bootstrapFiles)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', id] }),
        queryClient.invalidateQueries({ queryKey: ['project-secrets', id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
      ]);
    },
  });

  const resolveBootstrapFiles = useMutation({
    mutationFn: () => projectsApi.resolveSecrets(id!),
    onSuccess: async (data) => {
      const resolved = data.results.filter((result) => result.enabled && result.resolvedSource).length;
      const missing = data.results.filter((result) => result.enabled && !result.resolvedSource).length;
      setResolvedNotice(missing > 0 ? `${resolved} ready, ${missing} missing` : `${resolved} ready`);
      window.setTimeout(() => setResolvedNotice(null), 3600);
      await queryClient.invalidateQueries({ queryKey: ['project-secrets', id] });
    },
  });

  const addBootstrapFile = () => {
    const path = bootstrapPath.trim();
    if (!path || bootstrapFiles.some((file) => file.path === path)) return;
    setBootstrapFiles((current) => [...current, {
      path,
      mode: bootstrapMode,
      sourcePath: bootstrapSource.trim() || undefined,
      enabled: true,
    }]);
    setBootstrapPath('');
    setBootstrapSource('');
    setBootstrapMode('copy');
  };

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-dim">Project settings</div>
            <h1 className="mt-1 truncate text-lg font-semibold">{project?.name ?? 'Project'}</h1>
            <div className="mt-1 truncate font-mono text-xs text-dim">{project?.path ?? 'Loading project path'}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to={id ? `/projects/${id}` : '/'}>
              <Button size="sm" variant="secondary">Open project</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <SettingsBlock
              icon={<Wrench size={15} />}
              title="Workspace setup"
              meta={<SaveState dirty={setupDirty} pending={saveSetup.isPending} error={saveSetup.error} />}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Save size={14} />}
                  loading={saveSetup.isPending}
                  disabled={!setupDirty}
                  onClick={() => saveSetup.mutate()}
                >
                  Save setup
                </Button>
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Create command">
                  <V2Textarea
                    value={setupScript}
                    onChange={(event) => setSetupScript(event.target.value)}
                    className="min-h-40 w-full resize-y font-mono text-xs leading-5"
                    placeholder={'pnpm install\ncp .env.example .env'}
                  />
                </Field>
                <Field label="Cleanup command">
                  <V2Textarea
                    value={teardownScript}
                    onChange={(event) => setTeardownScript(event.target.value)}
                    className="min-h-40 w-full resize-y font-mono text-xs leading-5"
                    placeholder="docker compose down --remove-orphans"
                  />
                </Field>
              </div>
            </SettingsBlock>

            <SettingsBlock
              icon={<FileKey2 size={15} />}
              title="Bootstrap files"
              meta={<SaveState dirty={bootstrapDirty} pending={saveBootstrapFiles.isPending} error={saveBootstrapFiles.error} />}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCcw size={14} />}
                    loading={resolveBootstrapFiles.isPending}
                    disabled={bootstrapFiles.length === 0}
                    onClick={() => resolveBootstrapFiles.mutate()}
                  >
                    Check
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Save size={14} />}
                    loading={saveBootstrapFiles.isPending}
                    disabled={!bootstrapDirty}
                    onClick={() => saveBootstrapFiles.mutate()}
                  >
                    Save files
                  </Button>
                </div>
              }
            >
              <div className="space-y-1.5">
                {bootstrapFiles.map((file, index) => (
                  <BootstrapFileRow
                    key={`${file.path}-${index}`}
                    file={file}
                    status={statusByPath.get(file.path)}
                    onToggle={() => setBootstrapFiles((current) => current.map((candidate, i) => (
                      i === index ? { ...candidate, enabled: !candidate.enabled } : candidate
                    )))}
                    onRemove={() => setBootstrapFiles((current) => current.filter((_, i) => i !== index))}
                  />
                ))}
                {bootstrapFiles.length === 0 && (
                  <div className="rounded-lg bg-[var(--color-card)]/45 px-3 py-4 text-sm text-dim">
                    Add local files that should exist before workspace setup runs.
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto]">
                <V2Input value={bootstrapPath} onChange={(event) => setBootstrapPath(event.target.value)} placeholder=".env" />
                <V2Select value={bootstrapMode} onChange={(event) => setBootstrapMode(event.target.value as 'copy' | 'symlink')}>
                  <option value="copy">copy</option>
                  <option value="symlink">symlink</option>
                </V2Select>
                <V2Input value={bootstrapSource} onChange={(event) => setBootstrapSource(event.target.value)} placeholder="Optional source path" />
                <Button size="sm" variant="secondary" icon={<FileKey2 size={14} />} disabled={!bootstrapPath.trim()} onClick={addBootstrapFile}>Add</Button>
              </div>

              <div className="mt-3 min-h-5 text-xs">
                {resolvedNotice && <span className="text-[var(--color-success)]">{resolvedNotice}</span>}
                {resolveBootstrapFiles.error instanceof Error && (
                  <span className="text-[var(--color-error)]">{resolveBootstrapFiles.error.message}</span>
                )}
              </div>
            </SettingsBlock>
          </div>

          <aside className="space-y-3">
            <SettingsLink
              to={id ? `/projects/${id}/pi` : '/'}
              icon={<PlugZap size={15} />}
              title="Project Pi"
              detail="Model defaults, packages, extensions, JSON"
              stat={project?.path ? '.pi/settings.json' : undefined}
            />
            <SettingsLink
              to={id ? `/projects/${id}/skills` : '/skills'}
              icon={<Hammer size={15} />}
              title="Skills"
              detail="Project skills and global links"
              stat=".agents/skills"
            />
            <SettingsLink
              to={id ? `/projects/${id}/actions` : '/'}
              icon={<Bolt size={15} />}
              title="Quick actions"
              detail="Commands shown in the workspace Run menu"
              stat="Run"
            />
            <SettingsLink
              to="/harness"
              icon={<PackagePlus size={15} />}
              title="Harness"
              detail="Global runtimes, auth, and Pi packages"
              stat="Global"
            />
            <SettingsLink
              to="/settings"
              icon={<Settings2 size={15} />}
              title="App settings"
              detail="Theme, account, and general preferences"
            />
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function SettingsBlock({
  icon,
  title,
  meta,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-card)] md:px-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="text-dim">{icon}</div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {meta && <div className="mt-1">{meta}</div>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-[11px] font-medium uppercase text-dim">{label}</div>
      {children}
    </label>
  );
}

function SaveState({ dirty, pending, error }: { dirty: boolean; pending: boolean; error: unknown }) {
  if (pending) return <span className="text-xs text-dim">Saving</span>;
  if (error instanceof Error) return <span className="text-xs text-[var(--color-error)]">{error.message}</span>;
  if (dirty) return <span className="text-xs text-[var(--color-warning)]">Unsaved changes</span>;
  return <span className="text-xs text-dim">Saved</span>;
}

function BootstrapFileRow({
  file,
  status,
  onToggle,
  onRemove,
}: {
  file: ProjectSecretFile;
  status?: ProjectSecretFileStatus;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const resolved = Boolean(status?.resolvedSource);
  const state = !file.enabled ? 'disabled' : resolved ? sourceKindLabel(status?.resolvedKind) : 'missing';
  return (
    <div className="grid gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot enabled={file.enabled} resolved={resolved} />
          <span className="truncate font-mono text-sm">{file.path}</span>
          <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 text-[10px] text-dim">{file.mode}</span>
        </div>
        <div className="mt-1 truncate text-xs text-dim">
          {file.sourcePath ? file.sourcePath : 'default source'} · {state}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <SwitchControl checked={file.enabled} onChange={onToggle} label={`${file.enabled ? 'Disable' : 'Enable'} ${file.path}`} />
        <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]" title="Remove">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function StatusDot({ enabled, resolved }: { enabled: boolean; resolved: boolean }) {
  const className = !enabled
    ? 'bg-[var(--color-text-dim)]/50'
    : resolved
      ? 'bg-[var(--color-success)]'
      : 'bg-[var(--color-warning)]';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

function SwitchControl({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-5 w-9 rounded-full transition-colors duration-150 ease-out ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-inset)]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-150 ease-out ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SettingsLink({
  to,
  icon,
  title,
  detail,
  stat,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  detail: string;
  stat?: string;
}) {
  return (
    <Link
      to={to}
      className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-card px-3 py-3 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)]"
    >
      <div className="text-dim transition-colors group-hover:text-[var(--color-text-primary)]">{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="mt-0.5 truncate text-xs text-dim">{detail}</div>
      </div>
      <div className="flex items-center gap-2 text-xs text-dim">
        {stat && <span className="hidden sm:inline">{stat}</span>}
        <ArrowRight size={14} />
      </div>
    </Link>
  );
}

function normalizeBootstrapFiles(files: ProjectSecretFile[]) {
  return files.map((file) => ({
    path: file.path.trim(),
    mode: file.mode || 'copy',
    sourcePath: file.sourcePath?.trim() || undefined,
    enabled: file.enabled !== false,
  }));
}

function sourceKindLabel(kind?: string) {
  switch (kind) {
    case 'managed':
      return 'managed file';
    case 'sourcePath':
      return 'source path';
    case 'projectPath':
      return 'project file';
    case 'heuristic':
      return 'matched source';
    default:
      return 'ready';
  }
}
