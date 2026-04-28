import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Globe2, Hammer, PackagePlus, Trash2 } from 'lucide-react';
import { v2Api } from '../../api/v2';
import { Button, V2Screen } from './v2-ui';
import { SkillList, SkillSection } from './V2SkillsShared';

export function V2GlobalSkillsPage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project') || undefined;
  const queryClient = useQueryClient();

  const { data: skills = [] } = useQuery({
    queryKey: ['v2-global-skills'],
    queryFn: () => v2Api.listSkills(),
  });

  const safeSkills = Array.isArray(skills) ? skills : [];
  const backTo = projectId ? `/projects/${projectId}/skills` : '/';

  const invalidateSkills = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-project-skills'] }),
    ]);
  };

  const removeSkill = useMutation({
    mutationFn: (input: { target: string; name: string }) => v2Api.deleteGlobalSkill(input.target, input.name),
    onSuccess: invalidateSkills,
  });

  const error = removeSkill.error;

  return (
    <V2Screen>
      <header className="shrink-0 bg-canvas px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link to={backTo} className="mt-1 rounded-md p-1.5 text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title={projectId ? 'Back to project skills' : 'Back home'}>
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-dim">Global skills</div>
              <h1 className="mt-1 truncate text-lg font-semibold">Shared skill library</h1>
              <div className="mt-1 text-xs text-dim">{safeSkills.length} installed across user skill roots</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to={projectId ? `/skills/discover?scope=global&project=${projectId}` : '/skills/discover?scope=global'}>
              <Button size="sm" variant="primary" icon={<PackagePlus size={14} />}>Discover</Button>
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
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <SkillSection
              icon={<Globe2 size={15} />}
              title="Installed globally"
              meta={<span className="text-xs text-dim">{safeSkills.length} installed</span>}
              actions={<Link to={projectId ? `/skills/discover?scope=global&project=${projectId}` : '/skills/discover?scope=global'}><Button size="xs" variant="secondary" icon={<PackagePlus size={13} />}>Install</Button></Link>}
            >
              <SkillList
                skills={safeSkills}
                emptyTitle="No global skills installed"
                emptyBody="Use discovery to install from a catalog or local directory."
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
          </div>

          <aside className="space-y-8">
            <SkillSection icon={<PackagePlus size={15} />} title="Install flow" meta={<span className="text-xs text-dim">Catalogs and local folders</span>}>
              <div className="space-y-3 text-sm leading-5 text-[var(--color-text-secondary)]">
                <p>Discovery keeps catalog search, custom catalog sources, and local-folder installs separate from day-to-day management.</p>
                <Link to={projectId ? `/skills/discover?scope=global&project=${projectId}` : '/skills/discover?scope=global'}>
                  <Button className="w-full" size="sm" variant="primary" icon={<PackagePlus size={14} />}>Open discovery</Button>
                </Link>
              </div>
              {error instanceof Error && <div className="mt-3 text-xs text-[var(--color-error)]">{error.message}</div>}
            </SkillSection>

            <SkillSection icon={<Hammer size={15} />} title="Paths" meta={<span className="text-xs text-dim">Global roots</span>}>
              <div className="space-y-3 text-xs leading-5 text-dim">
                <PathRow label="Universal" value="~/.agents/skills/<name>/SKILL.md" />
                <PathRow label="Claude" value="~/.claude/skills/<name>/SKILL.md" />
                <PathRow label="Codex legacy" value="~/.codex/skills/<name>/SKILL.md" />
              </div>
            </SkillSection>
          </aside>
        </div>
      </main>
    </V2Screen>
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
