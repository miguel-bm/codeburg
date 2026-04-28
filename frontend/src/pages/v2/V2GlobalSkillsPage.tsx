import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Globe2, PackagePlus, Search, Trash2 } from 'lucide-react';
import type { SkillCatalogEntry } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Input, V2Screen } from './v2-ui';
import {
  CatalogSkillList,
  InstallFromPathForm,
  SkillList,
  SkillSection,
  type InstallMode,
  type SkillTarget,
} from './V2SkillsShared';

export function V2GlobalSkillsPage() {
  const queryClient = useQueryClient();
  const [sourcePath, setSourcePath] = useState('');
  const [target, setTarget] = useState<SkillTarget>('agents');
  const [mode, setMode] = useState<InstallMode>('symlink');
  const [catalogSearch, setCatalogSearch] = useState('');
  const deferredCatalogSearch = useDeferredValue(catalogSearch);

  const { data: skills = [] } = useQuery({
    queryKey: ['v2-global-skills'],
    queryFn: () => v2Api.listSkills(),
  });

  const { data: catalog } = useQuery({
    queryKey: ['v2-skill-catalog'],
    queryFn: () => v2Api.listSkillCatalog(),
  });

  const safeSkills = Array.isArray(skills) ? skills : [];
  const catalogEntries = useMemo(() => Array.isArray(catalog) ? catalog : [], [catalog]);
  const filteredCatalog = useMemo(() => filterCatalog(catalogEntries, deferredCatalogSearch), [catalogEntries, deferredCatalogSearch]);

  const invalidateSkills = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-skill-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-project-skills'] }),
    ]);
  };

  const installFromPath = useMutation({
    mutationFn: () => v2Api.installGlobalSkill({ sourcePath: sourcePath.trim(), target, mode }),
    onSuccess: async () => {
      setSourcePath('');
      await invalidateSkills();
    },
  });

  const installCatalogSkill = useMutation({
    mutationFn: (entry: SkillCatalogEntry) => v2Api.installGlobalCatalogSkill({
      sourceId: entry.sourceId,
      skillPath: entry.skillPath,
      target,
      name: entry.name,
    }),
    onSuccess: invalidateSkills,
  });

  const removeSkill = useMutation({
    mutationFn: (input: { target: string; name: string }) => v2Api.deleteGlobalSkill(input.target, input.name),
    onSuccess: invalidateSkills,
  });

  const error = installFromPath.error || installCatalogSkill.error || removeSkill.error;

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to="/settings" className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Back to settings">
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Global skills</div>
              <h1 className="mt-1 truncate text-lg font-semibold">Shared skill library</h1>
              <div className="mt-1 text-xs text-dim">{safeSkills.length} installed across user skill roots</div>
            </div>
          </div>
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
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-2 md:px-6">
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <SkillSection
              icon={<Globe2 size={15} />}
              title="Installed globally"
              meta={<span className="text-xs text-dim">{safeSkills.length} installed</span>}
            >
              <SkillList
                skills={safeSkills}
                emptyTitle="No global skills installed"
                emptyBody="Install from the catalog or link a local skill directory."
                actions={(skill) => (
                  <Button
                    size="xs"
                    variant="danger"
                    icon={<Trash2 size={13} />}
                    loading={removeSkill.isPending}
                    onClick={() => removeSkill.mutate({ target: skill.target, name: skill.name })}
                  >
                    Remove
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
                onInstallGlobal={(entry) => installCatalogSkill.mutate(entry)}
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
                pending={installFromPath.isPending}
                disabled={!sourcePath.trim()}
                error={error}
                onSubmit={() => installFromPath.mutate()}
              />
            </SkillSection>

            <SkillSection icon={<Globe2 size={15} />} title="Paths" meta={<span className="text-xs text-dim">Standards</span>}>
              <div className="space-y-3 text-xs leading-5 text-dim">
                <PathRow label="Universal global" value="~/.agents/skills/<name>/SKILL.md" />
                <PathRow label="Claude global" value="~/.claude/skills/<name>/SKILL.md" />
                <PathRow label="Codex legacy" value="~/.codex/skills/<name>/SKILL.md" />
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
