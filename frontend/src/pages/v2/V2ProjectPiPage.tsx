import { useDeferredValue, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, PackagePlus, PlayCircle, PlugZap, RefreshCcw, Save, Trash2, Wrench } from 'lucide-react';
import { projectsApi } from '../../api';
import type { PiConfigDocument, PiPackageEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Content, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Screen, V2Textarea } from './v2-ui';

export function V2ProjectPiPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState('');
  const [modelsDraft, setModelsDraft] = useState('');
  const [projectSettingsDraft, setProjectSettingsDraft] = useState('');
  const [packageSource, setPackageSource] = useState('');
  const [extensionPath, setExtensionPath] = useState('');
  const deferredPackageSource = useDeferredValue(packageSource.trim());
  const deferredExtensionPath = useDeferredValue(extensionPath.trim());

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: workspaces } = useQuery({
    queryKey: ['v2-workspaces', id],
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });

  const { data: piConfig } = useQuery({
    queryKey: ['v2-project-pi-config', id],
    queryFn: () => v2Api.getProjectPiConfig(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (!piConfig) return;
    setGlobalSettingsDraft(piConfig.globalSettings.content);
    setModelsDraft(piConfig.models.content);
    setProjectSettingsDraft(piConfig.projectSettings?.content ?? '');
  }, [piConfig]);

  const refreshPiConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: ['v2-project-pi-config', id] });
    await queryClient.invalidateQueries({ queryKey: ['pi-status'] });
  };

  const saveGlobalSettings = useMutation({ mutationFn: () => v2Api.updatePiSettings(globalSettingsDraft), onSuccess: refreshPiConfig });
  const saveModels = useMutation({ mutationFn: () => v2Api.updatePiModels(modelsDraft), onSuccess: refreshPiConfig });
  const saveProjectSettings = useMutation({ mutationFn: () => v2Api.updateProjectPiSettings(id!, projectSettingsDraft), onSuccess: refreshPiConfig });
  const installProjectPackage = useMutation({
    mutationFn: (source: string) => v2Api.installProjectPiPackage(id!, source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshPiConfig();
    },
  });
  const removeProjectPackage = useMutation({ mutationFn: (source: string) => v2Api.removeProjectPiPackage(id!, source), onSuccess: refreshPiConfig });
  const updateProjectPackages = useMutation({ mutationFn: () => v2Api.updateProjectPiPackages(id!), onSuccess: refreshPiConfig });
  const addProjectExtension = useMutation({
    mutationFn: (path: string) => v2Api.addProjectPiExtension(id!, path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshPiConfig();
    },
  });
  const removeProjectExtension = useMutation({ mutationFn: (path: string) => v2Api.removeProjectPiExtension(id!, path), onSuccess: refreshPiConfig });

  const mainWorkspace = workspaces?.find((workspace) => workspace.kind === 'main') ?? workspaces?.[0];
  const openLoginTerminal = useMutation({
    mutationFn: async () => {
      if (!mainWorkspace) throw new Error('No workspace available for pi login.');
      return v2Api.createTerminal(mainWorkspace.id, { title: 'Pi login', providerHint: 'pi', initialCommand: 'pi' });
    },
    onSuccess: (terminal) => {
      if (!project || !mainWorkspace) return;
      navigate(`/v2/projects/${project.id}?workspace=${mainWorkspace.id}&terminal=${terminal.id}`);
    },
  });

  return (
    <V2Screen>
      <V2Header
        backTo={project ? `/v2/projects/${project.id}` : '/v2'}
        backLabel="Back to workspace"
        eyebrow="Pi settings"
        title={project?.name ?? 'Project'}
        subtitle="Configure pi by editing its real config files. Authentication remains terminal-first and provider-native."
        actions={project && (
          <Link to={`/v2/projects/${project.id}/conversations`}>
            <Button size="xs" variant="secondary" icon={<Wrench size={13} />}>Conversations</Button>
          </Link>
        )}
      />

      <V2Content className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-4 overflow-auto">
          <ConfigEditorCard
            title="Global settings"
            subtitle={piConfig?.globalSettings.path ?? '~/.pi/agent/settings.json'}
            document={piConfig?.globalSettings}
            draft={globalSettingsDraft}
            onChange={setGlobalSettingsDraft}
            onSave={() => saveGlobalSettings.mutate()}
            pending={saveGlobalSettings.isPending}
            error={saveGlobalSettings.error}
          />
          <ConfigEditorCard
            title="Custom models"
            subtitle={piConfig?.models.path ?? '~/.pi/agent/models.json'}
            document={piConfig?.models}
            draft={modelsDraft}
            onChange={setModelsDraft}
            onSave={() => saveModels.mutate()}
            pending={saveModels.isPending}
            error={saveModels.error}
          />
          <ConfigEditorCard
            title="Project override"
            subtitle={piConfig?.projectSettings?.path ?? `${project?.path ?? '.'}/.pi/settings.json`}
            document={piConfig?.projectSettings}
            draft={projectSettingsDraft}
            onChange={setProjectSettingsDraft}
            onSave={() => saveProjectSettings.mutate()}
            pending={saveProjectSettings.isPending}
            error={saveProjectSettings.error}
          />
        </div>

        <div className="space-y-4 overflow-auto">
          <V2Panel>
            <V2PanelHeader
              title="Pi readiness"
              subtitle={piConfig?.status.version ?? 'pi version unavailable'}
              actions={<StatusPill ok={!!piConfig?.status.installed} label={piConfig?.status.installed ? 'Installed' : 'Missing'} />}
            />
            <div className="space-y-3 p-4 text-sm text-[var(--color-text-secondary)]">
              <div className="flex items-center justify-between gap-3">
                <span>Authentication</span>
                <StatusPill ok={!!piConfig?.status.authConfigured} label={piConfig?.status.authConfigured ? 'Configured' : 'Needs login'} />
              </div>
              <div className="break-all rounded-lg bg-inset px-3 py-2 font-mono text-xs text-dim">{piConfig?.status.agentDir ?? '~/.pi/agent'}</div>
              <Button className="w-full" size="sm" variant="primary" icon={<PlayCircle size={14} />} disabled={!mainWorkspace} loading={openLoginTerminal.isPending} onClick={() => openLoginTerminal.mutate()}>
                Open login terminal
              </Button>
              <div className="rounded-lg bg-inset px-3 py-2 font-mono text-xs leading-5 text-dim">pi<br />/login<br />/model</div>
              {openLoginTerminal.error instanceof Error && <div className="text-xs text-[var(--color-error)]">{openLoginTerminal.error.message}</div>}
            </div>
          </V2Panel>

          <ResourceManager
            title="Project packages"
            value={packageSource}
            placeholder="npm:@scope/pkg · ./relative/path"
            onChange={setPackageSource}
            onSubmit={() => installProjectPackage.mutate(deferredPackageSource)}
            submitDisabled={!deferredPackageSource}
            submitPending={installProjectPackage.isPending}
            submitIcon={<PackagePlus size={14} />}
            submitLabel="Install"
            onRefresh={() => updateProjectPackages.mutate()}
            refreshPending={updateProjectPackages.isPending}
            items={(piConfig?.projectPackages ?? []).map((pkg) => ({
              key: pkg.source,
              title: pkg.source,
              detail: describePiPackage(pkg),
              onRemove: () => removeProjectPackage.mutate(pkg.source),
              removePending: removeProjectPackage.isPending,
            }))}
          />

          <ResourceManager
            title="Project extensions"
            value={extensionPath}
            placeholder=".pi/extensions/my-extension.ts"
            onChange={setExtensionPath}
            onSubmit={() => addProjectExtension.mutate(deferredExtensionPath)}
            submitDisabled={!deferredExtensionPath}
            submitPending={addProjectExtension.isPending}
            submitIcon={<PlugZap size={14} />}
            submitLabel="Add"
            items={(piConfig?.projectExtensions ?? []).map((extension) => ({
              key: extension.path,
              title: extension.path,
              detail: 'Project-local extension path',
              onRemove: () => removeProjectExtension.mutate(extension.path),
              removePending: removeProjectExtension.isPending,
            }))}
          />
        </div>
      </V2Content>
    </V2Screen>
  );
}

