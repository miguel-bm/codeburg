import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Code2,
  PackagePlus,
  PlugZap,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { PiConfigDocument, PiPackageEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';

type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type PiDeliveryMode = 'all' | 'one-at-a-time';

interface PiSettingsShape {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: PiThinkingLevel;
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };
  retry?: {
    enabled?: boolean;
    maxRetries?: number;
  };
  steeringMode?: PiDeliveryMode;
  followUpMode?: PiDeliveryMode;
  shellCommandPrefix?: string;
  [key: string]: unknown;
}

export function V2ProjectPiPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [settingsDraft, setSettingsDraft] = useState('{\n}\n');
  const [rawOpen, setRawOpen] = useState(false);
  const [packageSource, setPackageSource] = useState('');
  const [extensionPath, setExtensionPath] = useState('');
  const deferredPackageSource = useDeferredValue(packageSource.trim());
  const deferredExtensionPath = useDeferredValue(extensionPath.trim());

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: piConfig } = useQuery({
    queryKey: ['v2-project-pi-config', id],
    queryFn: () => v2Api.getProjectPiConfig(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (!piConfig?.projectSettings) return;
    setSettingsDraft(piConfig.projectSettings.content.trim() ? piConfig.projectSettings.content : '{\n}\n');
  }, [piConfig?.projectSettings]);

  const parsed = useMemo(() => parsePiSettingsDraft(settingsDraft), [settingsDraft]);
  const settings = parsed.ok ? parsed.value : {};
  const settingsDirty = (piConfig?.projectSettings?.content.trim() || '{}') !== settingsDraft.trim();

  const refreshProjectPiConfig = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-project-pi-config', id] }),
      queryClient.invalidateQueries({ queryKey: ['v2-pi-config'] }),
      queryClient.invalidateQueries({ queryKey: ['pi-status'] }),
    ]);
  };

  const saveSettings = useMutation({
    mutationFn: () => v2Api.updateProjectPiSettings(id!, settingsDraft),
    onSuccess: refreshProjectPiConfig,
  });

  const installPackage = useMutation({
    mutationFn: (source: string) => v2Api.installProjectPiPackage(id!, source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshProjectPiConfig();
    },
  });

  const removePackage = useMutation({
    mutationFn: (source: string) => v2Api.removeProjectPiPackage(id!, source),
    onSuccess: refreshProjectPiConfig,
  });

  const updatePackages = useMutation({
    mutationFn: () => v2Api.updateProjectPiPackages(id!),
    onSuccess: refreshProjectPiConfig,
  });

  const addExtension = useMutation({
    mutationFn: (path: string) => v2Api.addProjectPiExtension(id!, path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshProjectPiConfig();
    },
  });

  const removeExtension = useMutation({
    mutationFn: (path: string) => v2Api.removeProjectPiExtension(id!, path),
    onSuccess: refreshProjectPiConfig,
  });

  const updateDraft = (updater: (current: PiSettingsShape) => PiSettingsShape) => {
    setSettingsDraft((current) => {
      const result = parsePiSettingsDraft(current);
      if (!result.ok) return current;
      return `${JSON.stringify(cleanPiSettings(updater(structuredClone(result.value))), null, 2)}\n`;
    });
  };

  const setRootString = (key: keyof PiSettingsShape, value: string) => updateDraft((current) => {
    if (value.trim()) current[key] = value.trim();
    else delete current[key];
    return current;
  });

  const setNestedBoolean = (group: 'compaction' | 'retry', key: string, value: boolean) => updateDraft((current) => {
    const nextGroup = { ...objectValue(current[group]), [key]: value };
    current[group] = nextGroup;
    return current;
  });

  const setNestedNumber = (group: 'compaction' | 'retry', key: string, value: string) => updateDraft((current) => {
    const nextGroup = { ...objectValue(current[group]) };
    const numeric = Number(value);
    if (value.trim() && Number.isFinite(numeric) && numeric >= 0) nextGroup[key] = numeric;
    else delete nextGroup[key];
    current[group] = nextGroup;
    return current;
  });

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to={id ? `/projects/${id}/settings` : '/'} className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to project settings">
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Project Pi</div>
              <h1 className="mt-1 truncate text-lg font-semibold">{project?.name ?? 'Project'}</h1>
              <div className="mt-1 truncate font-mono text-xs text-dim">{piConfig?.projectSettings?.path ?? '.pi/settings.json'}</div>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={<Save size={14} />}
            loading={saveSettings.isPending}
            disabled={!settingsDirty || !settingsDraft.trim()}
            onClick={() => saveSettings.mutate()}
          >
            Save Pi settings
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <PiBlock
              icon={<Settings2 size={15} />}
              title="Agent defaults"
              meta={<PiSaveState dirty={settingsDirty} document={piConfig?.projectSettings} parseError={parsed.ok ? null : parsed.error} mutationError={saveSettings.error} />}
            >
              <fieldset disabled={!parsed.ok} className="grid gap-4 disabled:opacity-60 lg:grid-cols-3">
                <Field label="Provider">
                  <V2Input value={stringValue(settings.defaultProvider)} onChange={(event) => setRootString('defaultProvider', event.target.value)} placeholder="anthropic" className="w-full" />
                </Field>
                <Field label="Model">
                  <V2Input value={stringValue(settings.defaultModel)} onChange={(event) => setRootString('defaultModel', event.target.value)} placeholder="claude-sonnet-4-5" className="w-full" />
                </Field>
                <Field label="Thinking">
                  <V2Select
                    value={stringValue(settings.defaultThinkingLevel)}
                    onChange={(event) => setRootString('defaultThinkingLevel', event.target.value)}
                    className="w-full"
                  >
                    <option value="">inherit</option>
                    <option value="off">off</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                  </V2Select>
                </Field>
              </fieldset>
            </PiBlock>

            <PiBlock icon={<Code2 size={15} />} title="Conversation behavior">
              <fieldset disabled={!parsed.ok} className="space-y-5 disabled:opacity-60">
                <div className="grid gap-4 md:grid-cols-2">
                  <ToggleRow
                    title="Auto-compaction"
                    detail={`${numberValue(settings.compaction?.keepRecentTokens) || 20000} recent tokens kept`}
                    checked={settings.compaction?.enabled ?? true}
                    onChange={(checked) => setNestedBoolean('compaction', 'enabled', checked)}
                  />
                  <ToggleRow
                    title="Retry transient failures"
                    detail={`${numberValue(settings.retry?.maxRetries) || 3} attempts`}
                    checked={settings.retry?.enabled ?? true}
                    onChange={(checked) => setNestedBoolean('retry', 'enabled', checked)}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Reserve tokens">
                    <V2Input
                      type="number"
                      min={0}
                      value={stringValue(settings.compaction?.reserveTokens)}
                      onChange={(event) => setNestedNumber('compaction', 'reserveTokens', event.target.value)}
                      placeholder="16384"
                      className="w-full"
                    />
                  </Field>
                  <Field label="Recent tokens">
                    <V2Input
                      type="number"
                      min={0}
                      value={stringValue(settings.compaction?.keepRecentTokens)}
                      onChange={(event) => setNestedNumber('compaction', 'keepRecentTokens', event.target.value)}
                      placeholder="20000"
                      className="w-full"
                    />
                  </Field>
                  <Field label="Max retries">
                    <V2Input
                      type="number"
                      min={0}
                      value={stringValue(settings.retry?.maxRetries)}
                      onChange={(event) => setNestedNumber('retry', 'maxRetries', event.target.value)}
                      placeholder="3"
                      className="w-full"
                    />
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Steering">
                    <DeliverySelect value={settings.steeringMode} onChange={(value) => setRootString('steeringMode', value)} />
                  </Field>
                  <Field label="Follow-ups">
                    <DeliverySelect value={settings.followUpMode} onChange={(value) => setRootString('followUpMode', value)} />
                  </Field>
                  <Field label="Shell prefix">
                    <V2Input
                      value={stringValue(settings.shellCommandPrefix)}
                      onChange={(event) => setRootString('shellCommandPrefix', event.target.value)}
                      placeholder="shopt -s expand_aliases"
                      className="w-full"
                    />
                  </Field>
                </div>
              </fieldset>
            </PiBlock>

            <PiBlock
              icon={<PackagePlus size={15} />}
              title="Project packages"
              action={<Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} loading={updatePackages.isPending} onClick={() => updatePackages.mutate()}>Update</Button>}
            >
              <ResourceInput
                value={packageSource}
                onChange={setPackageSource}
                placeholder="npm:@scope/pkg · git:github.com/org/repo@v1"
                submitLabel="Install"
                pending={installPackage.isPending}
                disabled={!deferredPackageSource}
                onSubmit={() => installPackage.mutate(deferredPackageSource)}
              />
              <ResourceList
                empty="No project packages installed."
                items={(piConfig?.projectPackages ?? []).map((pkg) => ({
                  key: pkg.source,
                  title: pkg.source,
                  detail: describePiPackage(pkg),
                  removePending: removePackage.isPending,
                  onRemove: () => removePackage.mutate(pkg.source),
                }))}
              />
              {packageMutationError(installPackage.error, removePackage.error, updatePackages.error)}
            </PiBlock>

            <PiBlock
              icon={<PlugZap size={15} />}
              title="Local extensions"
              meta={<span className="text-xs text-dim">Advanced</span>}
            >
              <ResourceInput
                value={extensionPath}
                onChange={setExtensionPath}
                placeholder=".pi/extensions/my-extension.ts"
                submitLabel="Add"
                pending={addExtension.isPending}
                disabled={!deferredExtensionPath}
                onSubmit={() => addExtension.mutate(deferredExtensionPath)}
              />
              <ResourceList
                empty="No local extension paths configured."
                items={(piConfig?.projectExtensions ?? []).map((extension) => ({
                  key: extension.path,
                  title: extension.path,
                  detail: 'Loaded from this repository',
                  removePending: removeExtension.isPending,
                  onRemove: () => removeExtension.mutate(extension.path),
                }))}
              />
              {packageMutationError(addExtension.error, removeExtension.error)}
            </PiBlock>

            <PiBlock
              icon={<Code2 size={15} />}
              title="Raw JSON"
              meta={<span className="text-xs text-dim">{rawOpen ? 'Editing raw file' : 'Advanced mode'}</span>}
              action={<Button size="sm" variant="secondary" onClick={() => setRawOpen((value) => !value)}>{rawOpen ? 'Hide JSON' : 'Show JSON'}</Button>}
            >
              {rawOpen && (
                <V2Textarea
                  value={settingsDraft}
                  onChange={(event) => setSettingsDraft(event.target.value)}
                  spellCheck={false}
                  className="min-h-[22rem] w-full font-mono text-[13px] leading-6"
                />
              )}
            </PiBlock>
          </div>

          <aside className="space-y-3">
            <SummaryRow label="Project packages" value={String(piConfig?.projectPackages?.length ?? 0)} />
            <SummaryRow label="Global packages" value={String(piConfig?.globalPackages?.length ?? 0)} />
            <SummaryRow label="Project extensions" value={String(piConfig?.projectExtensions?.length ?? 0)} />
            <SummaryRow label="Settings file" value={piConfig?.projectSettings?.exists ? 'present' : 'not created'} />
            <Link to="/harness" className="block rounded-xl bg-card px-3 py-3 text-sm shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)]">
              <div className="font-medium">Global Pi settings</div>
              <div className="mt-1 text-xs text-dim">Harness manages global packages, auth, and models.</div>
            </Link>
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function PiBlock({
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
        {action}
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

function ToggleRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-inset)]/70 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="mt-0.5 truncate text-xs text-dim">{detail}</div>
      </div>
      <SwitchControl checked={checked} onChange={() => onChange(!checked)} label={title} />
    </div>
  );
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
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-card-hover)]'
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

