import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, ExternalLink, Globe2, Hammer, Link2, PackagePlus, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import type { ManagedSkill, SkillCatalogEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Empty, V2Input, V2Screen, V2Select } from './v2-ui';

type SkillTarget = 'agents' | 'codex' | 'claude';
type InstallScope = 'project' | 'global';
type InstallMode = 'symlink' | 'copy';

export function V2ProjectSkillsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [sourcePath, setSourcePath] = useState('');
  const [installScope, setInstallScope] = useState<InstallScope>('project');
  const [target, setTarget] = useState<SkillTarget>('agents');
  const [mode, setMode] = useState<InstallMode>('symlink');
  const [catalogSearch, setCatalogSearch] = useState('');
  const deferredCatalogSearch = useDeferredValue(catalogSearch.trim().toLowerCase());

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: skills } = useQuery({
    queryKey: ['v2-project-skills', id],
    queryFn: () => v2Api.listProjectSkills(id!),
    enabled: !!id,
  });

  const { data: catalog } = useQuery({
    queryKey: ['v2-skill-catalog'],
    queryFn: () => v2Api.listSkillCatalog(),
  });

  const installed = Array.isArray(skills?.installed) ? skills.installed : [];
  const available = Array.isArray(skills?.available) ? skills.available : [];
  const catalogEntries = useMemo(() => Array.isArray(catalog) ? catalog : [], [catalog]);

  const invalidateSkills = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
    ]);
  };

  const installFromPath = useMutation({
    mutationFn: (input: { sourcePath: string; target: SkillTarget; mode: InstallMode; scope: InstallScope; name?: string }) => {
      const payload = { sourcePath: input.sourcePath, target: input.target, mode: input.mode, name: input.name };
      if (input.scope === 'global') {
        return v2Api.installGlobalSkill(payload);
      }
      return v2Api.installProjectSkill(id!, payload);
    },
    onSuccess: async () => {
      setSourcePath('');
      await invalidateSkills();
    },
  });

  const installGlobalIntoProject = useMutation({
    mutationFn: (skill: ManagedSkill) =>
      v2Api.installProjectSkill(id!, {
        sourcePath: skill.sourcePath ?? skill.path,
        target: skill.target,
        mode: 'symlink',
        name: skill.name,
      }),
    onSuccess: invalidateSkills,
  });

  const removeProjectSkill = useMutation({
    mutationFn: (skill: ManagedSkill) => v2Api.deleteProjectSkill(id!, skill.target, skill.name),
    onSuccess: invalidateSkills,
  });

  const removeGlobalSkill = useMutation({
    mutationFn: (skill: ManagedSkill) => v2Api.deleteGlobalSkill(skill.target, skill.name),
    onSuccess: invalidateSkills,
  });

  const installCatalogSkill = useMutation({
    mutationFn: ({ entry, scope }: { entry: SkillCatalogEntry; scope: InstallScope }) => {
      const input = { sourceId: entry.sourceId, skillPath: entry.skillPath, target, name: entry.name };
      if (scope === 'global') return v2Api.installGlobalCatalogSkill(input);
      return v2Api.installCatalogSkill(id!, input);
    },
    onSuccess: invalidateSkills,
  });

  const filteredCatalog = useMemo(() => {
    if (!deferredCatalogSearch) return catalogEntries;
    return catalogEntries.filter((entry) =>
      `${entry.title} ${entry.name} ${entry.sourceName} ${entry.description ?? ''}`.toLowerCase().includes(deferredCatalogSearch),
    );
  }, [catalogEntries, deferredCatalogSearch]);

  const error = installFromPath.error || installGlobalIntoProject.error || removeProjectSkill.error || removeGlobalSkill.error || installCatalogSkill.error;

  return (
    <V2Screen>
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 bg-canvas px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={project ? `/v2/projects/${project.id}/settings` : '/v2/harness'} className="rounded-md p-1.5 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to project settings">
            <ArrowLeft size={15} />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Skills</div>
            <div className="truncate text-xs text-dim">{project?.name ?? 'Project'} · filesystem-native agent capabilities</div>
          </div>
        </div>
        <a
          href="https://developers.openai.com/codex/skills"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] sm:inline-flex"
        >
          Codex skills docs
          <ExternalLink size={12} />
        </a>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-10">
            <SkillSection
              icon={<Hammer size={15} />}
              title="Project skills"
              description="Shared with this repo. Prefer .agents/skills for portable skills; use .claude/skills or .codex/skills only when a provider-specific behavior matters."
              meta={`${installed.length} installed`}
            >
              <SkillList
                skills={installed}
                emptyTitle="No project skills installed"
                emptyBody="Install from a catalog, link a global skill, or add a local skill directory."
                actions={(skill) => (
                  <Button
                    size="xs"
                    variant="danger"
                    icon={<Trash2 size={13} />}
                    loading={removeProjectSkill.isPending}
                    onClick={() => removeProjectSkill.mutate(skill)}
                  >
                    Remove
                  </Button>
                )}
              />
            </SkillSection>

            <SkillSection
              icon={<Globe2 size={15} />}
              title="Global library"
              description="Available across projects from your user-level skill roots. Link one into this project when it should be visible to agents working in this repo."
              meta={`${available.length} discovered`}
            >
              <SkillList
                skills={available}
                emptyTitle="No global skills found"
                emptyBody="Install one globally from a path or catalog to reuse it across projects."
                actions={(skill) => (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={<Link2 size={13} />}
                      loading={installGlobalIntoProject.isPending}
                      onClick={() => installGlobalIntoProject.mutate(skill)}
                    >
                      Link
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<Trash2 size={13} />}
                      loading={removeGlobalSkill.isPending}
                      onClick={() => removeGlobalSkill.mutate(skill)}
                      title="Remove from global library"
                    />
                  </div>
                )}
              />
            </SkillSection>

            <SkillSection
              icon={<Search size={15} />}
              title="Discover"
              description="Catalog entries are copied into the destination. Project installs land in the selected project root; global installs land in the matching user root."
              meta={`${filteredCatalog.length} catalog matches`}
              actions={
                <V2Input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder="Search catalogs"
                  className="w-48"
                />
              }
            >
              <div className="divide-y divide-[var(--color-card-border)]">
                {filteredCatalog.map((entry) => (
                  <CatalogRow
                    key={`${entry.sourceId}:${entry.skillPath}`}
                    entry={entry}
                    target={target}
                    installing={installCatalogSkill.isPending}
                    onInstallProject={() => installCatalogSkill.mutate({ entry, scope: 'project' })}
                    onInstallGlobal={() => installCatalogSkill.mutate({ entry, scope: 'global' })}
                  />
                ))}
              </div>
              {filteredCatalog.length === 0 && <V2Empty icon={<Search size={24} />} title="No catalog skills matched" />}
            </SkillSection>
          </div>

          <aside className="space-y-8">
            <SkillSection
              icon={<PackagePlus size={15} />}
              title="Install from path"
              description="Point at any folder containing SKILL.md. Symlink while iterating; copy when you want a snapshot."
            >
              <div className="space-y-3">
                <V2Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/path/to/skill-directory" className="w-full" />
                <div className="grid grid-cols-3 gap-2">
                  <V2Select value={installScope} onChange={(event) => setInstallScope(event.target.value as InstallScope)}>
                    <option value="project">project</option>
                    <option value="global">global</option>
                  </V2Select>
                  <V2Select value={target} onChange={(event) => setTarget(event.target.value as SkillTarget)}>
                    <option value="agents">agents</option>
                    <option value="codex">codex</option>
                    <option value="claude">claude</option>
                  </V2Select>
                  <V2Select value={mode} onChange={(event) => setMode(event.target.value as InstallMode)}>
                    <option value="symlink">symlink</option>
                    <option value="copy">copy</option>
                  </V2Select>
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  variant="primary"
                  icon={<PackagePlus size={14} />}
                  loading={installFromPath.isPending}
                  disabled={!sourcePath.trim()}
                  onClick={() => installFromPath.mutate({ sourcePath: sourcePath.trim(), target, mode, scope: installScope })}
                >
                  Install to {installScope}
                </Button>
                {error instanceof Error && <div className="text-xs text-[var(--color-error)]">{error.message}</div>}
              </div>
            </SkillSection>

            <SkillSection
              icon={<BookOpen size={15} />}
              title="Standards"
              description="Codeburg stays a thin manager over standard folders, not a private skill registry."
            >
              <div className="space-y-3 text-xs leading-5 text-dim">
                <StandardRow label="Universal project" value=".agents/skills/<name>/SKILL.md" />
                <StandardRow label="Universal global" value="~/.agents/skills/<name>/SKILL.md" />
                <StandardRow label="Claude project" value=".claude/skills/<name>/SKILL.md" />
                <StandardRow label="Codex legacy" value=".codex/skills/<name>/SKILL.md" />
              </div>
            </SkillSection>
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function SkillSection({
  icon,
  title,
  description,
  meta,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  meta?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--color-card-border)] pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-dim">{icon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              {meta && <span className="text-xs text-dim">{meta}</span>}
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-dim">{description}</p>
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function SkillList({
  skills,
  emptyTitle,
  emptyBody,
  actions,
}: {
  skills: ManagedSkill[];
  emptyTitle: string;
  emptyBody: string;
  actions: (skill: ManagedSkill) => ReactNode;
}) {
  if (skills.length === 0) {
    return <V2Empty title={emptyTitle} body={emptyBody} />;
  }
  return (
    <div className="divide-y divide-[var(--color-card-border)]">
      {skills.map((skill) => (
        <SkillRow key={`${skill.scope}-${skill.target}-${skill.name}`} skill={skill} actions={actions(skill)} />
      ))}
    </div>
  );
}

