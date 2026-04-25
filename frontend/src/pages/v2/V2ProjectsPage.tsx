import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderGit2, MessageSquareText, SquareTerminal } from 'lucide-react';
import { projectsApi } from '../../api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export function V2ProjectsPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--color-text-primary)]">V2 Projects</div>
          <div className="text-xs text-dim">Project, workspace, and conversation entry point</div>
        </div>
        <Badge variant="count">{projects?.length ?? 0}</Badge>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid max-w-5xl gap-3">
          {isLoading && <Card className="text-sm text-dim">Loading projects...</Card>}

          {(projects ?? []).map((project) => (
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

          {!isLoading && (projects?.length ?? 0) === 0 && (
            <Card className="text-sm text-dim">
              No projects yet. Create or import one from the main Codeburg project flow.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
