import { useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Info, PackagePlus } from 'lucide-react';
import type { ManagedSkill, SkillCatalogEntry } from '../../api/types';
import { Button, V2Empty, V2Input } from './v2-ui';

export type SkillTarget = 'agents' | 'codex' | 'claude';
export type InstallScope = 'project' | 'global';
export type InstallMode = 'symlink' | 'copy';

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export function SkillSection({
  icon,
  title,
  meta,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
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
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SkillList({
  skills,
  emptyTitle,
  emptyBody,
  actions,
}: {
  skills: ManagedSkill[];
  emptyTitle: string;
  emptyBody?: string;
  actions: (skill: ManagedSkill) => ReactNode;
}) {
  if (skills.length === 0) {
    return <V2Empty title={emptyTitle} body={emptyBody} />;
  }
  return (
    <div className="space-y-0.5">
      {skills.map((skill) => (
        <SkillRow key={`${skill.scope}-${skill.target}-${skill.name}`} skill={skill} actions={actions(skill)} />
      ))}
    </div>
  );
}

export function SkillRow({ skill, actions }: { skill: ManagedSkill; actions: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    await navigator.clipboard?.writeText(skill.path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)]">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-medium">{skill.title}</div>
            <TargetPill target={skill.target} />
            {skill.symlinked && <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 text-[10px] text-dim">symlink</span>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-dim">
            {skill.description && <span className="min-w-0 max-w-[36rem] truncate">{skill.description}</span>}
            <span className="min-w-0 truncate font-mono">{skill.path}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" icon={<Info size={13} />} onClick={() => setExpanded((value) => !value)}>
            Details
          </Button>
          {actions}
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 rounded-lg bg-[var(--color-inset)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          {skill.description && <div>{skill.description}</div>}
          <DetailLine label="Installed path" value={skill.path} />
          {skill.sourcePath && <DetailLine label="Source path" value={skill.sourcePath} />}
          <button
            type="button"
            onClick={() => void copyPath()}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied path' : 'Copy path'}
          </button>
        </div>
      )}
    </div>
  );
}

export function CatalogSkillList({
  entries,
  target,
  emptyTitle,
  installLabel = 'Install',
  installIcon,
  getInstallState,
  onInstall,
}: {
  entries: SkillCatalogEntry[];
  target: SkillTarget;
  emptyTitle: string;
  installLabel?: string;
  installIcon?: ReactNode;
  getInstallState?: (entry: SkillCatalogEntry) => {
    installed?: boolean;
    installing?: boolean;
    disabled?: boolean;
    label?: string;
  };
  onInstall?: (entry: SkillCatalogEntry) => void;
}) {
  if (entries.length === 0) {
    return <V2Empty title={emptyTitle} />;
  }
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => {
        const state = getInstallState?.(entry) ?? {};
        return (
          <CatalogSkillRow
            key={`${entry.sourceId}:${entry.skillPath}`}
            entry={entry}
            target={target}
            installLabel={state.label ?? (state.installed ? 'Installed' : installLabel)}
            installIcon={state.installed ? <Check size={13} /> : installIcon}
            installed={state.installed}
            installing={state.installing}
            disabled={state.disabled || state.installed || !onInstall}
            onInstall={() => onInstall?.(entry)}
          />
        );
      })}
    </div>
  );
}

