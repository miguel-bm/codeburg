import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleSlash,
  Code2,
  ExternalLink,
  KeyRound,
  PackagePlus,
  PlugZap,
  RefreshCcw,
  Save,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { HarnessAuthStatus, HarnessToolId, HarnessToolStatus, PiConfigDocument, PiPackageEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import type { HarnessUpdateEvent } from '../../api/v2';
import { Button, V2Input, V2Screen, V2Textarea } from './v2-ui';

type UpdateLogEntry = {
  id: number;
  event: string;
  text: string;
};

const EMPTY_TOOLS: HarnessToolStatus[] = [];
const EMPTY_AUTH_STATUSES: HarnessAuthStatus[] = [];

export function V2ProjectPiPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState('');
  const [modelsDraft, setModelsDraft] = useState('');
  const [projectSettingsDraft, setProjectSettingsDraft] = useState('');
  const [packageSource, setPackageSource] = useState('');
  const [extensionPath, setExtensionPath] = useState('');
  const [checkLatest, setCheckLatest] = useState(false);
  const [activeUpdate, setActiveUpdate] = useState<HarnessToolId | null>(null);
  const [updateLog, setUpdateLog] = useState<UpdateLogEntry[]>([]);
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
  const { data: harnessStatus, isFetching: harnessFetching } = useQuery({
    queryKey: ['harness-status', checkLatest],
    queryFn: () => v2Api.getHarnessStatus(checkLatest),
  });

  useEffect(() => {
    if (!piConfig) return;
    setGlobalSettingsDraft(piConfig.globalSettings.content);
    setModelsDraft(piConfig.models.content);
    setProjectSettingsDraft(piConfig.projectSettings?.content ?? '');
  }, [piConfig]);

  const refreshHarnessState = async () => {
    await queryClient.invalidateQueries({ queryKey: ['harness-status'] });
    await queryClient.invalidateQueries({ queryKey: ['v2-project-pi-config', id] });
    await queryClient.invalidateQueries({ queryKey: ['pi-status'] });
  };

  const saveGlobalSettings = useMutation({ mutationFn: () => v2Api.updatePiSettings(globalSettingsDraft), onSuccess: refreshHarnessState });
  const saveModels = useMutation({ mutationFn: () => v2Api.updatePiModels(modelsDraft), onSuccess: refreshHarnessState });
  const saveProjectSettings = useMutation({ mutationFn: () => v2Api.updateProjectPiSettings(id!, projectSettingsDraft), onSuccess: refreshHarnessState });
  const installProjectPackage = useMutation({
    mutationFn: (source: string) => v2Api.installProjectPiPackage(id!, source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshHarnessState();
    },
  });
  const removeProjectPackage = useMutation({ mutationFn: (source: string) => v2Api.removeProjectPiPackage(id!, source), onSuccess: refreshHarnessState });
  const updateProjectPackages = useMutation({ mutationFn: () => v2Api.updateProjectPiPackages(id!), onSuccess: refreshHarnessState });
  const addProjectExtension = useMutation({
    mutationFn: (path: string) => v2Api.addProjectPiExtension(id!, path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshHarnessState();
    },
  });
  const removeProjectExtension = useMutation({ mutationFn: (path: string) => v2Api.removeProjectPiExtension(id!, path), onSuccess: refreshHarnessState });

  const mainWorkspace = workspaces?.find((workspace) => workspace.kind === 'main') ?? workspaces?.[0];
  const openLoginTerminal = useMutation({
    mutationFn: async () => {
      if (!mainWorkspace) throw new Error('No workspace available for harness login.');
      return v2Api.createTerminal(mainWorkspace.id, {
        title: 'Harness login',
        providerHint: 'terminal',
        initialCommand: "printf 'Pi: run pi and use /login\\nCodex: run codex login\\nClaude Code: run claude auth login\\n\\n'; exec ${SHELL:-bash} -l",
      });
    },
    onSuccess: (terminal) => {
      if (!project || !mainWorkspace) return;
      navigate(`/v2/projects/${project.id}?workspace=${mainWorkspace.id}&terminal=${terminal.id}`);
    },
  });

  const addUpdateLog = (event: HarnessUpdateEvent) => {
    const text = event.event === 'done' ? formatDoneEvent(event.data) : event.data;
    if (!text.trim()) return;
    setUpdateLog((current) => [...current, { id: Date.now() + current.length, event: event.event, text }].slice(-300));
  };

  const updateHarness = useMutation({
    mutationFn: async (tool: HarnessToolId) => {
      setActiveUpdate(tool);
      setUpdateLog([]);
      const exitCode = await v2Api.streamHarnessUpdate(tool, addUpdateLog);
      if (exitCode !== 0) {
        throw new Error(`Update exited with code ${exitCode}`);
      }
      return exitCode;
    },
    onSettled: async () => {
      setActiveUpdate(null);
      await refreshHarnessState();
    },
  });

  const runningTool = activeUpdate ?? harnessStatus?.update?.tool ?? null;
  const updateLocked = updateHarness.isPending || Boolean(harnessStatus?.update?.running);
  const tools = harnessStatus?.tools ?? EMPTY_TOOLS;
  const authStatuses = harnessStatus?.auth ?? EMPTY_AUTH_STATUSES;

  const piTool = useMemo(() => tools.find((tool) => tool.id === 'pi'), [tools]);

  const checkLatestVersions = () => {
    if (!checkLatest) {
      setCheckLatest(true);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['harness-status', true] });
  };

  return (
    <V2Screen>
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 bg-canvas px-6 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Harness</div>
          <div className="text-xs text-dim">{project?.name ?? 'Project'} agent runtimes, login state, and Pi configuration.</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} loading={harnessFetching} onClick={checkLatestVersions}>
            Check latest
          </Button>
          <Link to={project ? `/v2/projects/${project.id}/settings` : '/v2/settings'}>
            <Button size="sm" variant="ghost">Project settings</Button>
          </Link>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="space-y-10">
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <SectionTitle icon={<Bot size={15} />} title="Harness runtimes" description="Installed tools used by Codeburg conversations and terminals." />
              {harnessStatus?.update?.running && (
                <StatusPill ok={false} label={`Updating ${harnessStatus.update.tool ?? 'tool'}`} />
              )}
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              {tools.map((tool) => (
                <HarnessToolCard
                  key={tool.id}
                  tool={tool}
                  updating={runningTool === tool.id}
                  disabled={updateLocked && runningTool !== tool.id}
                  latestChecked={checkLatest}
                  onUpdate={() => updateHarness.mutate(tool.id)}
                />
              ))}
              {tools.length === 0 && (
                <div className="rounded-xl bg-card p-4 text-sm text-dim shadow-[var(--shadow-card)]">Loading harness runtimes...</div>
              )}
            </div>
            {(updateLog.length > 0 || updateHarness.error instanceof Error) && (
              <UpdateLogPanel entries={updateLog} error={updateHarness.error instanceof Error ? updateHarness.error.message : undefined} />
            )}
          </section>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-10">
              <ConfigEditorSection
                title="Global Pi settings"
                subtitle={piConfig?.globalSettings.path ?? '~/.pi/agent/settings.json'}
                document={piConfig?.globalSettings}
                draft={globalSettingsDraft}
                onChange={setGlobalSettingsDraft}
                onSave={() => saveGlobalSettings.mutate()}
                pending={saveGlobalSettings.isPending}
                error={saveGlobalSettings.error}
              />
              <ConfigEditorSection
                title="Pi model registry"
                subtitle={piConfig?.models.path ?? '~/.pi/agent/models.json'}
                document={piConfig?.models}
                draft={modelsDraft}
                onChange={setModelsDraft}
                onSave={() => saveModels.mutate()}
                pending={saveModels.isPending}
                error={saveModels.error}
              />
              <ConfigEditorSection
                title="Project Pi override"
                subtitle={piConfig?.projectSettings?.path ?? `${project?.path ?? '.'}/.pi/settings.json`}
                document={piConfig?.projectSettings}
                draft={projectSettingsDraft}
                onChange={setProjectSettingsDraft}
                onSave={() => saveProjectSettings.mutate()}
                pending={saveProjectSettings.isPending}
                error={saveProjectSettings.error}
              />
            </div>

            <aside className="space-y-8">
              <SettingsSection
                icon={<KeyRound size={15} />}
                title="Login status"
                description="Direct harness auth plus Codex credentials available inside Pi."
                action={
                  <Button size="xs" variant="secondary" icon={<TerminalSquare size={13} />} disabled={!mainWorkspace} loading={openLoginTerminal.isPending} onClick={() => openLoginTerminal.mutate()}>
                    Login terminal
                  </Button>
                }
              >
                <div className="space-y-2">
                  {authStatuses.map((status) => <AuthStatusRow key={status.id} status={status} />)}
                  {authStatuses.length === 0 && <div className="py-3 text-sm text-dim">Loading auth status...</div>}
                </div>
              </SettingsSection>

              <SettingsSection icon={<PlugZap size={15} />} title="Pi runtime" description={piTool?.version ?? piConfig?.status.version ?? 'pi version unavailable'}>
                <div className="space-y-2 text-sm">
                  <StatusLine label="Installed" ok={!!piConfig?.status.installed} value={piConfig?.status.installed ? 'Yes' : 'No'} />
                  <StatusLine label="Auth" ok={!!piConfig?.status.authConfigured} value={piConfig?.status.authConfigured ? 'Configured' : 'Needs login'} />
                  <div className="break-all py-2 font-mono text-xs text-dim">{piConfig?.status.agentDir ?? '~/.pi/agent'}</div>
                </div>
              </SettingsSection>

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
            </aside>
          </div>
        </div>
      </main>
    </V2Screen>
  );
}

