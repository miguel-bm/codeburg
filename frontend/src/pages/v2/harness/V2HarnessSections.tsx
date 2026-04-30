import type { ReactNode } from 'react';
import {
  AlertCircle,
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
import claudeLogo from '../../../assets/claude-logo.svg';
import openaiLogo from '../../../assets/openai-logo.svg';
import type {
  HarnessAuthStatus,
  HarnessToolId,
  HarnessToolStatus,
  PiConfigDocument,
} from '../../../api/types';
import { Button, V2Input, V2Select, V2Textarea } from '../v2-ui';
import { normalizeHarnessVersion, toolIsStale } from './V2HarnessHelpers';
import type { HarnessState, UpdateLogEntry, WebAccessForm, WebAccessSecretDrafts } from './useHarnessState';
import { WEB_ACCESS_PACKAGE_SOURCE } from './useHarnessState';

export function HarnessSection({
  icon,
  title,
  meta,
  actions,
  children,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-card)] md:px-5 ${className}`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="text-dim">{icon}</div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {meta && <div className="mt-1">{meta}</div>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function RuntimeToolGrid({ state }: { state: HarnessState }) {
  if (state.tools.length === 0) {
    return <HarnessToolLoadingCards />;
  }

  return (
    <>
      {state.tools.map((tool) => (
        <HarnessToolCard
          key={tool.id}
          tool={tool}
          updating={state.runningTool === tool.id}
          disabled={state.updateLocked && state.runningTool !== tool.id}
          latestChecked={Boolean(state.harnessStatus?.checkedLatest)}
          checkingLatest={state.mutations.checkLatestVersions.isPending}
          onCheckLatest={() => state.mutations.checkLatestVersions.mutate()}
          onUpdate={() => state.mutations.updateHarness.mutate(tool.id)}
        />
      ))}
    </>
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
  const stale = toolIsStale(tool);
  return (
    <article className="flex min-h-[13rem] flex-col rounded-xl bg-card p-4 shadow-[var(--shadow-card)]">
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
        <article key={tool.id} className="flex min-h-[13rem] flex-col rounded-xl bg-card p-4 shadow-[var(--shadow-card)]">
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

export function UpdateLogDialog({
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

export function AuthStatusSection({ authStatuses }: { authStatuses: HarnessAuthStatus[] }) {
  return (
    <HarnessSection
      icon={<KeyRound size={15} />}
      title="Login status"
      meta={<span className="text-xs text-dim">Harness auth and credentials available inside Pi</span>}
    >
      <div className="space-y-2">
        {authStatuses.map((status) => <AuthStatusRow key={status.id} status={status} />)}
        {authStatuses.length === 0 && <div className="py-3 text-sm text-dim">Loading auth status...</div>}
      </div>
    </HarnessSection>
  );
}

function AuthStatusRow({ status }: { status: HarnessAuthStatus }) {
  const detail = status.detail || status.providers?.join(' / ') || (status.loggedIn ? 'Configured' : 'Needs login');
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

export function PiRuntimeSection({ state }: { state: HarnessState }) {
  const piTool = state.tools.find((tool) => tool.id === 'pi');
  return (
    <HarnessSection
      icon={<PlugZap size={15} />}
      title="Pi runtime"
      meta={<span className="text-xs text-dim">{piTool?.version ?? state.piConfig?.status.version ?? 'Pi version unavailable'}</span>}
    >
      <div className="space-y-2 text-sm">
        <StatusLine label="Installed" ok={!!state.piConfig?.status.installed} value={state.piConfig?.status.installed ? 'Yes' : 'No'} />
        <StatusLine label="Auth" ok={!!state.piConfig?.status.authConfigured} value={state.piConfig?.status.authConfigured ? 'Configured' : 'Needs login'} />
        <div className="break-all py-2 font-mono text-xs text-dim">{state.piConfig?.status.agentDir ?? '~/.pi/agent'}</div>
      </div>
    </HarnessSection>
  );
}

export function WebAccessSection({ state }: { state: HarnessState }) {
  const webAccess = state.piConfig?.webAccess;
  const configValid = webAccess?.configValid ?? true;
  const ready = Boolean(webAccess?.installed && configValid && webAccess.configExists);
  const statusLabel = !webAccess?.installed ? 'Missing' : !configValid ? 'Invalid config' : webAccess.configExists ? 'Ready' : 'Configure';
  const actionError = firstErrorMessage(
    state.mutations.saveWebAccess.error,
    state.mutations.installWebAccess.error,
    state.mutations.updateWebAccess.error,
    state.mutations.removeWebAccess.error,
  );
  const updateForm = (patch: Partial<WebAccessForm>) => state.setWebAccessForm({ ...state.webAccessForm, ...patch });
  const updateSecrets = (patch: Partial<WebAccessSecretDrafts>) => state.setWebAccessSecrets({ ...state.webAccessSecrets, ...patch });

  return (
    <HarnessSection
      icon={<Globe2 size={15} />}
      title="Pi web access"
      meta={<span className="break-all text-xs text-dim">{webAccess?.configPath ?? '~/.pi/web-search.json'}</span>}
      actions={<StatusPill ok={ready} label={statusLabel} />}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {!webAccess?.installed ? (
            <Button size="sm" variant="primary" icon={<PackagePlus size={14} />} loading={state.mutations.installWebAccess.isPending} onClick={() => state.mutations.installWebAccess.mutate()}>
              Install
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} loading={state.mutations.updateWebAccess.isPending} onClick={() => state.mutations.updateWebAccess.mutate()}>
                Update
              </Button>
              <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} loading={state.mutations.removeWebAccess.isPending} onClick={() => state.mutations.removeWebAccess.mutate()}>
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

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <FormGroup title="Search">
              <div className="grid gap-3 md:grid-cols-2">
                <LabeledControl label="Provider">
                  <V2Select value={state.webAccessForm.provider} onChange={(event) => updateForm({ provider: event.target.value })} className="w-full">
                    <option value="auto">Auto</option>
                    <option value="exa">Exa</option>
                    <option value="perplexity">Perplexity</option>
                    <option value="gemini">Gemini</option>
                  </V2Select>
                </LabeledControl>
                <LabeledControl label="Curator">
                  <V2Select value={state.webAccessForm.workflow} onChange={(event) => updateForm({ workflow: event.target.value })} className="w-full">
                    <option value="none">Off for Codeburg chat</option>
                    <option value="summary-review">Summary review</option>
                  </V2Select>
                </LabeledControl>
                <LabeledControl label="Search model">
                  <V2Input value={state.webAccessForm.searchModel} onChange={(event) => updateForm({ searchModel: event.target.value })} placeholder="gemini-2.5-flash" className="w-full" />
                </LabeledControl>
                <LabeledControl label="Curator timeout">
                  <V2Input value={state.webAccessForm.curatorTimeoutSeconds} onChange={(event) => updateForm({ curatorTimeoutSeconds: event.target.value })} inputMode="numeric" placeholder="20" className="w-full" />
                </LabeledControl>
                <LabeledControl label="Chrome profile">
                  <V2Input value={state.webAccessForm.chromeProfile} onChange={(event) => updateForm({ chromeProfile: event.target.value })} placeholder="Profile 2" className="w-full" />
                </LabeledControl>
              </div>
            </FormGroup>

            <FormGroup title="Repository and media tools">
              <div className="space-y-2">
                <CheckboxRow
                  label="GitHub cloning"
                  detail="Use local clones for repository URLs."
                  checked={state.webAccessForm.githubCloneEnabled}
                  onChange={(githubCloneEnabled) => updateForm({ githubCloneEnabled })}
                />
                <div className="grid gap-2 md:grid-cols-3">
                  <V2Input value={state.webAccessForm.githubCloneMaxRepoSizeMB} onChange={(event) => updateForm({ githubCloneMaxRepoSizeMB: event.target.value })} inputMode="numeric" placeholder="350 MB" />
                  <V2Input value={state.webAccessForm.githubCloneTimeoutSeconds} onChange={(event) => updateForm({ githubCloneTimeoutSeconds: event.target.value })} inputMode="numeric" placeholder="30 sec" />
                  <V2Input value={state.webAccessForm.githubClonePath} onChange={(event) => updateForm({ githubClonePath: event.target.value })} placeholder="/tmp/pi-github-repos" />
                </div>
                <CheckboxRow
                  label="YouTube understanding"
                  detail="Allow video URL analysis through the extension."
                  checked={state.webAccessForm.youtubeEnabled}
                  onChange={(youtubeEnabled) => updateForm({ youtubeEnabled })}
                />
                <V2Input value={state.webAccessForm.youtubePreferredModel} onChange={(event) => updateForm({ youtubePreferredModel: event.target.value })} placeholder="YouTube model" />
                <CheckboxRow
                  label="Local video analysis"
                  detail="Allow local video files to be sent to the configured provider."
                  checked={state.webAccessForm.videoEnabled}
                  onChange={(videoEnabled) => updateForm({ videoEnabled })}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <V2Input value={state.webAccessForm.videoPreferredModel} onChange={(event) => updateForm({ videoPreferredModel: event.target.value })} placeholder="Video model" />
                  <V2Input value={state.webAccessForm.videoMaxSizeMB} onChange={(event) => updateForm({ videoMaxSizeMB: event.target.value })} inputMode="numeric" placeholder="50 MB" />
                </div>
              </div>
            </FormGroup>
          </div>

          <FormGroup title="API keys">
            <div className="space-y-2">
              <CredentialRow
                label="Exa"
                credential={webAccess?.credentials.exa}
                value={state.webAccessSecrets.exa}
                clear={state.webAccessSecrets.clearExa}
                onValueChange={(value) => updateSecrets({ exa: value })}
                onClearChange={(clearExa) => updateSecrets({ clearExa })}
              />
              <CredentialRow
                label="Perplexity"
                credential={webAccess?.credentials.perplexity}
                value={state.webAccessSecrets.perplexity}
                clear={state.webAccessSecrets.clearPerplexity}
                onValueChange={(value) => updateSecrets({ perplexity: value })}
                onClearChange={(clearPerplexity) => updateSecrets({ clearPerplexity })}
              />
              <CredentialRow
                label="Gemini"
                credential={webAccess?.credentials.gemini}
                value={state.webAccessSecrets.gemini}
                clear={state.webAccessSecrets.clearGemini}
                onValueChange={(value) => updateSecrets({ gemini: value })}
                onClearChange={(clearGemini) => updateSecrets({ clearGemini })}
              />
            </div>
          </FormGroup>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-card-border)] pt-4">
          <div className="text-xs text-dim">{webAccess?.configExists ? 'Existing config' : 'Will create config on save'}</div>
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={state.mutations.saveWebAccess.isPending} onClick={() => state.mutations.saveWebAccess.mutate()}>
            Save web access
          </Button>
        </div>
        {actionError && <div className="text-xs text-[var(--color-error)]">{actionError}</div>}
      </div>
    </HarnessSection>
  );
}

function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-primary px-3 py-3">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">{title}</div>
      {children}
    </div>
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
    <div className="rounded-lg bg-[var(--color-card)] px-3 py-2">
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
    <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[var(--color-card)] px-3 py-2">
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

export function ConfigEditorSection({
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
    <HarnessSection
      icon={<Wrench size={15} />}
      title={title}
      meta={<span className="break-all text-xs text-dim">{subtitle}</span>}
      actions={
        <div className="flex items-center gap-2">
          <StatusPill ok={document?.valid ?? true} label={(document?.valid ?? true) ? 'Valid JSON' : 'Invalid JSON'} />
          <Button size="xs" variant="primary" icon={<Save size={13} />} loading={pending} disabled={!draft.trim()} onClick={onSave}>Save</Button>
        </div>
      }
    >
      {document?.parseError && <div className="mb-3 text-xs text-[var(--color-warning)]">{document.parseError}</div>}
      <V2Textarea value={draft} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="min-h-[22rem] w-full font-mono text-[13px] leading-6" />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-dim">
        <span>{document?.exists ? 'Existing file' : 'Will be created on save'}</span>
        {error instanceof Error && <span className="text-[var(--color-error)]">{error.message}</span>}
      </div>
    </HarnessSection>
  );
}

export function ResourceManager({
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
    <HarnessSection
      icon={<PackagePlus size={15} />}
      title={title}
      meta={<span className="text-xs text-dim">{description}</span>}
      actions={onRefresh && <Button size="xs" variant="secondary" icon={<RefreshCcw size={13} />} loading={refreshPending} onClick={onRefresh}>Update</Button>}
    >
      <div className="flex gap-2">
        <V2Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1" />
        <Button size="sm" variant="primary" icon={submitIcon} loading={submitPending} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
      <div className="mt-4 space-y-0.5">
        {items.map((item) => (
          <div key={item.key} className="grid gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs">{item.title}</div>
              <div className="mt-1 text-xs text-dim">{item.detail}</div>
            </div>
            <button type="button" disabled={item.removePending} onClick={item.onRemove} className="justify-self-start rounded-md p-1 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:opacity-50 sm:justify-self-end" aria-label={`Remove ${item.title}`}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="py-3 text-sm text-dim">None configured.</div>}
      </div>
    </HarnessSection>
  );
}

export function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
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

export function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1">
      <span className="text-dim">{label}</span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${ok ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'}`}>
      {ok ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
      {label}
    </span>
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

function firstErrorMessage(...errors: unknown[]) {
  for (const error of errors) {
    if (error instanceof Error) return error.message;
  }
  return undefined;
}