function DeliverySelect({ value, onChange }: { value?: PiDeliveryMode; onChange: (value: string) => void }) {
  return (
    <V2Select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="w-full">
      <option value="">inherit</option>
      <option value="one-at-a-time">one at a time</option>
      <option value="all">all</option>
    </V2Select>
  );
}

function ResourceInput({
  value,
  onChange,
  placeholder,
  submitLabel,
  pending,
  disabled,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  submitLabel: string;
  pending: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <V2Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0" />
      <Button size="sm" variant="primary" icon={<PackagePlus size={14} />} loading={pending} disabled={disabled} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}

function ResourceList({
  items,
  empty,
}: {
  items: Array<{ key: string; title: string; detail: string; removePending: boolean; onRemove: () => void }>;
  empty: string;
}) {
  return (
    <div className="mt-4 space-y-1.5">
      {items.map((item) => (
        <div key={item.key} className="grid gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">{item.title}</div>
            <div className="mt-1 text-xs text-dim">{item.detail}</div>
          </div>
          <button type="button" disabled={item.removePending} onClick={item.onRemove} className="rounded-md p-1.5 text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:opacity-50">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {items.length === 0 && <div className="rounded-lg bg-[var(--color-inset)]/60 px-3 py-3 text-sm text-dim">{empty}</div>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-3 text-sm shadow-[var(--shadow-card)]">
      <span className="text-dim">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PiSaveState({
  dirty,
  document,
  parseError,
  mutationError,
}: {
  dirty: boolean;
  document?: PiConfigDocument;
  parseError: string | null;
  mutationError: unknown;
}) {
  if (parseError || document?.parseError) {
    return <StatusPill ok={false} label="Invalid JSON" detail={parseError ?? document?.parseError} />;
  }
  if (mutationError instanceof Error) {
    return <span className="text-xs text-[var(--color-error)]">{mutationError.message}</span>;
  }
  return <StatusPill ok label={dirty ? 'Unsaved changes' : document?.exists ? 'Saved' : 'Will create file'} />;
}

function StatusPill({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? 'text-dim' : 'text-[var(--color-warning)]'}`} title={detail}>
      {ok ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
      {label}
    </span>
  );
}

function packageMutationError(...errors: unknown[]) {
  const error = errors.find((candidate): candidate is Error => candidate instanceof Error);
  if (!error) return null;
  return <div className="mt-3 text-xs text-[var(--color-error)]">{error.message}</div>;
}

function parsePiSettingsDraft(draft: string): { ok: true; value: PiSettingsShape } | { ok: false; error: string } {
  const trimmed = draft.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Settings must be a JSON object' };
    }
    return { ok: true, value: parsed as PiSettingsShape };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

function cleanPiSettings(settings: PiSettingsShape): PiSettingsShape {
  for (const key of ['compaction', 'retry'] as const) {
    const value = settings[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete settings[key];
    }
  }
  return settings;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function describePiPackage(pkg: PiPackageEntry) {
  const traits = [pkg.scope, pkg.sourceType];
  if (pkg.pinned) traits.push('pinned');
  if (pkg.filtered) traits.push('filtered');
  const counts = [
    pkg.extensionCount ? `${pkg.extensionCount} extensions` : '',
    pkg.skillCount ? `${pkg.skillCount} skills` : '',
    pkg.promptCount ? `${pkg.promptCount} prompts` : '',
    pkg.themeCount ? `${pkg.themeCount} themes` : '',
  ].filter(Boolean);
  return [...traits, ...counts].join(' · ');
}
