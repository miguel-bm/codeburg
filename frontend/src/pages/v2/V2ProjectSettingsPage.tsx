import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bolt, CheckCircle2, CircleSlash, FileKey2, Hammer, PackagePlus, PlugZap, RefreshCcw, Save, Trash2, Wrench } from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { PiConfigDocument, PiPackageEntry, ProjectSecretFile } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';

interface QuickRunAction {
  id: string;
  name: string;
  command: string;
}

export function V2ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const quickActionKey = useMemo(() => `v2.quick_actions.${id ?? 'unknown'}`, [id]);

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });
  const { data: quickActions = [] } = useQuery({
    queryKey: ['v2-quick-actions', id],
    queryFn: () => preferencesApi.get<QuickRunAction[]>(quickActionKey).catch(() => []),
    enabled: !!id,
  });
  const { data: piConfig } = useQuery({
    queryKey: ['v2-project-pi-config', id],
    queryFn: () => v2Api.getProjectPiConfig(id!),
    enabled: !!id,
  });

  const [setupScript, setSetupScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [secrets, setSecrets] = useState<ProjectSecretFile[]>([]);
  const [secretPath, setSecretPath] = useState('');
  const [secretMode, setSecretMode] = useState<'copy' | 'symlink'>('copy');
  const [secretSource, setSecretSource] = useState('');
  const [actionName, setActionName] = useState('');
  const [actionCommand, setActionCommand] = useState('');
  const [projectPiSettingsDraft, setProjectPiSettingsDraft] = useState('');
  const [piPackageSource, setPiPackageSource] = useState('');
  const [piExtensionPath, setPiExtensionPath] = useState('');
  const deferredPiPackageSource = useDeferredValue(piPackageSource.trim());
  const deferredPiExtensionPath = useDeferredValue(piExtensionPath.trim());
  const safeQuickActions = Array.isArray(quickActions) ? quickActions : [];

  useEffect(() => {
    setSetupScript(project?.setupScript ?? '');
    setTeardownScript(project?.teardownScript ?? '');
    setSecrets(project?.secretFiles ?? []);
  }, [project]);

  useEffect(() => {
    if (!piConfig?.projectSettings) return;
    setProjectPiSettingsDraft(piConfig.projectSettings.content);
  }, [piConfig]);

  const saveLifecycle = useMutation({
    mutationFn: () => projectsApi.update(id!, {
      setupScript: setupScript.trim() || undefined,
      teardownScript: teardownScript.trim() || undefined,
      secretFiles: secrets,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
      ]);
    },
  });

  const saveQuickActions = useMutation({
    mutationFn: (actions: QuickRunAction[]) => preferencesApi.set(quickActionKey, actions),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-quick-actions', id] });
    },
  });

  const refreshProjectPiConfig = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-project-pi-config', id] }),
      queryClient.invalidateQueries({ queryKey: ['v2-pi-config'] }),
      queryClient.invalidateQueries({ queryKey: ['pi-status'] }),
    ]);
  };

  const saveProjectPiSettings = useMutation({
    mutationFn: () => v2Api.updateProjectPiSettings(id!, projectPiSettingsDraft),
    onSuccess: refreshProjectPiConfig,
  });
  const installProjectPiPackage = useMutation({
    mutationFn: (source: string) => v2Api.installProjectPiPackage(id!, source),
    onSuccess: async () => {
      setPiPackageSource('');
      await refreshProjectPiConfig();
    },
  });
  const removeProjectPiPackage = useMutation({
    mutationFn: (source: string) => v2Api.removeProjectPiPackage(id!, source),
    onSuccess: refreshProjectPiConfig,
  });
  const updateProjectPiPackages = useMutation({
    mutationFn: () => v2Api.updateProjectPiPackages(id!),
    onSuccess: refreshProjectPiConfig,
  });
  const addProjectPiExtension = useMutation({
    mutationFn: (path: string) => v2Api.addProjectPiExtension(id!, path),
    onSuccess: async () => {
      setPiExtensionPath('');
      await refreshProjectPiConfig();
    },
  });
  const removeProjectPiExtension = useMutation({
    mutationFn: (path: string) => v2Api.removeProjectPiExtension(id!, path),
    onSuccess: refreshProjectPiConfig,
  });

  const addSecret = () => {
    const path = secretPath.trim();
    if (!path) return;
    setSecrets((current) => [...current, {
      path,
      mode: secretMode,
      sourcePath: secretSource.trim() || undefined,
      enabled: true,
    }]);
    setSecretPath('');
    setSecretSource('');
    setSecretMode('copy');
  };

  const addQuickAction = () => {
    const name = actionName.trim();
    const command = actionCommand.trim();
    if (!name || !command) return;
    saveQuickActions.mutate([...safeQuickActions, { id: crypto.randomUUID(), name, command }]);
    setActionName('');
    setActionCommand('');
  };

  return (
    <V2Screen>
      <div className="flex h-12 shrink-0 items-center justify-between bg-canvas px-6">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{project?.name ?? 'Project'} settings</div>
          <div className="text-xs text-dim">Project behavior, workspace bootstrapping, skills, and pi.</div>
        </div>
        <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saveLifecycle.isPending} onClick={() => saveLifecycle.mutate()}>
          Save project
        </Button>
      </div>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-10">
            <SettingsSection icon={<Wrench size={15} />} title="Workspace lifecycle" description="Commands run from the workspace directory during create/delete flows. Keep scripts in the repo and call them here.">
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">Create command</div>
                  <V2Textarea value={setupScript} onChange={(event) => setSetupScript(event.target.value)} className="min-h-44 w-full resize-y font-mono text-xs" placeholder={'pnpm install\ncp .env.example .env'} />
                </label>
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">Delete command</div>
                  <V2Textarea value={teardownScript} onChange={(event) => setTeardownScript(event.target.value)} className="min-h-44 w-full resize-y font-mono text-xs" placeholder="docker compose down --remove-orphans" />
                </label>
              </div>
            </SettingsSection>

            <SettingsSection icon={<FileKey2 size={15} />} title="Secret files" description="Copied or symlinked into worktrees before setup commands run.">
              <div className="space-y-2">
                {secrets.map((secret, index) => (
                  <div key={`${secret.path}-${index}`} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{secret.path}</div>
                      <div className="truncate text-xs text-dim">{secret.sourcePath || 'same relative path'} · {secret.enabled ? 'enabled' : 'disabled'}</div>
                    </div>
                    <div className="text-xs text-dim">{secret.mode}</div>
                    <button type="button" onClick={() => setSecrets((current) => current.filter((_, i) => i !== index))} className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {secrets.length === 0 && <div className="py-3 text-sm text-dim">No secret files configured.</div>}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto]">
                <V2Input value={secretPath} onChange={(event) => setSecretPath(event.target.value)} placeholder=".env" />
                <V2Select value={secretMode} onChange={(event) => setSecretMode(event.target.value as 'copy' | 'symlink')}>
                  <option value="copy">copy</option>
                  <option value="symlink">symlink</option>
                </V2Select>
                <V2Input value={secretSource} onChange={(event) => setSecretSource(event.target.value)} placeholder="Optional source path" />
                <Button size="sm" variant="secondary" icon={<FileKey2 size={14} />} disabled={!secretPath.trim()} onClick={addSecret}>Add</Button>
              </div>
            </SettingsSection>

            <SettingsSection icon={<Bolt size={15} />} title="Quick run actions" description="Configured per project, executed inside the selected workspace through the Run menu.">
              <div className="space-y-2">
                {safeQuickActions.map((action) => (
                  <div key={action.id} className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{action.name}</div>
                      <div className="truncate font-mono text-xs text-dim">{action.command}</div>
                    </div>
                    <button type="button" onClick={() => saveQuickActions.mutate(safeQuickActions.filter((candidate) => candidate.id !== action.id))} className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {safeQuickActions.length === 0 && <div className="py-3 text-sm text-dim">No quick actions yet.</div>}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[14rem_minmax(0,1fr)_auto]">
                <V2Input value={actionName} onChange={(event) => setActionName(event.target.value)} placeholder="Test backend" />
                <V2Input value={actionCommand} onChange={(event) => setActionCommand(event.target.value)} placeholder="GOTOOLCHAIN=auto go test ./internal/api" />
                <Button size="sm" variant="secondary" icon={<Bolt size={14} />} loading={saveQuickActions.isPending} disabled={!actionName.trim() || !actionCommand.trim()} onClick={addQuickAction}>Add action</Button>
              </div>
            </SettingsSection>

            <PiConfigEditorSection
              title="Project Pi override"
              subtitle={piConfig?.projectSettings?.path ?? `${project?.path ?? '.'}/.pi/settings.json`}
              document={piConfig?.projectSettings}
              draft={projectPiSettingsDraft}
              onChange={setProjectPiSettingsDraft}
              onSave={() => saveProjectPiSettings.mutate()}
              pending={saveProjectPiSettings.isPending}
              error={saveProjectPiSettings.error}
            />
          </div>

          <aside className="space-y-6 text-sm">
            <SettingsSection icon={<Hammer size={15} />} title="Skills" description="Project skills live on disk and are managed from the standards-based skills view.">
              <Link to={`/v2/projects/${id}/skills`}>
                <Button size="sm" variant="secondary" icon={<Hammer size={14} />}>Manage skills</Button>
              </Link>
            </SettingsSection>
            <SettingsSection icon={<PlugZap size={15} />} title="Harness" description="Global runtime updates and login state live outside this project.">
              <Link to="/v2/harness">
                <Button size="sm" variant="secondary" icon={<PlugZap size={14} />}>Global harness</Button>
              </Link>
            </SettingsSection>
            <PiResourceManager
              title="Project Pi packages"
              description="Installed only for this project."
              value={piPackageSource}
              placeholder="npm:@scope/pkg · ./relative/path"
              onChange={setPiPackageSource}
              onSubmit={() => installProjectPiPackage.mutate(deferredPiPackageSource)}
              submitDisabled={!deferredPiPackageSource}
              submitPending={installProjectPiPackage.isPending}
              submitIcon={<PackagePlus size={14} />}
              submitLabel="Install"
              onRefresh={() => updateProjectPiPackages.mutate()}
              refreshPending={updateProjectPiPackages.isPending}
              items={(piConfig?.projectPackages ?? []).map((pkg) => ({
                key: pkg.source,
                title: pkg.source,
                detail: describePiPackage(pkg),
                onRemove: () => removeProjectPiPackage.mutate(pkg.source),
                removePending: removeProjectPiPackage.isPending,
              }))}
            />
            <PiResourceManager
              title="Project Pi extensions"
              description="Extension paths scoped to this repo."
              value={piExtensionPath}
              placeholder=".pi/extensions/my-extension.ts"
              onChange={setPiExtensionPath}
              onSubmit={() => addProjectPiExtension.mutate(deferredPiExtensionPath)}
              submitDisabled={!deferredPiExtensionPath}
              submitPending={addProjectPiExtension.isPending}
              submitIcon={<PlugZap size={14} />}
              submitLabel="Add"
              items={(piConfig?.projectExtensions ?? []).map((extension) => ({
                key: extension.path,
                title: extension.path,
                detail: 'Project-local extension path',
                onRemove: () => removeProjectPiExtension.mutate(extension.path),
                removePending: removeProjectPiExtension.isPending,
              }))}
            />
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function PiConfigEditorSection({
  title,
  subtitle,
  document,
  draft,
  onChange,
  onSave,
  pending,
  error,
}: {
  title: string;
  subtitle: string;
  document?: PiConfigDocument;
  draft: string;
  onChange: (value: string) => void;
  onSave: () => void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <SettingsSection
      icon={<Wrench size={15} />}
      title={title}
      description={subtitle}
      action={
        <div className="flex items-center gap-2">
          <StatusPill ok={document?.valid ?? true} label={(document?.valid ?? true) ? 'Valid JSON' : 'Invalid JSON'} />
          <Button size="xs" variant="primary" icon={<Save size={13} />} loading={pending} disabled={!draft.trim()} onClick={onSave}>Save</Button>
        </div>
      }
    >
      {document?.parseError && <div className="mb-3 text-xs text-[var(--color-warning)]">{document.parseError}</div>}
      <V2Textarea value={draft} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="min-h-[15rem] w-full font-mono text-[13px] leading-6" />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-dim">
        <span>{document?.exists ? 'Existing file' : 'Will be created on save'}</span>
        {error instanceof Error && <span className="text-[var(--color-error)]">{error.message}</span>}
      </div>
    </SettingsSection>
  );
}

function PiResourceManager({
  title,
  description,
  value,
  placeholder,
  onChange,
  onSubmit,
  submitDisabled,
  submitPending,
  submitIcon,
  submitLabel,
  onRefresh,
  refreshPending,
  items,
}: {
  title: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitPending: boolean;
  submitIcon: ReactNode;
  submitLabel: string;
  onRefresh?: () => void;
  refreshPending?: boolean;
  items: Array<{ key: string; title: string; detail: string; onRemove: () => void; removePending: boolean }>;
}) {
  return (
    <SettingsSection
      icon={<PackagePlus size={15} />}
      title={title}
      description={description}
      action={onRefresh && <Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />} loading={refreshPending} onClick={onRefresh}>Update</Button>}
    >
      <div className="flex gap-2">
        <V2Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1" />
        <Button size="sm" variant="primary" icon={submitIcon} loading={submitPending} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs">{item.title}</div>
              <div className="mt-1 text-xs text-dim">{item.detail}</div>
            </div>
            <button type="button" disabled={item.removePending} onClick={item.onRemove} className="rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:opacity-50">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="py-3 text-sm text-dim">None configured.</div>}
      </div>
    </SettingsSection>
  );
}

function SettingsSection({ icon, title, description, action, children }: { icon: ReactNode; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-card-border)] pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-dim">{icon}</div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-dim">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${ok ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
      {ok ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
      {label}
    </span>
  );
}

function describePiPackage(pkg: PiPackageEntry) {
  const traits = [pkg.scope, pkg.sourceType];
  if (pkg.pinned) traits.push('pinned');
  if (pkg.filtered) traits.push('filtered');
  return traits.join(' · ');
}
