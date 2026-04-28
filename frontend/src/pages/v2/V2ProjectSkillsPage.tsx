import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Globe2, Hammer, Link2, PackagePlus, Trash2 } from 'lucide-react';
import { projectsApi } from '../../api';
import type { ManagedSkill } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Screen } from './v2-ui';
import { SkillList, SkillSection } from './V2SkillsShared';

export function V2ProjectSkillsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

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

  const installed = Array.isArray(skills?.installed) ? skills.installed : [];
  const available = Array.isArray(skills?.available) ? skills.available : [];

  const invalidateSkills = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-project-skills', id] }),
      queryClient.invalidateQueries({ queryKey: ['v2-global-skills'] }),
    ]);
  };

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

  const error = linkGlobalSkill.error || removeProjectSkill.error;

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
              <div className="mt-1 text-xs text-dim">{installed.length} project installed · {available.length} global available</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to={id ? `/skills/discover?scope=project&project=${id}` : '/skills/discover'}>
              <Button size="sm" variant="primary" icon={<PackagePlus size={14} />}>Discover</Button>
            </Link>
            <Link to={id ? `/skills?project=${id}` : '/skills'}>
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
        <div className="mx-auto grid w-full max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <SkillSection
              icon={<Hammer size={15} />}
              title="Installed in this project"
              meta={<span className="text-xs text-dim">{installed.length} installed</span>}
              actions={<Link to={id ? `/skills/discover?scope=project&project=${id}` : '/skills/discover'}><Button size="xs" variant="secondary" icon={<PackagePlus size={13} />}>Install</Button></Link>}
            >
              <SkillList
                skills={installed}
                emptyTitle="No project skills installed"
                emptyBody="Install from discovery or link a global skill below."
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
              meta={<span className="text-xs text-dim">{available.length} available to link</span>}
              actions={<Link to={id ? `/skills?project=${id}` : '/skills'}><Button size="xs" variant="secondary">Manage global</Button></Link>}
            >
              <SkillList
                skills={available}
                emptyTitle="No global skills found"
                emptyBody="Install global skills once, then link them into projects as needed."
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
          </div>

          <aside className="space-y-8">
            <SkillSection icon={<PackagePlus size={15} />} title="Install flow" meta={<span className="text-xs text-dim">Catalogs and local folders</span>}>
              <div className="space-y-3 text-sm leading-5 text-[var(--color-text-secondary)]">
                <p>Use discovery to search catalogs, add a catalog source, or install a local skill directory.</p>
                <Link to={id ? `/skills/discover?scope=project&project=${id}` : '/skills/discover'}>
                  <Button className="w-full" size="sm" variant="primary" icon={<PackagePlus size={14} />}>Open discovery</Button>
                </Link>
              </div>
              {error instanceof Error && <div className="mt-3 text-xs text-[var(--color-error)]">{error.message}</div>}
            </SkillSection>

            <SkillSection icon={<Hammer size={15} />} title="Paths" meta={<span className="text-xs text-dim">Project roots</span>}>
              <div className="space-y-3 text-xs leading-5 text-dim">
                <PathRow label="Universal" value=".agents/skills/<name>/SKILL.md" />
                <PathRow label="Claude" value=".claude/skills/<name>/SKILL.md" />
                <PathRow label="Codex legacy" value=".codex/skills/<name>/SKILL.md" />
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
