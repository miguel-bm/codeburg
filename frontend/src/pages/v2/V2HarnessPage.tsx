import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  Globe2,
  KeyRound,
  PackagePlus,
  PlugZap,
  RefreshCcw,
  Save,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';
import type { HarnessAuthStatus, HarnessToolId, HarnessToolStatus, PiConfigDocument, PiPackageEntry, PiWebAccessStatus, UpdatePiWebAccessConfigInput } from '../../api/types';
import { v2Api } from '../../api/v2';
import type { HarnessUpdateEvent } from '../../api/v2';
import { Button, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';

type UpdateLogEntry = {
  id: number;
  event: string;
  text: string;
};

const EMPTY_TOOLS: HarnessToolStatus[] = [];
const EMPTY_AUTH_STATUSES: HarnessAuthStatus[] = [];
const WEB_ACCESS_PACKAGE_SOURCE = 'npm:pi-web-access';

type WebAccessForm = {
  provider: string;
  workflow: string;
  searchModel: string;
  chromeProfile: string;
  curatorTimeoutSeconds: string;
  githubCloneEnabled: boolean;
  githubCloneMaxRepoSizeMB: string;
  githubCloneTimeoutSeconds: string;
  githubClonePath: string;
  youtubeEnabled: boolean;
  youtubePreferredModel: string;
  videoEnabled: boolean;
  videoPreferredModel: string;
  videoMaxSizeMB: string;
};

type WebAccessSecretDrafts = {
  exa: string;
  perplexity: string;
  gemini: string;
  clearExa: boolean;
  clearPerplexity: boolean;
  clearGemini: boolean;
};

const EMPTY_WEB_ACCESS_SECRETS: WebAccessSecretDrafts = {
  exa: '',
  perplexity: '',
  gemini: '',
  clearExa: false,
  clearPerplexity: false,
  clearGemini: false,
};

export function V2HarnessPage() {
  const queryClient = useQueryClient();
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState('');
  const [modelsDraft, setModelsDraft] = useState('');
  const [packageSource, setPackageSource] = useState('');
  const [extensionPath, setExtensionPath] = useState('');
  const [webAccessForm, setWebAccessForm] = useState<WebAccessForm>(() => webAccessFormFromStatus());
  const [webAccessSecrets, setWebAccessSecrets] = useState<WebAccessSecretDrafts>(EMPTY_WEB_ACCESS_SECRETS);
  const [latestRequested, setLatestRequested] = useState(false);
  const [activeUpdate, setActiveUpdate] = useState<HarnessToolId | null>(null);
  const [dialogTool, setDialogTool] = useState<HarnessToolId | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateLog, setUpdateLog] = useState<UpdateLogEntry[]>([]);
  const deferredPackageSource = useDeferredValue(packageSource.trim());
  const deferredExtensionPath = useDeferredValue(extensionPath.trim());

  const { data: piConfig } = useQuery({
    queryKey: ['v2-pi-config'],
    queryFn: () => v2Api.getPiConfig(),
  });
  const { data: harnessStatus } = useQuery({
    queryKey: ['harness-status'],
    queryFn: () => v2Api.getHarnessStatus(latestRequested),
  });

  useEffect(() => {
    if (!piConfig) return;
    setGlobalSettingsDraft(piConfig.globalSettings.content);
    setModelsDraft(piConfig.models.content);
    setWebAccessForm(webAccessFormFromStatus(piConfig.webAccess));
    setWebAccessSecrets(EMPTY_WEB_ACCESS_SECRETS);
  }, [piConfig]);

  const refreshHarnessState = async () => {
    await queryClient.invalidateQueries({ queryKey: ['harness-status'] });
    await queryClient.invalidateQueries({ queryKey: ['v2-pi-config'] });
    await queryClient.invalidateQueries({ queryKey: ['pi-status'] });
  };

  const saveGlobalSettings = useMutation({ mutationFn: () => v2Api.updatePiSettings(globalSettingsDraft), onSuccess: refreshHarnessState });
  const saveModels = useMutation({ mutationFn: () => v2Api.updatePiModels(modelsDraft), onSuccess: refreshHarnessState });
  const installGlobalPackage = useMutation({
    mutationFn: (source: string) => v2Api.installPiPackage(source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshHarnessState();
    },
  });
  const removeGlobalPackage = useMutation({ mutationFn: (source: string) => v2Api.removePiPackage(source), onSuccess: refreshHarnessState });
  const updateGlobalPackages = useMutation({ mutationFn: () => v2Api.updatePiPackages(), onSuccess: refreshHarnessState });
  const installWebAccess = useMutation({ mutationFn: () => v2Api.installPiPackage(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const removeWebAccess = useMutation({ mutationFn: () => v2Api.removePiPackage(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const updateWebAccess = useMutation({ mutationFn: () => v2Api.updatePiPackages(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const saveWebAccess = useMutation({
    mutationFn: () => v2Api.updatePiWebAccessConfig(buildWebAccessConfigInput(webAccessForm, webAccessSecrets)),
    onSuccess: async () => {
      setWebAccessSecrets(EMPTY_WEB_ACCESS_SECRETS);
      await refreshHarnessState();
    },
  });
  const addGlobalExtension = useMutation({
    mutationFn: (path: string) => v2Api.addPiExtension(path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshHarnessState();
    },
  });
  const removeGlobalExtension = useMutation({ mutationFn: (path: string) => v2Api.removePiExtension(path), onSuccess: refreshHarnessState });

  const checkLatestVersions = useMutation({
    mutationFn: () => v2Api.getHarnessStatus(true),
    onMutate: () => {
      setLatestRequested(true);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(['harness-status'], status);
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
      setDialogTool(tool);
      setUpdateDialogOpen(true);
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
  const updateDialogVisible = updateDialogOpen && (updateLocked || updateLog.length > 0 || updateHarness.error instanceof Error);
  const tools = harnessStatus?.tools ?? EMPTY_TOOLS;
  const authStatuses = harnessStatus?.auth ?? EMPTY_AUTH_STATUSES;

  const piTool = useMemo(() => tools.find((tool) => tool.id === 'pi'), [tools]);

  return (
    <V2Screen>
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 bg-canvas px-6 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Harness</div>
          <div className="text-xs text-dim">Global agent runtimes, login state, and Pi configuration.</div>
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
              {tools.length > 0 ? tools.map((tool) => (
                <HarnessToolCard
                  key={tool.id}
                  tool={tool}
                  updating={runningTool === tool.id}
                  disabled={updateLocked && runningTool !== tool.id}
                  latestChecked={Boolean(harnessStatus?.checkedLatest)}
                  checkingLatest={checkLatestVersions.isPending}
                  onCheckLatest={() => checkLatestVersions.mutate()}
                  onUpdate={() => updateHarness.mutate(tool.id)}
                />
              )) : <HarnessToolLoadingCards />}
            </div>
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
            </div>

            <aside className="space-y-8">
              <SettingsSection
                icon={<KeyRound size={15} />}
                title="Login status"
                description="Direct harness auth plus Codex credentials available inside Pi."
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

              <WebAccessSection
                webAccess={piConfig?.webAccess}
                form={webAccessForm}
                secrets={webAccessSecrets}
                onFormChange={setWebAccessForm}
                onSecretsChange={setWebAccessSecrets}
                onInstall={() => installWebAccess.mutate()}
                installPending={installWebAccess.isPending}
                installError={installWebAccess.error}
                onRemove={() => removeWebAccess.mutate()}
                removePending={removeWebAccess.isPending}
                removeError={removeWebAccess.error}
                onUpdate={() => updateWebAccess.mutate()}
                updatePending={updateWebAccess.isPending}
                updateError={updateWebAccess.error}
                onSave={() => saveWebAccess.mutate()}
                savePending={saveWebAccess.isPending}
                saveError={saveWebAccess.error}
              />

              <ResourceManager
                title="Global Pi packages"
                description="Installed for every project that uses Pi."
                value={packageSource}
                placeholder="npm:@scope/pkg · ./relative/path"
                onChange={setPackageSource}
                onSubmit={() => installGlobalPackage.mutate(deferredPackageSource)}
                submitDisabled={!deferredPackageSource}
                submitPending={installGlobalPackage.isPending}
                submitIcon={<PackagePlus size={14} />}
                submitLabel="Install"
                onRefresh={() => updateGlobalPackages.mutate()}
                refreshPending={updateGlobalPackages.isPending}
                items={(piConfig?.globalPackages ?? []).map((pkg) => ({
                  key: pkg.source,
                  title: pkg.source,
                  detail: describePiPackage(pkg),
                  onRemove: () => removeGlobalPackage.mutate(pkg.source),
                  removePending: removeGlobalPackage.isPending,
                }))}
              />

              <ResourceManager
                title="Global Pi extensions"
                description="Extension paths available to Pi across projects."
                value={extensionPath}
                placeholder=".pi/extensions/my-extension.ts"
                onChange={setExtensionPath}
                onSubmit={() => addGlobalExtension.mutate(deferredExtensionPath)}
                submitDisabled={!deferredExtensionPath}
                submitPending={addGlobalExtension.isPending}
                submitIcon={<PlugZap size={14} />}
                submitLabel="Add"
                items={(piConfig?.globalExtensions ?? []).map((extension) => ({
                  key: extension.path,
                  title: extension.path,
                  detail: 'Global extension path',
                  onRemove: () => removeGlobalExtension.mutate(extension.path),
                  removePending: removeGlobalExtension.isPending,
                }))}
              />
            </aside>
          </div>
        </div>
      </main>
      <UpdateLogDialog
        open={updateDialogVisible}
        toolName={toolDisplayName(dialogTool, tools)}
        running={updateLocked}
        entries={updateLog}
        error={updateHarness.error instanceof Error ? updateHarness.error.message : undefined}
        onClose={() => setUpdateDialogOpen(false)}
      />
    </V2Screen>
  );
}

function HarnessToolCard({
  tool,
  updating,
  disabled,
  latestChecked,
  checkingLatest,
  onCheckLatest,
  onUpdate,
}: {
  tool: HarnessToolStatus;
  updating: boolean;
  disabled: boolean;
  latestChecked: boolean;
  checkingLatest: boolean;
  onCheckLatest: () => void;
  onUpdate: () => void;
}) {
  const currentVersion = normalizeHarnessVersion(tool.version);
  const latestVersion = normalizeHarnessVersion(tool.latestVersion);
  const stale = Boolean(currentVersion && latestVersion && currentVersion !== latestVersion);
  return (
    <article className="flex min-h-[15rem] flex-col rounded-xl bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <HarnessToolLogo tool={tool.id} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{tool.name}</h2>
            <p className="mt-1 truncate font-mono text-xs text-dim">{tool.packageName}</p>
          </div>
        </div>
        <StatusPill ok={tool.installed && !stale} label={!tool.installed ? 'Missing' : stale ? 'Update' : 'Ready'} />
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <StatusLine label="Installed" ok={tool.installed} value={tool.installed ? 'Yes' : 'No'} />
        <InfoLine label="Current" value={currentVersion ?? 'Unavailable'} mono />
        <LatestVersionLine
          version={latestVersion}
          latestChecked={latestChecked}
          checkingLatest={checkingLatest}
          onCheckLatest={onCheckLatest}
        />
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
            Update
          </Button>
          <ExternalLinkButton href={tool.changelogUrl}>Changelog</ExternalLinkButton>
          <ExternalLinkButton href={tool.installUrl}>Docs</ExternalLinkButton>
        </div>
      </div>
    </article>
  );
}

function HarnessToolLoadingCards() {
  const placeholders: Array<{ id: HarnessToolId; name: string; packageName: string }> = [
    { id: 'pi', name: 'Pi', packageName: '@mariozechner/pi-coding-agent' },
    { id: 'codex', name: 'Codex', packageName: '@openai/codex' },
    { id: 'claude', name: 'Claude Code', packageName: '@anthropic-ai/claude-code' },
  ];

  return (
    <>
      {placeholders.map((tool) => (
        <article key={tool.id} className="flex min-h-[15rem] flex-col rounded-xl bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <HarnessToolLogo tool={tool.id} />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{tool.name}</h2>
                <p className="mt-1 truncate font-mono text-xs text-dim">{tool.packageName}</p>
              </div>
            </div>
            <StatusPill ok={false} label="Checking" />
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <LoadingLine label="Installed" />
            <LoadingLine label="Current" />
            <LoadingLine label="Latest" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-card-hover)]" />
          </div>
          <div className="mt-auto pt-4">
            <div className="mb-3 h-3 w-2/3 animate-pulse rounded bg-[var(--color-card-hover)]" />
            <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--color-card-hover)]" />
          </div>
        </article>
      ))}
    </>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-dim">{label}</span>
      <span className="h-3 w-24 animate-pulse rounded bg-[var(--color-card-hover)]" />
    </div>
  );
}

function LatestVersionLine({
  version,
  latestChecked,
  checkingLatest,
  onCheckLatest,
}: {
  version?: string;
  latestChecked: boolean;
  checkingLatest: boolean;
  onCheckLatest: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1">
      <span className="text-dim">Latest</span>
      {version ? (
        <span className="min-w-0 truncate font-mono text-xs">{version}</span>
      ) : latestChecked ? (
        <span className="min-w-0 truncate font-mono text-xs">Unavailable</span>
      ) : (
        <button
          type="button"
          disabled={checkingLatest}
          onClick={onCheckLatest}
          className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-[var(--color-card-hover)] disabled:text-dim"
        >
          {checkingLatest && <RefreshCcw size={12} className="animate-spin" />}
          {checkingLatest ? 'Checking...' : 'Check latest'}
        </button>
      )}
    </div>
  );
}

function UpdateLogDialog({
  open,
  toolName,
  running,
  entries,
  error,
  onClose,
}: {
  open: boolean;
  toolName: string;
  running: boolean;
  entries: UpdateLogEntry[];
  error?: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--color-bg-primary)]/55 p-3 backdrop-blur-sm md:items-center md:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <section
        className="flex max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-card)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="harness-update-output-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-card-border)] px-4 py-4 md:px-5">
          <div className="min-w-0">
            <h2 id="harness-update-output-title" className="flex items-center gap-2 text-sm font-semibold">
              <TerminalSquare size={15} className="text-dim" />
              {toolName} update output
            </h2>
            <p className="mt-1 text-xs text-dim">{running ? 'Running update command...' : `${entries.length} output lines`}</p>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-40"
            aria-label="Close update output"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5 md:px-5">
          {entries.length === 0 && !error && <div className="text-dim">Waiting for output...</div>}
          {entries.map((entry) => (
            <div key={entry.id} className={entry.event === 'stderr' || entry.event === 'error' ? 'text-[var(--color-warning)]' : 'text-dim'}>
              <span className="mr-2 text-[var(--color-text-secondary)]">{entry.event}</span>
              {entry.text}
            </div>
          ))}
          {error && <div className="text-[var(--color-error)]">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-4 py-3 md:px-5">
          <Button size="sm" variant="secondary" disabled={running} onClick={onClose}>
            {running ? 'Running...' : 'Close'}
          </Button>
        </div>
      </section>
    </div>
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

function WebAccessSection({
  webAccess,
  form,
  secrets,
  onFormChange,
  onSecretsChange,
  onInstall,
  installPending,
  installError,
  onRemove,
  removePending,
  removeError,
  onUpdate,
  updatePending,
  updateError,
  onSave,
  savePending,
  saveError,
}: {
  webAccess?: PiWebAccessStatus;
  form: WebAccessForm;
  secrets: WebAccessSecretDrafts;
  onFormChange: (form: WebAccessForm) => void;
  onSecretsChange: (secrets: WebAccessSecretDrafts) => void;
  onInstall: () => void;
  installPending: boolean;
  installError: unknown;
  onRemove: () => void;
  removePending: boolean;
  removeError: unknown;
  onUpdate: () => void;
  updatePending: boolean;
  updateError: unknown;
  onSave: () => void;
  savePending: boolean;
  saveError: unknown;
}) {
  const configValid = webAccess?.configValid ?? true;
  const ready = Boolean(webAccess?.installed && configValid && webAccess.configExists);
  const statusLabel = !webAccess?.installed ? 'Missing' : !configValid ? 'Invalid config' : webAccess.configExists ? 'Ready' : 'Configure';
  const actionError = firstErrorMessage(saveError, installError, updateError, removeError);
  const updateForm = (patch: Partial<WebAccessForm>) => onFormChange({ ...form, ...patch });
  const updateSecrets = (patch: Partial<WebAccessSecretDrafts>) => onSecretsChange({ ...secrets, ...patch });

  return (
    <SettingsSection
      icon={<Globe2 size={15} />}
      title="Pi web access"
      description={webAccess?.configPath ?? '~/.pi/web-search.json'}
      action={<StatusPill ok={ready} label={statusLabel} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {!webAccess?.installed ? (
            <Button size="sm" variant="primary" icon={<PackagePlus size={14} />} loading={installPending} onClick={onInstall}>
              Install
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} loading={updatePending} onClick={onUpdate}>
                Update
              </Button>
              <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} loading={removePending} onClick={onRemove}>
                Remove
              </Button>
            </>
          )}
          <span className="font-mono text-xs text-dim">{webAccess?.packageSource ?? WEB_ACCESS_PACKAGE_SOURCE}</span>
        </div>

        {webAccess?.parseError && (
          <div className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">{webAccess.parseError}</div>
        )}
        {webAccess?.loadWarnings?.map((warning) => (
          <div key={warning} className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">{warning}</div>
        ))}

        <div className="grid gap-3 md:grid-cols-2">
          <LabeledControl label="Provider">
            <V2Select value={form.provider} onChange={(event) => updateForm({ provider: event.target.value })} className="w-full">
              <option value="auto">Auto</option>
              <option value="exa">Exa</option>
              <option value="perplexity">Perplexity</option>
              <option value="gemini">Gemini</option>
            </V2Select>
          </LabeledControl>
          <LabeledControl label="Curator">
            <V2Select value={form.workflow} onChange={(event) => updateForm({ workflow: event.target.value })} className="w-full">
              <option value="none">Off for Codeburg chat</option>
              <option value="summary-review">Summary review</option>
            </V2Select>
          </LabeledControl>
          <LabeledControl label="Search model">
            <V2Input value={form.searchModel} onChange={(event) => updateForm({ searchModel: event.target.value })} placeholder="gemini-2.5-flash" className="w-full" />
          </LabeledControl>
          <LabeledControl label="Curator timeout">
            <V2Input value={form.curatorTimeoutSeconds} onChange={(event) => updateForm({ curatorTimeoutSeconds: event.target.value })} inputMode="numeric" placeholder="20" className="w-full" />
          </LabeledControl>
          <LabeledControl label="Chrome profile">
            <V2Input value={form.chromeProfile} onChange={(event) => updateForm({ chromeProfile: event.target.value })} placeholder="Profile 2" className="w-full" />
          </LabeledControl>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">API keys</div>
          <CredentialRow
            label="Exa"
            credential={webAccess?.credentials.exa}
            value={secrets.exa}
            clear={secrets.clearExa}
            onValueChange={(value) => updateSecrets({ exa: value })}
            onClearChange={(clearExa) => updateSecrets({ clearExa })}
          />
          <CredentialRow
            label="Perplexity"
            credential={webAccess?.credentials.perplexity}
            value={secrets.perplexity}
            clear={secrets.clearPerplexity}
            onValueChange={(value) => updateSecrets({ perplexity: value })}
            onClearChange={(clearPerplexity) => updateSecrets({ clearPerplexity })}
          />
          <CredentialRow
            label="Gemini"
            credential={webAccess?.credentials.gemini}
            value={secrets.gemini}
            clear={secrets.clearGemini}
            onValueChange={(value) => updateSecrets({ gemini: value })}
            onClearChange={(clearGemini) => updateSecrets({ clearGemini })}
          />
        </div>

        <div className="space-y-2">
          <CheckboxRow
            label="GitHub cloning"
            detail="Use local clones for repository URLs."
            checked={form.githubCloneEnabled}
            onChange={(githubCloneEnabled) => updateForm({ githubCloneEnabled })}
          />
          <div className="grid gap-2 md:grid-cols-3">
            <V2Input value={form.githubCloneMaxRepoSizeMB} onChange={(event) => updateForm({ githubCloneMaxRepoSizeMB: event.target.value })} inputMode="numeric" placeholder="350 MB" />
            <V2Input value={form.githubCloneTimeoutSeconds} onChange={(event) => updateForm({ githubCloneTimeoutSeconds: event.target.value })} inputMode="numeric" placeholder="30 sec" />
            <V2Input value={form.githubClonePath} onChange={(event) => updateForm({ githubClonePath: event.target.value })} placeholder="/tmp/pi-github-repos" />
          </div>
          <CheckboxRow
            label="YouTube understanding"
            detail="Allow video URL analysis through the extension."
            checked={form.youtubeEnabled}
            onChange={(youtubeEnabled) => updateForm({ youtubeEnabled })}
          />
          <V2Input value={form.youtubePreferredModel} onChange={(event) => updateForm({ youtubePreferredModel: event.target.value })} placeholder="YouTube model" />
          <CheckboxRow
            label="Local video analysis"
            detail="Allow local video files to be sent to the configured provider."
            checked={form.videoEnabled}
            onChange={(videoEnabled) => updateForm({ videoEnabled })}
          />
          <div className="grid gap-2 md:grid-cols-2">
            <V2Input value={form.videoPreferredModel} onChange={(event) => updateForm({ videoPreferredModel: event.target.value })} placeholder="video model" />
            <V2Input value={form.videoMaxSizeMB} onChange={(event) => updateForm({ videoMaxSizeMB: event.target.value })} inputMode="numeric" placeholder="50 MB" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-dim">{webAccess?.configExists ? 'Existing config' : 'Will create config on save'}</div>
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={savePending} onClick={onSave}>
            Save web access
          </Button>
        </div>
        {actionError && <div className="text-xs text-[var(--color-error)]">{actionError}</div>}
      </div>
    </SettingsSection>
  );
}

function LabeledControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function CredentialRow({
  label,
  credential,
  value,
  clear,
  onValueChange,
  onClearChange,
}: {
  label: string;
  credential?: { configured: boolean; source?: string };
  value: string;
  clear: boolean;
  onValueChange: (value: string) => void;
  onClearChange: (clear: boolean) => void;
}) {
  const detail = credential?.configured ? `Configured via ${credential.source || 'config'}` : 'Not configured';
  const canClear = credential?.configured && credential.source !== 'env';
  return (
    <div className="rounded-lg bg-primary px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          <div className="mt-0.5 text-xs text-dim">{detail}</div>
        </div>
        <StatusPill ok={Boolean(credential?.configured) && !clear} label={clear ? 'Clearing' : credential?.configured ? 'Set' : 'Unset'} />
      </div>
      <div className="flex gap-2">
        <V2Input
          type="password"
          value={value}
          disabled={clear}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={clear ? 'Saved key will be cleared' : `Set ${label} API key`}
          className="min-w-0 flex-1"
        />
        {canClear && (
          <Button size="sm" variant={clear ? 'primary' : 'secondary'} onClick={() => onClearChange(!clear)}>
            {clear ? 'Keep' : 'Clear'}
          </Button>
        )}
      </div>
    </div>
  );
}

function CheckboxRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-primary px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-dim">{detail}</span>
      </span>
    </label>
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
    <SettingsSection icon={<PackagePlus size={15} />} title={title} description={description} action={onRefresh && <Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />} loading={refreshPending} onClick={onRefresh}>Update</Button>}>
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

function HarnessToolLogo({ tool }: { tool: HarnessToolId }) {
  switch (tool) {
    case 'codex':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <img src={openaiLogo} alt="" className="h-5 w-5 object-contain" />
        </div>
      );
    case 'claude':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <img src={claudeLogo} alt="" className="h-5 w-5 object-contain" />
        </div>
      );
    case 'pi':
    default:
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-dim">
          <PlugZap size={16} />
        </div>
      );
  }
}

function toolDisplayName(toolId: HarnessToolId | null, tools: HarnessToolStatus[]) {
  if (!toolId) return 'Harness';
  return tools.find((tool) => tool.id === toolId)?.name ?? toolId;
}

function webAccessFormFromStatus(status?: PiWebAccessStatus): WebAccessForm {
  return {
    provider: status?.provider || 'auto',
    workflow: status?.configExists ? status.workflow || 'summary-review' : 'none',
    searchModel: status?.searchModel ?? '',
    chromeProfile: status?.chromeProfile ?? '',
    curatorTimeoutSeconds: status?.curatorTimeoutSeconds ? String(status.curatorTimeoutSeconds) : '',
    githubCloneEnabled: status?.githubClone.enabled ?? true,
    githubCloneMaxRepoSizeMB: status?.githubClone.maxRepoSizeMB ? String(status.githubClone.maxRepoSizeMB) : '',
    githubCloneTimeoutSeconds: status?.githubClone.cloneTimeoutSeconds ? String(status.githubClone.cloneTimeoutSeconds) : '',
    githubClonePath: status?.githubClone.clonePath ?? '',
    youtubeEnabled: status?.youtube.enabled ?? true,
    youtubePreferredModel: status?.youtube.preferredModel ?? '',
    videoEnabled: status?.video.enabled ?? true,
    videoPreferredModel: status?.video.preferredModel ?? '',
    videoMaxSizeMB: status?.video.maxSizeMB ? String(status.video.maxSizeMB) : '',
  };
}

function buildWebAccessConfigInput(form: WebAccessForm, secrets: WebAccessSecretDrafts): UpdatePiWebAccessConfigInput {
  const input: UpdatePiWebAccessConfigInput = {
    provider: form.provider,
    workflow: form.workflow,
    searchModel: form.searchModel.trim(),
    chromeProfile: form.chromeProfile.trim(),
    githubClone: {
      enabled: form.githubCloneEnabled,
      maxRepoSizeMB: optionalNumber(form.githubCloneMaxRepoSizeMB),
      cloneTimeoutSeconds: optionalNumber(form.githubCloneTimeoutSeconds),
      clonePath: form.githubClonePath.trim(),
    },
    youtube: {
      enabled: form.youtubeEnabled,
      preferredModel: form.youtubePreferredModel.trim(),
    },
    video: {
      enabled: form.videoEnabled,
      preferredModel: form.videoPreferredModel.trim(),
      maxSizeMB: optionalNumber(form.videoMaxSizeMB),
    },
  };
  const timeout = optionalNumber(form.curatorTimeoutSeconds);
  if (timeout !== undefined) input.curatorTimeoutSeconds = timeout;
  if (secrets.exa.trim()) input.exaApiKey = secrets.exa.trim();
  if (secrets.perplexity.trim()) input.perplexityApiKey = secrets.perplexity.trim();
  if (secrets.gemini.trim()) input.geminiApiKey = secrets.gemini.trim();
  if (secrets.clearExa) input.clearExaApiKey = true;
  if (secrets.clearPerplexity) input.clearPerplexityApiKey = true;
  if (secrets.clearGemini) input.clearGeminiApiKey = true;
  return input;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed);
}

function firstErrorMessage(...errors: unknown[]) {
  for (const error of errors) {
    if (error instanceof Error) return error.message;
  }
  return undefined;
}

function normalizeHarnessVersion(version?: string) {
  if (!version) return undefined;
  return version.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? version;
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
