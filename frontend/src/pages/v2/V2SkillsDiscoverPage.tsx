import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Check, ChevronDown, ExternalLink, Globe2, Hammer, PackagePlus, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Project, SkillCatalogEntry, SkillCatalogSource } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen } from './v2-ui';
import {
  CatalogSkillList,
  InstallFromPathForm,
  SkillChoiceGroup,
  SkillSection,
  type InstallMode,
  type InstallScope,
  type SkillTarget,
} from './V2SkillsShared';

export function V2SkillsDiscoverPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const projectId = searchParams.get('project') || undefined;
  const requestedScope = searchParams.get('scope') === 'global' ? 'global' : 'project';
  const [sourcePath, setSourcePath] = useState('');
  const [installScope, setInstallScope] = useState<InstallScope>(requestedScope);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');
  const [target, setTarget] = useState<SkillTarget>('agents');
  const [mode, setMode] = useState<InstallMode>('symlink');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceRef, setSourceRef] = useState('main');
  const [sourcePrefixes, setSourcePrefixes] = useState('skills/');
  const [catalogInstallingKey, setCatalogInstallingKey] = useState<string | null>(null);
  const deferredCatalogSearch = useDeferredValue(catalogSearch);

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId);
  }, [projectId]);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const { data: catalog } = useQuery({
    queryKey: ['v2-skill-catalog'],
    queryFn: () => v2Api.listSkillCatalog(),
  });

  const { data: globalSkills } = useQuery({
    queryKey: ['v2-global-skills'],
    queryFn: () => v2Api.listSkills(),
  });

  const { data: selectedProjectSkills } = useQuery({
    queryKey: ['v2-project-skills', selectedProjectId],
    queryFn: () => v2Api.listProjectSkills(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const { data: catalogSources } = useQuery({
    queryKey: ['v2-skill-catalog-sources'],
    queryFn: () => v2Api.listSkillCatalogSources(),
  });

  const safeProjects = useMemo(() => (Array.isArray(projects) ? projects.filter((item) => !item.hidden) : []), [projects]);
  const selectedProject = useMemo(
    () => safeProjects.find((item) => item.id === selectedProjectId) ?? project,
    [project, safeProjects, selectedProjectId],
  );
  const catalogEntries = useMemo(() => Array.isArray(catalog) ? catalog : [], [catalog]);
  const sources = useMemo(() => Array.isArray(catalogSources) ? catalogSources : [], [catalogSources]);
  const filteredCatalog = useMemo(() => filterCatalog(catalogEntries, deferredCatalogSearch), [catalogEntries, deferredCatalogSearch]);
  const globalInstalled = useMemo(() => Array.isArray(globalSkills) ? globalSkills : [], [globalSkills]);
  const projectInstalled = useMemo(() => Array.isArray(selectedProjectSkills?.installed) ? selectedProjectSkills.installed : [], [selectedProjectSkills]);
  const destinationInstalled = installScope === 'project' ? projectInstalled : globalInstalled;
  const installedKeys = useMemo(() => new Set(destinationInstalled.map((skill) => skillKey(skill.name, skill.target))), [destinationInstalled]);
  const destinationReady = installScope === 'global' || !!selectedProjectId;
  const destinationLabel = installScope === 'project'
    ? selectedProject?.name ? selectedProject.name : 'Choose project'
    : 'Global library';
  const backTo = projectId ? `/projects/${projectId}/skills` : '/skills';

  const invalidateSkills = async () => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog-sources'] }),
    ];
    invalidations.push(queryClient.invalidateQueries({ queryKey: selectedProjectId ? ['v2-project-skills', selectedProjectId] : ['v2-project-skills'] }));
    await Promise.all(invalidations);
  };

  const installFromPath = useMutation({
    mutationFn: (input: { sourcePath: string; target: SkillTarget; mode: InstallMode; scope: InstallScope; projectId?: string; name?: string }) => {
      const payload = { sourcePath: input.sourcePath, target: input.target, mode: input.mode, name: input.name };
      if (input.scope === 'project' && input.projectId) return v2Api.installProjectSkill(input.projectId, payload);
      return v2Api.installGlobalSkill(payload);
    },
    onSuccess: async () => {
      setSourcePath('');
      await invalidateSkills();
    },
  });

  const installCatalogSkill = useMutation({
    mutationFn: ({ entry, scope, projectId: installProjectId, target: installTarget }: { entry: SkillCatalogEntry; scope: InstallScope; projectId?: string; target: SkillTarget }) => {
      const input = { sourceId: entry.sourceId, skillPath: entry.skillPath, target: installTarget, name: entry.name };
      if (scope === 'project' && installProjectId) return v2Api.installCatalogSkill(installProjectId, input);
      return v2Api.installGlobalCatalogSkill(input);
    },
    onMutate: (input) => {
      setCatalogInstallingKey(catalogInstallKey(input.entry, input.scope, input.projectId, input.target));
    },
    onSuccess: invalidateSkills,
    onSettled: () => setCatalogInstallingKey(null),
  });

  const addCatalogSource = useMutation({
    mutationFn: () => v2Api.createSkillCatalogSource({
      name: sourceName.trim(),
      repoUrl: sourceUrl.trim(),
      repoRef: sourceRef.trim() || 'main',
      skillPrefixes: parsePrefixes(sourcePrefixes),
    }),
    onSuccess: async () => {
      setSourceName('');
      setSourceUrl('');
      setSourceRef('main');
      setSourcePrefixes('skills/');
      await invalidateSkills();
    },
  });

  const deleteCatalogSource = useMutation({
    mutationFn: (source: SkillCatalogSource) => v2Api.deleteSkillCatalogSource(source.id),
    onSuccess: invalidateSkills,
  });

  const refreshCatalog = useMutation({
    mutationFn: () => v2Api.refreshSkillCatalog(),
    onSuccess: invalidateSkills,
  });

  const error = installFromPath.error || installCatalogSkill.error || addCatalogSource.error || deleteCatalogSource.error || refreshCatalog.error;
  const canInstallToProject = safeProjects.length > 0 || !!selectedProjectId;

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to={backTo} className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to skills">
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Discover skills</div>
              <h1 className="mt-1 truncate text-lg font-semibold">{project ? `${project.name} skill catalog` : 'Skill catalog'}</h1>
              <div className="mt-1 text-xs text-dim">{filteredCatalog.length} matches from {sources.length} sources · installing to {destinationLabel}</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
              icon={<Search size={15} />}
              title="Catalog"
              meta={<span className="text-xs text-dim">Rows install to the selected destination: {destinationLabel}</span>}
              actions={
                <div className="flex items-center gap-2">
                  <V2Input
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    placeholder="Search catalog"
                    className="w-52"
                  />
                  <SkillChoiceGroup
                    label=""
                    value={target}
                    onChange={setTarget}
                    options={[
                      { value: 'agents', label: 'Universal' },
                      { value: 'codex', label: 'Codex' },
                      { value: 'claude', label: 'Claude' },
                    ]}
                  />
                </div>
              }
            >
              <CatalogSkillList
                entries={filteredCatalog}
                target={target}
                emptyTitle="No catalog skills matched"
                installLabel={installScope === 'project' ? 'Install to project' : 'Install globally'}
                installIcon={installScope === 'project' ? <Hammer size={13} /> : <Globe2 size={13} />}
                getInstallState={(entry) => {
                  const key = catalogInstallKey(entry, installScope, selectedProjectId, target);
                  const installed = installedKeys.has(skillKey(entry.name, target));
                  return {
                    installed,
                    installing: catalogInstallingKey === key,
                    disabled: !destinationReady || installCatalogSkill.isPending,
                    label: installed ? 'Installed' : !destinationReady ? 'Choose project' : undefined,
                  };
                }}
                onInstall={(entry) => {
                  if (!destinationReady) return;
                  installCatalogSkill.mutate({ entry, scope: installScope, projectId: selectedProjectId, target });
                }}
              />
            </SkillSection>
          </div>

          <aside className="space-y-8">
            <SkillSection
              icon={installScope === 'project' ? <Hammer size={15} /> : <Globe2 size={15} />}
              title="Destination"
              meta={<span className="text-xs text-dim">Applies to catalog and path installs</span>}
            >
              <SkillChoiceGroup
                label="Install to"
                value={installScope}
                onChange={setInstallScope}
                options={[
                  { value: 'project', label: 'Project', hint: selectedProject?.name ?? 'Choose', disabled: !canInstallToProject },
                  { value: 'global', label: 'Global', hint: 'All projects' },
                ]}
              />
              {installScope === 'project' && (
                <div className="mt-3">
                  <ProjectPicker
                    projects={safeProjects}
                    selectedProject={selectedProject}
                    selectedProjectId={selectedProjectId}
                    onSelect={setSelectedProjectId}
                  />
                </div>
              )}
            </SkillSection>

            <SkillSection
              icon={<PackagePlus size={15} />}
              title="Install from path"
              meta={<span className="text-xs text-dim">Local skill directory</span>}
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
                scopeOptions={[]}
                pending={installFromPath.isPending}
                disabled={!sourcePath.trim() || !destinationReady}
                error={error}
                onSubmit={() => installFromPath.mutate({ sourcePath: sourcePath.trim(), target, mode, scope: installScope, projectId: selectedProjectId })}
              />
            </SkillSection>

            <SkillSection
              icon={<BookOpen size={15} />}
              title="Catalog sources"
              meta={<span className="text-xs text-dim">{sources.length} configured</span>}
              actions={
                <Button
                  size="xs"
                  variant="secondary"
                  icon={<RefreshCcw size={13} />}
                  loading={refreshCatalog.isPending}
                  onClick={() => refreshCatalog.mutate()}
                >
                  Refresh
                </Button>
              }
            >
              <div className="space-y-1">
                {sources.map((source) => (
                  <div key={source.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--color-card-hover)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{source.name}</span>
                        {source.builtIn && <span className="rounded-md bg-[var(--color-inset)] px-1.5 py-0.5 text-[10px] text-dim">built-in</span>}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-dim">{source.repoUrl}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-dim">
                        {source.cachedAt ? <span>{formatCatalogCacheTime(source.cachedAt)}</span> : <span>{source.cachePath ? 'Not cached yet' : 'Local source'}</span>}
                        {source.commit && <span className="min-w-0 truncate font-mono">{source.commit.slice(0, 7)}</span>}
                      </div>
                    </div>
                    {!source.builtIn && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Trash2 size={13} />}
                        loading={deleteCatalogSource.isPending}
                        onClick={() => deleteCatalogSource.mutate(source)}
                        title="Remove catalog source"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                <V2Input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Catalog name" className="w-full" />
                <V2Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Git URL or local path" className="w-full" />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                  <V2Input value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} placeholder="main" />
                  <V2Input value={sourcePrefixes} onChange={(event) => setSourcePrefixes(event.target.value)} placeholder="skills/" />
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  loading={addCatalogSource.isPending}
                  disabled={!sourceName.trim() || !sourceUrl.trim()}
                  onClick={() => addCatalogSource.mutate()}
                >
                  Add catalog
                </Button>
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

function parsePrefixes(value: string) {
  const prefixes = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return prefixes.length > 0 ? prefixes : ['skills/'];
}

function ProjectPicker({
  projects,
  selectedProject,
  selectedProjectId,
  onSelect,
}: {
  projects: Project[];
  selectedProject?: Project;
  selectedProjectId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--color-inset)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-card-hover)]"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-medium uppercase text-dim">Project</span>
          <span className="mt-0.5 block truncate">{selectedProject?.name ?? 'Choose project'}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-64 overflow-auto rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
          {projects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-dim">No active projects available.</div>
          ) : (
            projects.map((project) => {
              const active = project.id === selectedProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    onSelect(project.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    active
                      ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="min-w-0 truncate">{project.name}</span>
                  {active && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function skillKey(name: string, target: string) {
  return `${target}:${name}`;
}

function catalogInstallKey(entry: SkillCatalogEntry, scope: InstallScope, projectId: string | undefined, target: SkillTarget) {
  return `${scope}:${projectId ?? 'global'}:${target}:${entry.sourceId}:${entry.skillPath}`;
}

function formatCatalogCacheTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Cached';
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