function ConfigEditorCard({
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
    <V2Panel>
      <V2PanelHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <StatusPill ok={document?.valid ?? true} label={(document?.valid ?? true) ? 'Valid JSON' : 'Invalid JSON'} />
            <Button size="xs" variant="primary" icon={<Save size={13} />} loading={pending} disabled={!draft.trim()} onClick={onSave}>Save</Button>
          </>
        }
      />
      <div className="p-4">
        {document?.parseError && <div className="mb-3 rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">{document.parseError}</div>}
        <V2Textarea value={draft} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="min-h-[15rem] w-full font-mono text-[13px] leading-6" />
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-dim">
          <span>{document?.exists ? 'Existing file' : 'Will be created on save'}</span>
          {error instanceof Error && <span className="text-[var(--color-error)]">{error.message}</span>}
        </div>
      </div>
    </V2Panel>
  );
}

function ResourceManager({
  title,
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
    <V2Panel>
      <V2PanelHeader
        title={title}
        actions={onRefresh && <Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />} loading={refreshPending} onClick={onRefresh}>Update</Button>}
      />
      <div className="space-y-3 p-4">
        <V2Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full" />
        <Button className="w-full" size="sm" variant="primary" icon={submitIcon} loading={submitPending} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
      <div className="border-t border-[var(--color-card-border)]">
        {items.map((item) => (
          <V2Row key={item.key} className="rounded-none border-b border-[var(--color-card-border)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs">{item.title}</div>
                <div className="mt-1 text-xs text-dim">{item.detail}</div>
              </div>
              <Button size="xs" variant="danger" icon={<Trash2 size={13} />} loading={item.removePending} onClick={item.onRemove}>Remove</Button>
            </div>
          </V2Row>
        ))}
        {items.length === 0 && <div className="px-4 py-6 text-sm text-dim">None configured.</div>}
      </div>
    </V2Panel>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${ok ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
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