function HarnessToolCard({
  tool,
  updating,
  disabled,
  latestChecked,
  onUpdate,
}: {
  tool: HarnessToolStatus;
  updating: boolean;
  disabled: boolean;
  latestChecked: boolean;
  onUpdate: () => void;
}) {
  const stale = Boolean(tool.latestVersion && tool.version && !tool.version.includes(tool.latestVersion));
  return (
    <article className="flex min-h-[15rem] flex-col rounded-xl bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-dim">{toolIcon(tool.id)}</div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{tool.name}</h2>
            <p className="mt-1 truncate font-mono text-xs text-dim">{tool.packageName}</p>
          </div>
        </div>
        <StatusPill ok={tool.installed && !stale} label={!tool.installed ? 'Missing' : stale ? 'Update' : 'Ready'} />
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <StatusLine label="Installed" ok={tool.installed} value={tool.installed ? 'Yes' : 'No'} />
        <InfoLine label="Current" value={tool.version ?? 'Unavailable'} mono />
        <InfoLine label="Latest" value={tool.latestVersion ?? (latestChecked ? 'Unavailable' : 'Not checked')} mono />
        <div className="break-all py-1 font-mono text-xs text-dim">{tool.binaryPath ?? 'No binary on PATH'}</div>
      </div>

      {tool.loadWarnings && tool.loadWarnings.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-[var(--color-warning)]">
          {tool.loadWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="mb-3 truncate font-mono text-xs text-dim">{tool.updateCommand}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<RefreshCcw size={14} />} loading={updating} disabled={disabled} onClick={onUpdate}>
            Update {tool.name}
          </Button>
          <ExternalLinkButton href={tool.changelogUrl}>Changelog</ExternalLinkButton>
          <ExternalLinkButton href={tool.installUrl}>Docs</ExternalLinkButton>
        </div>
      </div>
    </article>
  );
}

function UpdateLogPanel({ entries, error }: { entries: UpdateLogEntry[]; error?: string }) {
  return (
    <section className="rounded-xl bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-card-border)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TerminalSquare size={15} className="text-dim" />
          Update output
        </div>
        <div className="text-xs text-dim">{entries.length} lines</div>
      </div>
      <div className="max-h-72 overflow-auto px-4 py-3 font-mono text-xs leading-5">
        {entries.map((entry) => (
          <div key={entry.id} className={entry.event === 'stderr' || entry.event === 'error' ? 'text-[var(--color-warning)]' : 'text-dim'}>
            <span className="mr-2 text-[var(--color-text-secondary)]">{entry.event}</span>
            {entry.text}
          </div>
        ))}
        {error && <div className="text-[var(--color-error)]">{error}</div>}
      </div>
    </section>
  );
}

function AuthStatusRow({ status }: { status: HarnessAuthStatus }) {
  const detail = status.detail || status.providers?.join(' · ') || (status.loggedIn ? 'Configured' : 'Needs login');
  return (
    <div className="rounded-lg bg-primary px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{status.name}</div>
          <div className="mt-1 truncate text-xs text-dim">{status.method ?? detail}</div>
        </div>
        {status.loggedIn ? <ShieldCheck size={15} className="text-[var(--color-success)]" /> : <CircleSlash size={15} className="text-dim" />}
      </div>
      {status.method && status.detail && <div className="mt-2 truncate text-xs text-dim">{status.detail}</div>}
      {status.providers && status.providers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {status.providers.map((provider) => (
            <span key={provider} className="rounded-md bg-[var(--color-card-hover)] px-1.5 py-0.5 font-mono text-[11px] text-dim">{provider}</span>
          ))}
        </div>
      )}
      {status.loadWarnings?.map((warning) => (
        <div key={warning} className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

function ConfigEditorSection({
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
    <SettingsSection icon={<PackagePlus size={15} />} title={title} description="Project-scoped Pi resources." action={onRefresh && <Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />} loading={refreshPending} onClick={onRefresh}>Update</Button>}>
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
            <p className="mt-1 truncate text-xs text-dim">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="mt-0.5 text-dim">{icon}</div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-dim">{description}</p>
      </div>
    </div>
  );
}

function ExternalLinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-dim">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        {ok ? <CheckCircle2 size={13} className="shrink-0 text-[var(--color-success)]" /> : <CircleSlash size={13} className="shrink-0 text-dim" />}
        {value}
      </span>
    </div>
  );
}

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1">
      <span className="text-dim">{label}</span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
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

function toolIcon(tool: HarnessToolId) {
  switch (tool) {
    case 'codex':
      return <Code2 size={15} />;
    case 'claude':
      return <Bot size={15} />;
    case 'pi':
    default:
      return <PlugZap size={15} />;
  }
}

function describePiPackage(pkg: PiPackageEntry) {
  const traits = [pkg.scope, pkg.sourceType];
  if (pkg.pinned) traits.push('pinned');
  if (pkg.filtered) traits.push('filtered');
  return traits.join(' · ');
}

function formatDoneEvent(data: string) {
  try {
    const parsed = JSON.parse(data) as { exitCode?: number };
    return `exit code ${parsed.exitCode ?? 0}`;
  } catch {
    return data;
  }
}
