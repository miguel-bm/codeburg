import type { ReactNode } from 'react';
import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleSlash, Loader2, PackagePlus, PlayCircle, PlugZap, RefreshCcw, Save, Settings2, Trash2, Wrench } from 'lucide-react';
import { projectsApi } from '../../api';
import type { PiConfigDocument, PiPackageEntry, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';

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

  const saveGlobalSettings = useMutation({
    mutationFn: () => v2Api.updatePiSettings(globalSettingsDraft),
    onSuccess: refreshPiConfig,
  });

  const saveModels = useMutation({
    mutationFn: () => v2Api.updatePiModels(modelsDraft),
    onSuccess: refreshPiConfig,
  });

  const saveProjectSettings = useMutation({
    mutationFn: () => v2Api.updateProjectPiSettings(id!, projectSettingsDraft),
    onSuccess: refreshPiConfig,
  });

  const installProjectPackage = useMutation({
    mutationFn: (source: string) => v2Api.installProjectPiPackage(id!, source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshPiConfig();
    },
  });

  const removeProjectPackage = useMutation({
    mutationFn: (source: string) => v2Api.removeProjectPiPackage(id!, source),
    onSuccess: refreshPiConfig,
  });

  const updateProjectPackages = useMutation({
    mutationFn: () => v2Api.updateProjectPiPackages(id!),
    onSuccess: refreshPiConfig,
  });

  const addProjectExtension = useMutation({
    mutationFn: (path: string) => v2Api.addProjectPiExtension(id!, path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshPiConfig();
    },
  });

  const removeProjectExtension = useMutation({
    mutationFn: (path: string) => v2Api.removeProjectPiExtension(id!, path),
    onSuccess: refreshPiConfig,
  });

  const mainWorkspace = workspaces?.find((workspace) => workspace.kind === 'main') ?? workspaces?.[0];

  const openLoginTerminal = useMutation({
    mutationFn: async () => {
      if (!mainWorkspace) {
        throw new Error('No workspace available for pi login.');
      }
      return v2Api.createTerminal(mainWorkspace.id, {
        title: 'Pi login',
        providerHint: 'pi',
        initialCommand: 'pi',
      });
    },
    onSuccess: (terminal) => {
      if (!project || !mainWorkspace) return;
      navigate(`/v2/projects/${project.id}?workspace=${mainWorkspace.id}&terminal=${terminal.id}`);
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={project ? `/v2/projects/${project.id}` : '/v2'}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ArrowLeft size={15} />
            Back to project
          </Link>
          <div className="mt-4 text-[11px] uppercase tracking-[0.28em] text-neutral-500">Pi settings</div>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.05em] text-neutral-950">
            {project?.name ?? 'Project'}
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-7 text-neutral-600">
            Edit pi’s real config files directly from Codeburg. Authentication still remains provider-native and terminal-first.
          </p>
        </div>

        {project && (
          <Link
            to={`/v2/projects/${project.id}/conversations`}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/85 px-4 py-2.5 text-sm font-medium text-neutral-900 shadow-[0_12px_24px_rgba(31,24,16,0.06)]"
          >
            <Wrench size={16} />
            Conversations
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/75 bg-white/60 shadow-[0_30px_60px_rgba(30,20,8,0.08)] backdrop-blur-xl">
        <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1.2fr)_23rem]">
          <section className="min-h-0 overflow-auto border-b border-black/6 px-6 py-6 lg:border-b-0 lg:border-r">
            <div className="space-y-6">
              <ConfigEditorCard
                title="Global settings"
                subtitle={piConfig?.globalSettings.path ?? '~/.pi/agent/settings.json'}
                document={piConfig?.globalSettings}
                draft={globalSettingsDraft}
                onChange={setGlobalSettingsDraft}
                onSave={() => saveGlobalSettings.mutate()}
                pending={saveGlobalSettings.isPending}
                error={saveGlobalSettings.error}
                placeholder={`{\n  "defaultProvider": "openai",\n  "defaultModel": "gpt-5.4",\n  "defaultThinkingLevel": "medium"\n}`}
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
                placeholder={`{\n  "providers": {\n    "local": {\n      "baseUrl": "http://localhost:11434/v1",\n      "api": "openai-completions",\n      "apiKey": "ollama",\n      "models": [{ "id": "llama3.1:8b" }]\n    }\n  }\n}`}
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
                placeholder={`{\n  "defaultModel": "gpt-5.4",\n  "theme": "light"\n}`}
              />

              <details className="rounded-[1.5rem] border border-white/75 bg-white/78 px-5 py-5 shadow-[0_14px_32px_rgba(30,20,8,0.05)]">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-medium tracking-[-0.03em] text-neutral-950">Advanced pi</div>
                      <div className="mt-1 text-sm text-neutral-500">
                        Package and extension management stays available, but it is intentionally a lower-level operator surface.
                      </div>
                    </div>
                    <div className="rounded-full border border-black/8 bg-[#f7f4ee] px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-neutral-500">
                      Expand
                    </div>
                  </div>
                </summary>

                <div className="mt-5 space-y-6">
                  <ResourceManagerCard
                    title="Project packages"
                    subtitle="pi install -l / pi remove -l / pi update -l"
                    inputLabel="Package source"
                    inputValue={packageSource}
                    onInputChange={setPackageSource}
                    inputPlaceholder="npm:@scope/pkg · git:github.com/user/repo · ./relative/path"
                    submitLabel="Install package"
                    submitIcon={<PackagePlus size={15} />}
                    submitPending={installProjectPackage.isPending}
                    submitDisabled={!deferredPackageSource}
                    onSubmit={() => installProjectPackage.mutate(deferredPackageSource)}
                    refreshLabel="Update packages"
                    refreshPending={updateProjectPackages.isPending}
                    onRefresh={() => updateProjectPackages.mutate()}
                    items={(piConfig?.projectPackages ?? []).map((pkg) => ({
                      key: `pkg-${pkg.scope}-${pkg.source}`,
                      title: pkg.source,
                      detail: describePiPackage(pkg),
                      dangerLabel: 'Remove',
                      onDanger: () => removeProjectPackage.mutate(pkg.source),
                      dangerPending: removeProjectPackage.isPending,
                    }))}
                    emptyState="No project packages configured yet."
                    error={installProjectPackage.error ?? removeProjectPackage.error ?? updateProjectPackages.error}
                  />

                  <ResourceManagerCard
                    title="Project extensions"
                    subtitle="Direct extension paths from .pi/settings.json"
                    inputLabel="Extension path"
                    inputValue={extensionPath}
                    onInputChange={setExtensionPath}
                    inputPlaceholder=".pi/extensions/my-extension.ts"
                    submitLabel="Add extension"
                    submitIcon={<PlugZap size={15} />}
                    submitPending={addProjectExtension.isPending}
                    submitDisabled={!deferredExtensionPath}
                    onSubmit={() => addProjectExtension.mutate(deferredExtensionPath)}
                    items={(piConfig?.projectExtensions ?? []).map((extension) => ({
                      key: `ext-${extension.scope}-${extension.path}`,
                      title: extension.path,
                      detail: 'Project-local extension path',
                      dangerLabel: 'Remove',
                      onDanger: () => removeProjectExtension.mutate(extension.path),
                      dangerPending: removeProjectExtension.isPending,
                    }))}
                    emptyState="No direct extension paths configured yet."
                    error={addProjectExtension.error ?? removeProjectExtension.error}
                  />
                </div>
              </details>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,246,240,0.92),rgba(241,238,231,0.96))]">
            <div className="border-b border-black/6 px-5 py-5">
              <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Pi readiness</div>
              <div className="mt-3 text-lg font-medium tracking-[-0.03em] text-neutral-950">Operator guide</div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              <div className="space-y-5">
                <PiStatusCard installed={!!piConfig?.status.installed} version={piConfig?.status.version} />
                <PiAuthCard
                  authConfigured={!!piConfig?.status.authConfigured}
                  mainWorkspace={mainWorkspace}
                  authProviders={piConfig?.status.authProviders?.map((provider) => `${provider.provider} · ${provider.type}`) ?? []}
                  onOpenLoginTerminal={() => openLoginTerminal.mutate()}
                  loginPending={openLoginTerminal.isPending}
                  loginError={openLoginTerminal.error}
                />
                <ResourceListCard
                  title="Global packages"
                  emptyState="No global packages configured."
                  items={(piConfig?.globalPackages ?? []).map((pkg) => ({
                    key: `global-pkg-${pkg.source}`,
                    title: pkg.source,
                    detail: describePiPackage(pkg),
                  }))}
                />
                <ResourceListCard
                  title="Global extensions"
                  emptyState="No global extension paths configured."
                  items={(piConfig?.globalExtensions ?? []).map((extension) => ({
                    key: `global-ext-${extension.path}`,
                    title: extension.path,
                    detail: 'Global extension path',
                  }))}
                />
                <div className="rounded-[1.5rem] border border-white/75 bg-neutral-950 px-4 py-4 text-white shadow-[0_18px_34px_rgba(15,15,15,0.18)]">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Settings2 size={15} />
                    Terminal-first login
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/70">
                    Codeburg edits pi’s JSON config, but provider login still belongs to pi itself. Open a login terminal to launch pi in the project’s main workspace, then run <span className="font-mono">/login</span> and <span className="font-mono">/model</span>.
                  </p>
                  <button
                    type="button"
                    onClick={() => openLoginTerminal.mutate()}
                    disabled={!mainWorkspace || openLoginTerminal.isPending}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
                  >
                    {openLoginTerminal.isPending ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
                    Open login terminal
                  </button>
                  <div className="mt-4 space-y-2 rounded-2xl bg-white/6 px-4 py-4 font-mono text-xs leading-6 text-white/80">
                    <div>pi</div>
                    <div>/login</div>
                    <div>/model</div>
                  </div>
                  {openLoginTerminal.error instanceof Error && (
                    <div className="mt-3 text-sm text-red-300">{openLoginTerminal.error.message}</div>
                  )}
                </div>

                {piConfig?.status.loadWarnings && piConfig.status.loadWarnings.length > 0 && (
                  <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    <div className="font-medium">Warnings</div>
                    <ul className="mt-2 space-y-2">
                      {piConfig.status.loadWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function describePiPackage(pkg: PiPackageEntry) {
  const traits = [pkg.scope, pkg.sourceType];
  if (pkg.pinned) traits.push('pinned');
  if (pkg.filtered) {
    const filters = [
      pkg.extensionCount ? `${pkg.extensionCount} ext` : null,
      pkg.skillCount ? `${pkg.skillCount} skill` : null,
      pkg.promptCount ? `${pkg.promptCount} prompt` : null,
      pkg.themeCount ? `${pkg.themeCount} theme` : null,
    ].filter(Boolean);
    if (filters.length > 0) {
      traits.push(`filtered: ${filters.join(', ')}`);
    } else {
      traits.push('filtered');
    }
  }
  return traits.join(' · ');
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
  placeholder,
}: {
  title: string;
  subtitle: string;
  document?: PiConfigDocument;
  draft: string;
  onChange: (value: string) => void;
  onSave: () => void;
  pending: boolean;
  error: unknown;
  placeholder: string;
}) {
  const hasMeaningfulDraft = draft.trim().length > 0;

  return (
    <article className="rounded-[1.5rem] border border-white/75 bg-white/78 px-5 py-5 shadow-[0_14px_32px_rgba(30,20,8,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-medium tracking-[-0.03em] text-neutral-950">{title}</div>
          <div className="mt-1 break-all text-sm text-neutral-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
              document?.valid ?? true ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {(document?.valid ?? true) ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
            {(document?.valid ?? true) ? 'Valid JSON' : 'Needs attention'}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !hasMeaningfulDraft}
            className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
        </div>
      </div>

      {document?.parseError && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {document.parseError}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="mt-4 min-h-[17rem] w-full rounded-[1.4rem] border border-black/8 bg-[#faf8f4] px-4 py-4 font-mono text-[13px] leading-6 text-neutral-900 outline-none transition focus:border-black/15"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
        <span>{document?.exists ? 'Existing file' : 'New file will be created on save'}</span>
        {error instanceof Error && <span className="text-red-600">{error.message}</span>}
      </div>
    </article>
  );
}

function ResourceManagerCard({
  title,
  subtitle,
  inputLabel,
  inputValue,
  onInputChange,
  inputPlaceholder,
  submitLabel,
  submitIcon,
  submitPending,
  submitDisabled,
  onSubmit,
  refreshLabel,
  refreshPending,
  onRefresh,
  items,
  emptyState,
  error,
}: {
  title: string;
  subtitle: string;
  inputLabel: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  inputPlaceholder: string;
  submitLabel: string;
  submitIcon: ReactNode;
  submitPending: boolean;
  submitDisabled: boolean;
  onSubmit: () => void;
  refreshLabel?: string;
  refreshPending?: boolean;
  onRefresh?: () => void;
  items: Array<{
    key: string;
    title: string;
    detail: string;
    dangerLabel?: string;
    onDanger?: () => void;
    dangerPending?: boolean;
  }>;
  emptyState: string;
  error: unknown;
}) {
  return (
    <article className="rounded-[1.5rem] border border-white/75 bg-white/78 px-5 py-5 shadow-[0_14px_32px_rgba(30,20,8,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-medium tracking-[-0.03em] text-neutral-950">{title}</div>
          <div className="mt-1 text-sm text-neutral-500">{subtitle}</div>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshPending}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-neutral-800 disabled:opacity-50"
          >
            {refreshPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
            {refreshLabel}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[18rem] flex-1">
          <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">{inputLabel}</div>
          <input
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={inputPlaceholder}
            className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-black/15"
          />
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitPending || submitDisabled}
          className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitPending ? <Loader2 size={15} className="animate-spin" /> : submitIcon}
          {submitLabel}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-500">{emptyState}</div>
        ) : (
          items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f7f4ee] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] text-neutral-900">{item.title}</div>
                <div className="mt-1 text-sm text-neutral-500">{item.detail}</div>
              </div>
              {item.onDanger && item.dangerLabel && (
                <button
                  type="button"
                  onClick={item.onDanger}
                  disabled={item.dangerPending}
                  className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {item.dangerLabel}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {error instanceof Error && <div className="mt-3 text-sm text-red-600">{error.message}</div>}
    </article>
  );
}

function ResourceListCard({
  title,
  items,
  emptyState,
}: {
  title: string;
  items: Array<{ key: string; title: string; detail: string }>;
  emptyState: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
      <div className="text-sm font-medium text-neutral-950">{title}</div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-500">{emptyState}</div>
        ) : (
          items.map((item) => (
            <div key={item.key} className="rounded-2xl bg-[#f7f4ee] px-4 py-3">
              <div className="break-all font-mono text-[13px] text-neutral-900">{item.title}</div>
              <div className="mt-1 text-sm text-neutral-500">{item.detail}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PiStatusCard({
  installed,
  version,
}: {
  installed: boolean;
  version?: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-neutral-950">Installation</div>
          <div className="mt-1 text-sm text-neutral-500">pi availability for the runtime user</div>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            installed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {installed ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
          {installed ? 'Installed' : 'Missing'}
        </span>
      </div>
      <div className="mt-4 rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-600">
        <div className="font-medium text-neutral-900">{version ?? 'pi not found in PATH'}</div>
      </div>
    </div>
  );
}

function PiAuthCard({
  authConfigured,
  mainWorkspace,
  authProviders,
  onOpenLoginTerminal,
  loginPending,
  loginError,
}: {
  authConfigured: boolean;
  mainWorkspace?: Workspace;
  authProviders: string[];
  onOpenLoginTerminal: () => void;
  loginPending: boolean;
  loginError: unknown;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-neutral-950">Authentication</div>
          <div className="mt-1 text-sm text-neutral-500">Provider-native credentials from pi</div>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            authConfigured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {authConfigured ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
          {authConfigured ? 'Configured' : 'Needs login'}
        </span>
      </div>

      {authProviders.length > 0 ? (
        <div className="mt-4 space-y-2">
          {authProviders.map((provider) => (
            <div key={provider} className="rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-700">
              {provider}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-3 rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm leading-6 text-neutral-600">
          <div>
            Open a workspace terminal{mainWorkspace ? ` in ${mainWorkspace.name}` : ''}, run <span className="font-mono">pi</span>,
            then use <span className="font-mono">/login</span> and <span className="font-mono">/model</span>.
          </div>
          <button
            type="button"
            onClick={onOpenLoginTerminal}
            disabled={!mainWorkspace || loginPending}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            {loginPending ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
            Open login terminal
          </button>
          {loginError instanceof Error && <div className="text-sm text-red-600">{loginError.message}</div>}
        </div>
      )}
    </div>
  );
}
