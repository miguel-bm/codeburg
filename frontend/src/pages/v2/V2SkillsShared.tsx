import type { ReactNode } from 'react';
import { Globe2, Hammer, PackagePlus } from 'lucide-react';
import type { ManagedSkill, SkillCatalogEntry } from '../../api/types';
import { Button, V2Empty, V2Input, V2Select } from './v2-ui';

export type SkillTarget = 'agents' | 'codex' | 'claude';
export type InstallScope = 'project' | 'global';
export type InstallMode = 'symlink' | 'copy';

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
  return (
    <div className="grid gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
      {actions}
    </div>
  );
}

export function CatalogSkillList({
  entries,
  target,
  installing,
  emptyTitle,
  onInstallProject,
  onInstallGlobal,
}: {
  entries: SkillCatalogEntry[];
  target: SkillTarget;
  installing: boolean;
  emptyTitle: string;
  onInstallProject?: (entry: SkillCatalogEntry) => void;
  onInstallGlobal?: (entry: SkillCatalogEntry) => void;
}) {
  if (entries.length === 0) {
    return <V2Empty title={emptyTitle} />;
  }
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => (
        <div key={`${entry.sourceId}:${entry.skillPath}`} className="grid gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--color-card-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-medium">{entry.title}</div>
              <TargetPill target={target} />
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-dim">
              <span className="shrink-0">{entry.sourceName}</span>
              <span className="min-w-0 truncate font-mono">{entry.skillPath}</span>
              {entry.description && <span className="min-w-0 max-w-[30rem] truncate">{entry.description}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onInstallProject && (
              <Button size="xs" variant="secondary" icon={<Hammer size={13} />} loading={installing} onClick={() => onInstallProject(entry)}>Project</Button>
            )}
            {onInstallGlobal && (
              <Button size="xs" variant={onInstallProject ? 'ghost' : 'secondary'} icon={<Globe2 size={13} />} loading={installing} onClick={() => onInstallGlobal(entry)}>Global</Button>
            )}
          </div>
        </div>
      ))}
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
    <div className="space-y-3">
      <V2Input value={sourcePath} onChange={(event) => onSourcePathChange(event.target.value)} placeholder="/path/to/skill-directory" className="w-full" />
      <div className={`grid gap-2 ${scopes.length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {scopes.length > 0 && scope && onScopeChange && (
          <V2Select value={scope} onChange={(event) => onScopeChange(event.target.value as InstallScope)}>
            {scopes.map((item) => <option key={item} value={item}>{item}</option>)}
          </V2Select>
        )}
        <V2Select value={target} onChange={(event) => onTargetChange(event.target.value as SkillTarget)}>
          <option value="agents">agents</option>
          <option value="codex">codex</option>
          <option value="claude">claude</option>
        </V2Select>
        <V2Select value={mode} onChange={(event) => onModeChange(event.target.value as InstallMode)}>
          <option value="symlink">symlink</option>
          <option value="copy">copy</option>
        </V2Select>
      </div>
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

export function TargetPill({ target }: { target: string }) {
  return (
    <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 font-mono text-[10px] text-dim">
      {target}
    </span>
  );
}
