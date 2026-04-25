import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe2, Link2, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import { v2Api } from '../../api/v2';

export function V2ProjectSkillsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [sourcePath, setSourcePath] = useState('');
  const [target, setTarget] = useState<'agents' | 'codex' | 'claude'>('agents');
  const [mode, setMode] = useState<'symlink' | 'copy'>('symlink');
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

  const installSkill = useMutation({
    mutationFn: (input: { sourcePath: string; target: string; mode: 'symlink' | 'copy'; name?: string }) =>
      v2Api.installProjectSkill(id!, input),
    onSuccess: async () => {
      setSourcePath('');
      await queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] });
    },
  });

  const removeSkill = useMutation({
    mutationFn: (input: { target: string; name: string }) => v2Api.deleteProjectSkill(id!, input.target, input.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] });
    },
  });

  const installCatalogSkill = useMutation({
    mutationFn: (input: { sourceId: string; skillPath: string; target: string; name: string }) =>
      v2Api.installCatalogSkill(id!, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] });
    },
  });

  const filteredCatalog = useMemo(() => {
    const entries = catalog ?? [];
    if (!deferredCatalogSearch) return entries;
    return entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.name} ${entry.sourceName} ${entry.description ?? ''}`.toLowerCase();
      return haystack.includes(deferredCatalogSearch);
    });
  }, [catalog, deferredCatalogSearch]);

  return (
    <div className="flex h-full flex-col overflow-auto px-6 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={project ? `/v2/projects/${project.id}` : '/v2'}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ArrowLeft size={15} />
            Back to workspace
          </Link>
          <div className="mt-4 text-[11px] uppercase tracking-[0.28em] text-neutral-500">Project skills</div>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.05em] text-neutral-950">
            {project?.name ?? 'Project'}
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-7 text-neutral-600">
            Filesystem-backed Agent Skills for this project. Install by linking or copying a standard skill directory into the
            project’s agent-specific skill roots.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <section className="min-h-0 overflow-auto rounded-[1.7rem] border border-white/70 bg-white/76 px-5 py-5 shadow-[0_18px_34px_rgba(30,20,8,0.05)]">
          <div className="mb-4 text-sm font-medium text-neutral-950">Installed in this project</div>
          <div className="space-y-3">
            {(skills?.installed ?? []).map((skill) => (
              <div key={`${skill.target}-${skill.name}`} className="rounded-[1.2rem] border border-black/8 bg-[#faf8f4] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-neutral-950">{skill.title}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">
                      {skill.target} · {skill.symlinked ? 'symlinked' : 'copied'}
                    </div>
                    {skill.description && <div className="mt-2 text-sm text-neutral-600">{skill.description}</div>}
                    <div className="mt-2 break-all text-xs text-neutral-500">{skill.path}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSkill.mutate({ target: skill.target, name: skill.name })}
                    disabled={removeSkill.isPending}
                    className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {(skills?.installed.length ?? 0) === 0 && (
              <div className="rounded-[1.3rem] border border-dashed border-black/10 bg-[#faf8f4] px-6 py-8 text-sm text-neutral-500">
                No project-specific skills installed yet.
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 overflow-auto rounded-[1.7rem] border border-white/70 bg-white/76 px-5 py-5 shadow-[0_18px_34px_rgba(30,20,8,0.05)]">
          <div className="mb-4 text-sm font-medium text-neutral-950">Install skill</div>
          <div className="space-y-3">
            <label className="block">
              <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Source path</div>
              <input
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
                placeholder="/path/to/skill-directory"
                className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Target</div>
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value as 'agents' | 'codex' | 'claude')}
                  className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none"
                >
                  <option value="agents">agents</option>
                  <option value="codex">codex</option>
                  <option value="claude">claude</option>
                </select>
              </label>
              <label>
                <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Mode</div>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'symlink' | 'copy')}
                  className="w-full rounded-2xl border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-900 outline-none"
                >
                  <option value="symlink">symlink</option>
                  <option value="copy">copy</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={() => installSkill.mutate({ sourcePath: sourcePath.trim(), target, mode })}
              disabled={installSkill.isPending || !sourcePath.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {installSkill.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Install skill
            </button>
            {installSkill.error instanceof Error && (
              <div className="text-sm text-red-600">{installSkill.error.message}</div>
            )}
          </div>

          <div className="mt-6 border-t border-black/6 pt-5">
            <div className="mb-3 text-sm font-medium text-neutral-950">Available globally</div>
            <div className="space-y-2">
              {(skills?.available ?? []).map((skill) => (
                <div key={`${skill.target}-${skill.name}`} className="rounded-[1.1rem] bg-[#faf8f4] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-neutral-900">{skill.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">{skill.target}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        installSkill.mutate({
                          sourcePath: skill.sourcePath ?? skill.path,
                          target: skill.target,
                          mode: 'symlink',
                          name: skill.name,
                        })
                      }
                      disabled={installSkill.isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm text-neutral-700 disabled:opacity-50"
                    >
                      <Link2 size={14} />
                      Link
                    </button>
                  </div>
                </div>
              ))}
              {(skills?.available.length ?? 0) === 0 && (
                <div className="rounded-[1.1rem] bg-[#faf8f4] px-4 py-3 text-sm text-neutral-500">No global skills discovered.</div>
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-black/6 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-950">
              <Globe2 size={15} />
              Curated online catalogs
            </div>
            <div className="mb-3 flex items-center gap-3 rounded-[1.1rem] bg-[#faf8f4] px-4 py-3">
              <Search size={15} className="text-neutral-400" />
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Search remote skills..."
                className="w-full bg-transparent text-sm text-neutral-900 outline-none"
              />
            </div>
            <div className="space-y-2">
              {filteredCatalog.map((entry) => (
                <div key={`${entry.sourceId}:${entry.skillPath}`} className="rounded-[1.1rem] bg-[#faf8f4] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-neutral-900">{entry.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">{entry.sourceName}</div>
                      {entry.description && <div className="mt-2 text-sm text-neutral-600">{entry.description}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        installCatalogSkill.mutate({
                          sourceId: entry.sourceId,
                          skillPath: entry.skillPath,
                          target: 'agents',
                          name: entry.name,
                        })
                      }
                      disabled={installCatalogSkill.isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm text-neutral-700 disabled:opacity-50"
                    >
                      <Plus size={14} />
                      Install
                    </button>
                  </div>
                </div>
              ))}
              {filteredCatalog.length === 0 && (
                <div className="rounded-[1.1rem] bg-[#faf8f4] px-4 py-3 text-sm text-neutral-500">
                  No remote skills matched that search.
                </div>
              )}
              {installCatalogSkill.error instanceof Error && (
                <div className="text-sm text-red-600">{installCatalogSkill.error.message}</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