function SkillRow({ skill, actions }: { skill: ManagedSkill; actions: ReactNode }) {
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium">{skill.title}</div>
          <TargetPill target={skill.target} />
          {skill.symlinked && <span className="text-xs text-dim">symlink</span>}
        </div>
        {skill.description && <div className="mt-1 max-w-3xl text-sm leading-5 text-[var(--color-text-secondary)]">{skill.description}</div>}
        <div className="mt-1 break-all font-mono text-[11px] text-dim">{skill.path}</div>
      </div>
      {actions}
    </div>
  );
}

function CatalogRow({
  entry,
  target,
  installing,
  onInstallProject,
  onInstallGlobal,
}: {
  entry: SkillCatalogEntry;
  target: SkillTarget;
  installing: boolean;
  onInstallProject: () => void;
  onInstallGlobal: () => void;
}) {
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium">{entry.title}</div>
          <TargetPill target={target} />
        </div>
        <div className="mt-1 text-xs text-dim">{entry.sourceName} · {entry.skillPath}</div>
        {entry.description && <div className="mt-1 max-w-3xl text-sm leading-5 text-[var(--color-text-secondary)]">{entry.description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="secondary" icon={<Hammer size={13} />} loading={installing} onClick={onInstallProject}>Project</Button>
        <Button size="xs" variant="ghost" icon={<Globe2 size={13} />} loading={installing} onClick={onInstallGlobal}>Global</Button>
      </div>
    </div>
  );
}

function TargetPill({ target }: { target: string }) {
  return (
    <span className="rounded-md bg-[var(--color-card)] px-1.5 py-0.5 font-mono text-[10px] text-dim">
      {target}
    </span>
  );
}

function StandardRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-text-secondary)]">{value}</div>
    </div>
  );
}