function CatalogSkillRow({
  entry,
  target,
  installLabel,
  installIcon,
  installed,
  installing,
  disabled,
  onInstall,
}: {
  entry: SkillCatalogEntry;
  target: SkillTarget;
  installLabel: string;
  installIcon?: ReactNode;
  installed?: boolean;
  installing?: boolean;
  disabled?: boolean;
  onInstall: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const entryUrl = catalogEntryUrl(entry);
  return (
    <div className={`rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)] ${installed ? 'opacity-65' : ''}`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-medium">{entry.title}</div>
            <TargetPill target={target} />
            {installed && <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 text-[10px] text-dim">already installed</span>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-dim">
            <span className="shrink-0">{entry.sourceName}</span>
            <span className="min-w-0 truncate font-mono">{entry.skillPath}</span>
            {entry.description && <span className="min-w-0 max-w-[30rem] truncate">{entry.description}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" icon={<Info size={13} />} onClick={() => setExpanded((value) => !value)}>
            Details
          </Button>
          <Button size="xs" variant={installed ? 'ghost' : 'secondary'} icon={installIcon} loading={installing} disabled={disabled} onClick={onInstall}>
            {installLabel}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 rounded-lg bg-[var(--color-inset)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          {entry.description && <div>{entry.description}</div>}
          <DetailLine label="Catalog" value={entry.sourceName} />
          <DetailLine label="Skill path" value={entry.skillPath} />
          <DetailLine label="Ref" value={entry.repoRef || 'main'} />
          {entryUrl && (
            <a
              href={entryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
            >
              <ExternalLink size={13} />
              Open source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function InstallFromPathForm({
  sourcePath,
  onSourcePathChange,
  target,
  onTargetChange,
  mode,
  onModeChange,
  scope,
  onScopeChange,
  scopeOptions,
  pending,
  disabled,
  error,
  onSubmit,
}: {
  sourcePath: string;
  onSourcePathChange: (value: string) => void;
  target: SkillTarget;
  onTargetChange: (value: SkillTarget) => void;
  mode: InstallMode;
  onModeChange: (value: InstallMode) => void;
  scope?: InstallScope;
  onScopeChange?: (value: InstallScope) => void;
  scopeOptions?: InstallScope[];
  pending: boolean;
  disabled: boolean;
  error?: unknown;
  onSubmit: () => void;
}) {
  const scopes = scopeOptions ?? (scope ? ['project', 'global'] : []);
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase text-dim">Source folder</span>
        <V2Input value={sourcePath} onChange={(event) => onSourcePathChange(event.target.value)} placeholder="/path/to/skill-directory" className="w-full font-mono text-xs" />
      </label>
      {scopes.length > 0 && scope && onScopeChange && (
        <SkillChoiceGroup
          label="Destination"
          value={scope}
          onChange={onScopeChange}
          options={scopes.map((item) => ({
            value: item,
            label: item === 'project' ? 'Project' : 'Global',
            hint: item === 'project' ? 'This repo' : 'All projects',
          }))}
        />
      )}
      <SkillChoiceGroup
        label="Target"
        value={target}
        onChange={onTargetChange}
        options={[
          { value: 'agents', label: 'Universal', hint: '.agents' },
          { value: 'codex', label: 'Codex', hint: '.codex' },
          { value: 'claude', label: 'Claude', hint: '.claude' },
        ]}
      />
      <SkillChoiceGroup
        label="Install mode"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'symlink', label: 'Link', hint: 'Live edits' },
          { value: 'copy', label: 'Copy', hint: 'Snapshot' },
        ]}
      />
      <Button
        className="w-full"
        size="sm"
        variant="primary"
        icon={<PackagePlus size={14} />}
        loading={pending}
        disabled={disabled}
        onClick={onSubmit}
      >
        Install{scope ? ` to ${scope}` : ''}
      </Button>
      {error instanceof Error && <div className="text-xs text-[var(--color-error)]">{error.message}</div>}
    </div>
  );
}

export function SkillChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      {label && <div className="mb-1.5 text-[11px] font-medium uppercase text-dim">{label}</div>}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              className={`min-w-0 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${
                active
                  ? 'bg-accent text-white'
                  : 'bg-[var(--color-inset)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <div className="truncate text-xs font-medium">{option.label}</div>
              {option.hint && <div className={`mt-0.5 truncate text-[10px] ${active ? 'text-white/75' : 'text-dim'}`}>{option.hint}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TargetPill({ target }: { target: string }) {
  return (
    <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 font-mono text-[10px] text-dim">
      {target}
    </span>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <div className="text-[11px] font-medium uppercase text-dim">{label}</div>
      <div className="min-w-0 break-all font-mono text-[11px]">{value}</div>
    </div>
  );
}

function catalogEntryUrl(entry: SkillCatalogEntry) {
  if (!/^https?:\/\//.test(entry.repoUrl)) return null;
  const repoUrl = entry.repoUrl.replace(/\.git$/, '');
  if (repoUrl.includes('github.com/')) {
    return `${repoUrl}/tree/${encodeURIComponent(entry.repoRef || 'main')}/${entry.skillPath}`;
  }
  return repoUrl;
}
