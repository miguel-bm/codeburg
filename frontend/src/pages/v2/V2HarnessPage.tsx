import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import {
  Bot,
  Braces,
  ChevronRight,
  Globe2,
  KeyRound,
  PackagePlus,
  PlugZap,
  RefreshCcw,
  Settings2,
} from 'lucide-react';
import { Button, V2Screen } from './v2-ui';
import {
  AuthStatusSection,
  ConfigEditorSection,
  HarnessSection,
  InfoLine,
  PiRuntimeSection,
  ResourceManager,
  RuntimeToolGrid,
  StatusLine,
  StatusPill,
  UpdateLogDialog,
  WebAccessSection,
} from './harness/V2HarnessSections';
import {
  describePiPackage,
  toolDisplayName,
  toolIsStale,
} from './harness/V2HarnessHelpers';
import { useHarnessState } from './harness/useHarnessState';
import type { HarnessState } from './harness/useHarnessState';

type HarnessRoute = {
  to: string;
  end?: boolean;
  label: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
};

const HARNESS_ROUTES: HarnessRoute[] = [
  {
    to: '/harness',
    end: true,
    label: 'Overview',
    title: 'Harness',
    subtitle: 'Global agent runtimes, login state, Pi web access, packages, and advanced config.',
    icon: <PlugZap size={14} />,
  },
  {
    to: '/harness/runtimes',
    label: 'Runtimes',
    title: 'Harness runtimes',
    subtitle: 'Update and inspect the global tools used by Codeburg conversations and terminals.',
    icon: <Bot size={14} />,
  },
  {
    to: '/harness/pi',
    label: 'Pi',
    title: 'Pi and web access',
    subtitle: 'Manage Pi runtime status, auth, web search, credentials, and media helpers.',
    icon: <Globe2 size={14} />,
  },
  {
    to: '/harness/packages',
    label: 'Packages',
    title: 'Packages and extensions',
    subtitle: 'Install global Pi packages and extension paths available across projects.',
    icon: <PackagePlus size={14} />,
  },
  {
    to: '/harness/config',
    label: 'Config',
    title: 'Advanced config',
    subtitle: 'Edit raw Pi global settings and the model registry.',
    icon: <Braces size={14} />,
  },
];

export function V2HarnessShell() {
  const state = useHarnessState();
  const location = useLocation();
  const currentRoute = currentHarnessRoute(location.pathname);

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-dim">Harness</div>
            <h1 className="mt-1 truncate text-lg font-semibold">{currentRoute.title}</h1>
            <div className="mt-1 max-w-3xl text-xs leading-5 text-dim">{currentRoute.subtitle}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {state.harnessStatus?.update?.running && (
              <StatusPill ok={false} label={`Updating ${state.harnessStatus.update.tool ?? 'tool'}`} />
            )}
          </div>
        </div>
      </header>

      <div className="shrink-0 border-y border-[var(--color-card-border)] bg-canvas px-4 md:px-6">
        <nav className="scrollbar-none flex gap-1 overflow-x-auto py-2" aria-label="Harness sections">
          {HARNESS_ROUTES.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--color-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-card)]'
                  : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-5 md:px-6">
        <Outlet context={state} />
      </main>

      <UpdateLogDialog
        open={state.updateDialogVisible}
        toolName={toolDisplayName(state.dialogTool, state.tools)}
        running={state.updateLocked}
        entries={state.updateLog}
        error={state.mutations.updateHarness.error instanceof Error ? state.mutations.updateHarness.error.message : undefined}
        onClose={() => state.setUpdateDialogOpen(false)}
      />
    </V2Screen>
  );
}

