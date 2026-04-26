import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderGit2, MessageSquareText, SquareTerminal } from 'lucide-react';
import { projectsApi } from '../../api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { useMobile } from '../../hooks/useMobile';

export function V2ProjectsPage() {
  const isMobile = useMobile();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });
  const visibleProjects = (projects ?? []).filter((project) => !project.hidden);

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-canvas">
        <header className="shrink-0 border-b border-[var(--color-card-border)] px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">Home</h1>
            <Badge variant="count">{visibleProjects.length}</Badge>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading && (
            <div className="px-4 py-4 text-sm text-dim">Loading projects...</div>
          )}

          <div className="divide-y divide-[var(--color-card-border)]">
            {visibleProjects.map((project) => (
              <Link
                key={project.id}
                to={`/v2/projects/${project.id}`}
                className="flex min-h-[76px] items-center gap-3 px-4 py-3 text-[var(--color-text-primary)] transition-colors active:bg-[var(--color-card-hover)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card text-accent">
                  <FolderGit2 size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-base font-semibold">{project.name}</span>
                    <span className="shrink-0 rounded-full bg-[var(--color-card)] px-2 py-0.5 text-[11px] text-dim">
                      {project.defaultBranch}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-dim">{project.path}</span>
                </span>
                <ArrowRight size={17} className="shrink-0 text-dim" />
              </Link>
            ))}
          </div>

          {!isLoading && visibleProjects.length === 0 && (
            <div className="px-4 py-10 text-sm text-dim">No projects yet.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--color-text-primary)]">V2 Projects</div>
          <div className="text-xs text-dim">Project, workspace, and conversation entry point</div>
        </div>
        <Badge variant="count">{visibleProjects.length}</Badge>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid max-w-5xl gap-3">
          {isLoading && <Card className="text-sm text-dim">Loading projects...</Card>}

          {visibleProjects.map((project) => (
            <Link key={project.id} to={`/v2/projects/${project.id}`} className="block">
              <Card hover className="transition-transform hover:-translate-y-0.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FolderGit2 size={16} className="text-accent" />
                      <h2 className="truncate text-base font-semibold">{project.name}</h2>
                    </div>
                    <div className="mt-1 truncate text-xs text-dim">{project.path}</div>
                  </div>
                  <ArrowRight size={16} className="mt-1 text-dim" />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderGit2 size={13} />
                    {project.defaultBranch}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <SquareTerminal size={13} />
                    workspace terminals
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquareText size={13} />
                    pi conversations
                  </span>
                </div>
              </Card>
            </Link>
          ))}

          {!isLoading && visibleProjects.length === 0 && (
            <Card className="text-sm text-dim">
              No projects yet. Create or import one from the main Codeburg project flow.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
