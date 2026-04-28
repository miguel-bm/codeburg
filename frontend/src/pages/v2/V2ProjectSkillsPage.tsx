import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Globe2, Hammer, Link2, PackagePlus, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import type { ManagedSkill, SkillCatalogEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen } from './v2-ui';
import {
  CatalogSkillList,
  InstallFromPathForm,
  SkillList,
  SkillSection,
  type InstallMode,
  type InstallScope,
  type SkillTarget,
} from './V2SkillsShared';

export function V2ProjectSkillsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [sourcePath, setSourcePath] = useState('');
  const [installScope, setInstallScope] = useState<InstallScope>('project');
  const [target, setTarget] = useState<SkillTarget>('agents');
  const [mode, setMode] = useState<InstallMode>('symlink');
  const [catalogSearch, setCatalogSearch] = useState('');
  const deferredCatalogSearch = useDeferredValue(catalogSearch);

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
  const filteredCatalog = useMemo(() => filterCatalog(catalogEntries, deferredCatalogSearch), [catalogEntries, deferredCatalogSearch]);

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
      if (input.scope === 'global') return v2Api.installGlobalSkill(payload);
      return v2Api.installProjectSkill(id!, payload);
    },
    onSuccess: async () => {
      setSourcePath('');
      await invalidateSkills();
    },
  });

  const linkGlobalSkill = useMutation({
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

  const installCatalogSkill = useMutation({
    mutationFn: ({ entry, scope }: { entry: SkillCatalogEntry; scope: InstallScope }) => {
      const input = { sourceId: entry.sourceId, skillPath: entry.skillPath, target, name: entry.name };
      if (scope === 'global') return v2Api.installGlobalCatalogSkill(input);
      return v2Api.installCatalogSkill(id!, input);
    },
    onSuccess: invalidateSkills,
  });

  const error = installFromPath.error || linkGlobalSkill.error || removeProjectSkill.error || installCatalogSkill.error;

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to={project ? `/projects/${project.id}/settings` : '/'} className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to project settings">
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Project skills</div>
              <h1 className="mt-1 truncate text-lg font-semibold">{project?.name ?? 'Project'}</h1>
              <div className="mt-1 text-xs text-dim">{installed.length} project · {available.length} global available</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to="/skills">
              <Button size="sm" variant="secondary" icon={<Globe2 size={14} />}>Global skills</Button>
            </Link>
            <a
              href="https://developers.openai.com/codex/skills"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] sm:inline-flex"
            >
              Docs
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <SkillSection
              icon={<Hammer size={15} />}
              title="Installed in this project"
              meta={<span className="text-xs text-dim">{installed.length} installed</span>}
            >
              <SkillList
                skills={installed}
                emptyTitle="No project skills installed"
                emptyBody="Install from the catalog, link a global skill, or add a local skill directory."
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
              meta={<span className="text-xs text-dim">{available.length} available</span>}
              actions={<Link to="/skills"><Button size="xs" variant="secondary">Manage global</Button></Link>}
            >
              <SkillList
                skills={available}
                emptyTitle="No global skills found"
                emptyBody="Global skills are managed from the shared skills page."
                actions={(skill) => (
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<Link2 size={13} />}
                    loading={linkGlobalSkill.isPending}
                    onClick={() => linkGlobalSkill.mutate(skill)}
                  >
                    Link
                  </Button>
                )}
              />
            </SkillSection>

            <SkillSection
              icon={<Search size={15} />}
              title="Catalog"
              meta={<span className="text-xs text-dim">{filteredCatalog.length} matches</span>}
              actions={
                <V2Input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder="Search catalog"
                  className="w-48"
                />
              }
            >
              <CatalogSkillList
                entries={filteredCatalog}
                target={target}
                installing={installCatalogSkill.isPending}
                emptyTitle="No catalog skills matched"
                onInstallProject={(entry) => installCatalogSkill.mutate({ entry, scope: 'project' })}
                onInstallGlobal={(entry) => installCatalogSkill.mutate({ entry, scope: 'global' })}
              />
            </SkillSection>
          </div>

          <aside className="space-y-8">
            <SkillSection
              icon={<PackagePlus size={15} />}
              title="Install from path"
              meta={<span className="text-xs text-dim">Local folder</span>}
            >
              <InstallFromPathForm
                sourcePath={sourcePath}
                onSourcePathChange={setSourcePath}
                target={target}
                onTargetChange={setTarget}
                mode={mode}
                onModeChange={setMode}
                scope={installScope}
                onScopeChange={setInstallScope}
                scopeOptions={['project', 'global']}
                pending={installFromPath.isPending}
                disabled={!sourcePath.trim()}
                error={error}
                onSubmit={() => installFromPath.mutate({ sourcePath: sourcePath.trim(), target, mode, scope: installScope })}
              />
            </SkillSection>

            <SkillSection icon={<Hammer size={15} />} title="Paths" meta={<span className="text-xs text-dim">Standards</span>}>
              <div className="space-y-3 text-xs leading-5 text-dim">
                <PathRow label="Universal project" value=".agents/skills/<name>/SKILL.md" />
                <PathRow label="Claude project" value=".claude/skills/<name>/SKILL.md" />
                <PathRow label="Codex legacy" value=".codex/skills/<name>/SKILL.md" />
              </div>
            </SkillSection>
          </aside>
        </div>
      </main>
    </V2Screen>
  );
}

function filterCatalog(entries: SkillCatalogEntry[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    `${entry.title} ${entry.name} ${entry.sourceName} ${entry.description ?? ''}`.toLowerCase().includes(needle),
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase text-dim">{label}</div>
      <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-text-secondary)]">{value}</div>
    </div>
  );
}