export function V2HarnessOverviewPage() {
  const state = useHarnessContext();
  const runtimeIssues = state.tools.filter((tool) => !tool.installed || toolIsStale(tool)).length;
  const authReady = state.authStatuses.filter((status) => status.loggedIn).length;
  const packageCount = state.piConfig?.globalPackages?.length ?? 0;
  const extensionCount = state.piConfig?.globalExtensions?.length ?? 0;
  const webAccess = state.piConfig?.webAccess;
  const webAccessReady = Boolean(webAccess?.installed && (webAccess.configValid ?? true) && webAccess.configExists);
  const packageSummary = state.piConfig ? `${packageCount} packages` : 'Loading';
  const webAccessSummary = !state.piConfig ? 'Loading' : webAccessReady ? 'Ready' : webAccess?.installed ? 'Configure' : 'Missing';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewLinkCard
          to="/harness/runtimes"
          icon={<Bot size={16} />}
          title="Runtimes"
          value={state.tools.length > 0 ? `${state.tools.length - runtimeIssues}/${state.tools.length} ready` : 'Checking'}
          detail="Pi, Codex, and Claude toolchain status"
          ok={runtimeIssues === 0 && state.tools.length > 0}
        />
        <OverviewLinkCard
          to="/harness/pi"
          icon={<Globe2 size={16} />}
          title="Pi web access"
          value={webAccessSummary}
          detail={webAccess?.configPath ?? '~/.pi/web-search.json'}
          ok={Boolean(state.piConfig && webAccessReady)}
        />
        <OverviewLinkCard
          to="/harness/packages"
          icon={<PackagePlus size={16} />}
          title="Packages"
          value={packageSummary}
          detail={state.piConfig ? `${extensionCount} global extension paths` : 'Waiting for Pi config'}
          ok={Boolean(state.piConfig)}
        />
        <OverviewLinkCard
          to="/harness/config"
          icon={<Braces size={16} />}
          title="Advanced config"
          value={configSummary(state)}
          detail="Global settings and model registry"
          ok={Boolean(state.piConfig && (state.piConfig.globalSettings.valid ?? true) && (state.piConfig.models.valid ?? true))}
        />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <HarnessSection
          icon={<Bot size={15} />}
          title="Runtime health"
          meta={<span className="text-xs text-dim">A quick scan of the tools Codeburg launches for agents.</span>}
          actions={<Link to="/harness/runtimes"><Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />}>Manage</Button></Link>}
        >
          <div className="space-y-0.5">
            {state.tools.length === 0 ? (
              <div className="py-3 text-sm text-dim">Loading runtime status...</div>
            ) : state.tools.map((tool) => (
              <Link key={tool.id} to="/harness/runtimes" className="grid gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{tool.name}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-dim">
                    <span className="truncate font-mono">{tool.packageName}</span>
                    <span className="truncate font-mono">{tool.version ?? 'version unavailable'}</span>
                  </div>
                </div>
                <StatusPill ok={tool.installed && !toolIsStale(tool)} label={!tool.installed ? 'Missing' : toolIsStale(tool) ? 'Update' : 'Ready'} />
              </Link>
            ))}
          </div>
        </HarnessSection>

        <aside className="space-y-8">
          <PiRuntimeSection state={state} />
          <HarnessSection
            icon={<KeyRound size={15} />}
            title="Credentials"
            meta={<span className="text-xs text-dim">{authReady}/{state.authStatuses.length || 0} logged in</span>}
            actions={<Link to="/harness/pi"><Button size="xs" variant="secondary">Manage</Button></Link>}
          >
            <div className="space-y-2 text-sm">
              {state.authStatuses.length === 0 ? (
                <div className="py-3 text-sm text-dim">Loading auth status...</div>
              ) : state.authStatuses.map((status) => (
                <StatusLine key={status.id} label={status.name} ok={status.loggedIn} value={status.loggedIn ? 'Ready' : 'Needs login'} />
              ))}
            </div>
          </HarnessSection>
        </aside>
      </div>
    </div>
  );
}

export function V2HarnessRuntimesPage() {
  const state = useHarnessContext();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-dim">
          {state.harnessStatus?.checkedLatest ? 'Latest versions checked' : 'Latest versions are checked only when requested.'}
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} loading={state.mutations.checkLatestVersions.isPending} onClick={() => state.mutations.checkLatestVersions.mutate()}>
          Check latest
        </Button>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <RuntimeToolGrid state={state} />
      </div>
    </div>
  );
}

export function V2HarnessPiPage() {
  const state = useHarnessContext();
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <WebAccessSection state={state} />
      <aside className="space-y-8">
        <PiRuntimeSection state={state} />
        <AuthStatusSection authStatuses={state.authStatuses} />
      </aside>
    </div>
  );
}

