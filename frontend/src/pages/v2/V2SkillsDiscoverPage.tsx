import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, ExternalLink, Globe2, Hammer, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import type { SkillCatalogEntry, SkillCatalogSource } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen, V2Select } from './v2-ui';
import {
  CatalogSkillList,
  InstallFromPathForm,
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
  const [installScope, setInstallScope] = useState<InstallScope>(projectId ? requestedScope : 'global');
  const [target, setTarget] = useState<SkillTarget>('agents');
  const [mode, setMode] = useState<InstallMode>('symlink');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceRef, setSourceRef] = useState('main');
  const [sourcePrefixes, setSourcePrefixes] = useState('skills/');
  const deferredCatalogSearch = useDeferredValue(catalogSearch);

  useEffect(() => {
    if (!projectId && installScope === 'project') setInstallScope('global');
  }, [installScope, projectId]);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: catalog } = useQuery({
    queryKey: ['v2-skill-catalog'],
    queryFn: () => v2Api.listSkillCatalog(),
  });

  const { data: catalogSources } = useQuery({
    queryKey: ['v2-skill-catalog-sources'],
    queryFn: () => v2Api.listSkillCatalogSources(),
  });

  const catalogEntries = useMemo(() => Array.isArray(catalog) ? catalog : [], [catalog]);
  const sources = useMemo(() => Array.isArray(catalogSources) ? catalogSources : [], [catalogSources]);
  const filteredCatalog = useMemo(() => filterCatalog(catalogEntries, deferredCatalogSearch), [catalogEntries, deferredCatalogSearch]);
  const backTo = projectId ? `/projects/${projectId}/skills` : '/skills';

  const invalidateSkills = async () => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog-sources'] }),
    ];
    invalidations.push(queryClient.invalidateQueries({ queryKey: projectId ? ['v2-project-skills', projectId] : ['v2-project-skills'] }));
    await Promise.all(invalidations);
  };

  const installFromPath = useMutation({
    mutationFn: (input: { sourcePath: string; target: SkillTarget; mode: InstallMode; scope: InstallScope; name?: string }) => {
      const payload = { sourcePath: input.sourcePath, target: input.target, mode: input.mode, name: input.name };
      if (input.scope === 'project' && projectId) return v2Api.installProjectSkill(projectId, payload);
      return v2Api.installGlobalSkill(payload);
    },
    onSuccess: async () => {
      setSourcePath('');
      await invalidateSkills();
    },
  });

  const installCatalogSkill = useMutation({
    mutationFn: ({ entry, scope }: { entry: SkillCatalogEntry; scope: InstallScope }) => {
      const input = { sourceId: entry.sourceId, skillPath: entry.skillPath, target, name: entry.name };
      if (scope === 'project' && projectId) return v2Api.installCatalogSkill(projectId, input);
      return v2Api.installGlobalCatalogSkill(input);
    },
    onSuccess: invalidateSkills,
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

  const error = installFromPath.error || installCatalogSkill.error || addCatalogSource.error || deleteCatalogSource.error;

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
              <div className="mt-1 text-xs text-dim">{filteredCatalog.length} matches from {sources.length} sources</div>
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
              meta={<span className="text-xs text-dim">Install a copy into a project or the global library</span>}
              actions={
                <div className="flex items-center gap-2">
                  <V2Input
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    placeholder="Search catalog"
                    className="w-52"
                  />
                  <V2Select
                    value={target}
                    onChange={(event) => setTarget(event.target.value as SkillTarget)}
                    className="text-xs"
                  >
                    <option value="agents">agents</option>
                    <option value="codex">codex</option>
                    <option value="claude">claude</option>
                  </V2Select>
                </div>
              }
            >
              <CatalogSkillList
                entries={filteredCatalog}
                target={target}
                installing={installCatalogSkill.isPending}
                emptyTitle="No catalog skills matched"
                onInstallProject={projectId ? (entry) => installCatalogSkill.mutate({ entry, scope: 'project' }) : undefined}
                onInstallGlobal={(entry) => installCatalogSkill.mutate({ entry, scope: 'global' })}
              />
            </SkillSection>
          </div>

          <aside className="space-y-8">
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
                scopeOptions={projectId ? ['project', 'global'] : ['global']}
                pending={installFromPath.isPending}
                disabled={!sourcePath.trim()}
                error={error}
                onSubmit={() => installFromPath.mutate({ sourcePath: sourcePath.trim(), target, mode, scope: installScope })}
              />
            </SkillSection>

            <SkillSection
              icon={<BookOpen size={15} />}
              title="Catalog sources"
              meta={<span className="text-xs text-dim">{sources.length} configured</span>}
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

            <SkillSection
              icon={projectId ? <Hammer size={15} /> : <Globe2 size={15} />}
              title="Destination"
              meta={<span className="text-xs text-dim">Where installs land</span>}
            >
              <div className="space-y-2 text-xs leading-5 text-dim">
                {projectId && <DestinationRow label="Project" value={project?.name ?? 'Selected project'} active={installScope === 'project'} />}
                <DestinationRow label="Global" value="Shared user skill roots" active={installScope === 'global'} />
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

function DestinationRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-[var(--color-card-hover)]">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase text-dim">{label}</div>
        <div className="mt-0.5 truncate text-[var(--color-text-secondary)]">{value}</div>
      </div>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-accent' : 'bg-[var(--color-inset)]'}`} />
    </div>
  );
}
