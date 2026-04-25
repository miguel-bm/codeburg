import { useDeferredValue, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, Link2, PackagePlus, Search, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import { v2Api } from '../../api/v2';
import { Button, V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Screen, V2Select } from './v2-ui';

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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] }),
  });

  const installCatalogSkill = useMutation({
    mutationFn: (input: { sourceId: string; skillPath: string; target: string; name: string }) =>
      v2Api.installCatalogSkill(id!, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] }),
  });

  const filteredCatalog = useMemo(() => {
    const entries = catalog ?? [];
    if (!deferredCatalogSearch) return entries;
    return entries.filter((entry) => `${entry.title} ${entry.name} ${entry.sourceName} ${entry.description ?? ''}`.toLowerCase().includes(deferredCatalogSearch));
  }, [catalog, deferredCatalogSearch]);

  return (
    <V2Screen>
      <V2Header
        backTo={project ? `/v2/projects/${project.id}/settings` : '/v2/settings'}
        backLabel="Back to project settings"
        eyebrow="Project skills"
        title={project?.name ?? 'Project'}
        subtitle="Skills are filesystem resources. Codeburg links or copies standard skill directories into project skill roots without inventing a private format."
      />
      <V2Content className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <V2Panel className="min-h-0 overflow-hidden">
          <V2PanelHeader title="Installed skills" subtitle={`${skills?.installed.length ?? 0} project skills`} />
          <div className="min-h-0 overflow-auto">
            {(skills?.installed ?? []).map((skill) => (
              <V2Row key={`${skill.target}-${skill.name}`} className="rounded-none border-b border-[var(--color-card-border)] px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{skill.title}</div>
                    <div className="mt-1 text-xs text-dim">{skill.target} · {skill.symlinked ? 'symlinked' : 'copied'}</div>
                    {skill.description && <div className="mt-2 text-sm text-[var(--color-text-secondary)]">{skill.description}</div>}
                    <div className="mt-2 break-all font-mono text-xs text-dim">{skill.path}</div>
                  </div>
                  <Button size="xs" variant="danger" icon={<Trash2 size={13} />} disabled={removeSkill.isPending} onClick={() => removeSkill.mutate({ target: skill.target, name: skill.name })}>
                    Remove
                  </Button>
                </div>
              </V2Row>
            ))}
            {(skills?.installed.length ?? 0) === 0 && (
              <V2Empty title="No project skills installed" body="Install a global skill, catalog skill, or link a local skill directory." />
            )}
          </div>
        </V2Panel>

        <div className="space-y-4 overflow-auto">
          <V2Panel>
            <V2PanelHeader title="Install from path" />
            <div className="space-y-3 p-4">
              <V2Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/path/to/skill-directory" className="w-full" />
              <div className="grid grid-cols-2 gap-2">
                <V2Select value={target} onChange={(event) => setTarget(event.target.value as 'agents' | 'codex' | 'claude')}>
                  <option value="agents">agents</option>
                  <option value="codex">codex</option>
                  <option value="claude">claude</option>
                </V2Select>
                <V2Select value={mode} onChange={(event) => setMode(event.target.value as 'symlink' | 'copy')}>
                  <option value="symlink">symlink</option>
                  <option value="copy">copy</option>
                </V2Select>
              </div>
              <Button className="w-full" size="sm" variant="primary" icon={<PackagePlus size={14} />} loading={installSkill.isPending} disabled={!sourcePath.trim()} onClick={() => installSkill.mutate({ sourcePath: sourcePath.trim(), target, mode })}>
                Install skill
              </Button>
              {installSkill.error instanceof Error && <div className="text-xs text-[var(--color-error)]">{installSkill.error.message}</div>}
            </div>
          </V2Panel>

          <V2Panel>
            <V2PanelHeader title="Available globally" />
            {(skills?.available ?? []).map((skill) => (
              <V2Row key={`${skill.target}-${skill.name}`} className="rounded-none border-b border-[var(--color-card-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{skill.title}</div>
                    <div className="mt-1 text-xs text-dim">{skill.target}</div>
                  </div>
                  <Button size="xs" variant="secondary" icon={<Link2 size={13} />} disabled={installSkill.isPending} onClick={() => installSkill.mutate({ sourcePath: skill.sourcePath ?? skill.path, target: skill.target, mode: 'symlink', name: skill.name })}>
                    Link
                  </Button>
                </div>
              </V2Row>
            ))}
            {(skills?.available.length ?? 0) === 0 && <V2Empty title="No global skills discovered" />}
          </V2Panel>

          <V2Panel>
            <V2PanelHeader
              title={<span className="inline-flex items-center gap-2"><Globe2 size={15} /> Catalog</span>}
              actions={<V2Input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search" className="w-36" />}
            />
            {filteredCatalog.map((entry) => (
              <V2Row key={`${entry.sourceId}:${entry.skillPath}`} className="rounded-none border-b border-[var(--color-card-border)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{entry.title}</div>
                    <div className="mt-1 text-xs text-dim">{entry.sourceName}</div>
                    {entry.description && <div className="mt-2 text-sm text-[var(--color-text-secondary)]">{entry.description}</div>}
                  </div>
                  <Button size="xs" variant="secondary" icon={<PackagePlus size={13} />} disabled={installCatalogSkill.isPending} onClick={() => installCatalogSkill.mutate({ sourceId: entry.sourceId, skillPath: entry.skillPath, target: 'agents', name: entry.name })}>
                    Install
                  </Button>
                </div>
              </V2Row>
            ))}
            {filteredCatalog.length === 0 && <V2Empty icon={<Search size={24} />} title="No catalog skills matched" />}
          </V2Panel>
        </div>
      </V2Content>
    </V2Screen>
  );
}