export function V2HarnessPackagesPage() {
  const state = useHarnessContext();
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-2">
      <ResourceManager
        title="Global Pi packages"
        description="Installed for every project that uses Pi."
        value={state.packageSource}
        placeholder="npm:@scope/pkg or ./relative/path"
        onChange={state.setPackageSource}
        onSubmit={() => state.mutations.installGlobalPackage.mutate(state.deferredPackageSource)}
        submitDisabled={!state.deferredPackageSource}
        submitPending={state.mutations.installGlobalPackage.isPending}
        submitIcon={<PackagePlus size={14} />}
        submitLabel="Install"
        onRefresh={() => state.mutations.updateGlobalPackages.mutate()}
        refreshPending={state.mutations.updateGlobalPackages.isPending}
        items={(state.piConfig?.globalPackages ?? []).map((pkg) => ({
          key: pkg.source,
          title: pkg.source,
          detail: describePiPackage(pkg),
          onRemove: () => state.mutations.removeGlobalPackage.mutate(pkg.source),
          removePending: state.mutations.removeGlobalPackage.isPending,
        }))}
      />

      <ResourceManager
        title="Global Pi extensions"
        description="Extension paths available to Pi across projects."
        value={state.extensionPath}
        placeholder=".pi/extensions/my-extension.ts"
        onChange={state.setExtensionPath}
        onSubmit={() => state.mutations.addGlobalExtension.mutate(state.deferredExtensionPath)}
        submitDisabled={!state.deferredExtensionPath}
        submitPending={state.mutations.addGlobalExtension.isPending}
        submitIcon={<PlugZap size={14} />}
        submitLabel="Add"
        items={(state.piConfig?.globalExtensions ?? []).map((extension) => ({
          key: extension.path,
          title: extension.path,
          detail: 'Global extension path',
          onRemove: () => state.mutations.removeGlobalExtension.mutate(extension.path),
          removePending: state.mutations.removeGlobalExtension.isPending,
        }))}
      />
    </div>
  );
}

export function V2HarnessConfigPage() {
  const state = useHarnessContext();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <HarnessSection
        icon={<Settings2 size={15} />}
        title="Advanced surface"
        meta={<span className="text-xs text-dim">Raw JSON editors live here so routine harness work stays calm.</span>}
      >
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <InfoLine label="Settings file" value={state.piConfig?.globalSettings.path ?? '~/.pi/agent/settings.json'} mono />
          <InfoLine label="Model registry" value={state.piConfig?.models.path ?? '~/.pi/agent/models.json'} mono />
        </div>
      </HarnessSection>

      <ConfigEditorSection
        title="Global Pi settings"
        subtitle={state.piConfig?.globalSettings.path ?? '~/.pi/agent/settings.json'}
        document={state.piConfig?.globalSettings}
        draft={state.globalSettingsDraft}
        onChange={state.setGlobalSettingsDraft}
        onSave={() => state.mutations.saveGlobalSettings.mutate()}
        pending={state.mutations.saveGlobalSettings.isPending}
        error={state.mutations.saveGlobalSettings.error}
      />

      <ConfigEditorSection
        title="Pi model registry"
        subtitle={state.piConfig?.models.path ?? '~/.pi/agent/models.json'}
        document={state.piConfig?.models}
        draft={state.modelsDraft}
        onChange={state.setModelsDraft}
        onSave={() => state.mutations.saveModels.mutate()}
        pending={state.mutations.saveModels.isPending}
        error={state.mutations.saveModels.error}
      />
    </div>
  );
}

function OverviewLinkCard({
  to,
  icon,
  title,
  value,
  detail,
  ok,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <Link to={to} className="group rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-dim">{icon}</div>
        <ChevronRight size={14} className="text-dim transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-4 text-sm font-semibold">{title}</div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <StatusPill ok={ok} label={value} />
      </div>
      <div className="mt-2 truncate text-xs text-dim">{detail}</div>
    </Link>
  );
}

function currentHarnessRoute(pathname: string) {
  return HARNESS_ROUTES.find((route) => route.end ? pathname === route.to : pathname.startsWith(route.to)) ?? HARNESS_ROUTES[0];
}

function useHarnessContext() {
  return useOutletContext<HarnessState>();
}

function configSummary(state: HarnessState) {
  const settingsValid = state.piConfig?.globalSettings.valid ?? true;
  const modelsValid = state.piConfig?.models.valid ?? true;
  if (!settingsValid || !modelsValid) return 'Invalid JSON';
  if (!state.piConfig) return 'Loading';
  return 'Valid JSON';
}
