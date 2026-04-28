import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookPlus, Clock3, FolderGit2, GitBranch, Search } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Project } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CreateProjectModal } from '../../components/common/CreateProjectModal';
import { useMobile } from '../../hooks/useMobile';
import { V2Empty, V2Input } from './v2-ui';

export function V2ProjectsPage() {
  const isMobile = useMobile();
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [search, setSearch] = useState('');
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });
  const visibleProjects = useMemo(
    () => (projects ?? [])
      .filter((project) => !project.hidden)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects],
  );
  const filteredProjects = useMemo(
    () => filterProjects(visibleProjects, search),
    [search, visibleProjects],
  );
  const searchActive = search.trim().length > 0;

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-canvas">
        <header className="shrink-0 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">Projects</h1>
              <div className="mt-0.5 text-xs text-dim">{visibleProjects.length} active</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="count">{visibleProjects.length}</Badge>
              <button
                type="button"
                onClick={() => setShowCreateProject(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-card text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]"
                title="New project"
                aria-label="New project"
              >
                <BookPlus size={17} />
              </button>
            </div>
          </div>
          <label className="relative mt-3 block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <V2Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects"
              className="w-full !pl-9"
            />
          </label>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          {isLoading && <ProjectSkeleton mobile />}

          {!isLoading && (
            <div className="grid gap-1">
              {filteredProjects.map((project) => (
                <ProjectDirectoryRow key={project.id} project={project} mobile />
              ))}
            </div>
          )}

          {!isLoading && filteredProjects.length === 0 && (
            <ProjectHomeEmpty
              searchActive={searchActive}
              onCreateProject={() => setShowCreateProject(true)}
            />
          )}
        </div>
        {showCreateProject && <CreateProjectModal onClose={() => setShowCreateProject(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="shrink-0 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-dim">Home</div>
            <h1 className="mt-1 truncate text-lg font-semibold text-[var(--color-text-primary)]">Projects</h1>
            <div className="mt-1 text-sm text-dim">Recent repositories and project work.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="count">{visibleProjects.length}</Badge>
            <Button size="xs" variant="primary" icon={<BookPlus size={13} />} onClick={() => setShowCreateProject(true)}>
              New project
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <section className="mx-auto flex min-h-full max-w-6xl flex-col rounded-xl bg-card shadow-[var(--shadow-card)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">Project directory</div>
              <div className="mt-0.5 text-xs text-dim">
                {filteredProjects.length === visibleProjects.length
                  ? `${visibleProjects.length} active projects`
                  : `${filteredProjects.length} of ${visibleProjects.length} projects`}
              </div>
            </div>
            <label className="relative w-full sm:w-72">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <V2Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects"
                className="w-full !pl-8"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {isLoading && <ProjectSkeleton />}

            {!isLoading && filteredProjects.length > 0 && (
              <div className="grid gap-1">
                {filteredProjects.map((project) => (
                  <ProjectDirectoryRow key={project.id} project={project} />
                ))}
              </div>
            )}

            {!isLoading && filteredProjects.length === 0 && (
              <ProjectHomeEmpty
                searchActive={searchActive}
                onCreateProject={() => setShowCreateProject(true)}
              />
            )}
          </div>
        </section>
      </main>
      {showCreateProject && <CreateProjectModal onClose={() => setShowCreateProject(false)} />}
    </div>
  );
}

function ProjectDirectoryRow({ project, mobile = false }: { project: Project; mobile?: boolean }) {
  return (
    <Link
      to={`/v2/projects/${project.id}`}
      className={`group/project grid min-w-0 items-center gap-3 rounded-lg text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-card-hover)] focus-visible:bg-[var(--color-card-hover)] ${
        mobile ? 'grid-cols-[auto_1fr_auto] px-2 py-3' : 'grid-cols-[auto_minmax(0,1fr)_auto] px-3 py-2.5'
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-accent">
        <FolderGit2 size={17} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`${mobile ? 'text-base' : 'text-sm'} truncate font-semibold`}>{project.name}</span>
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-dim sm:inline-flex">
            <GitBranch size={11} />
            {project.defaultBranch || 'main'}
          </span>
        </span>
        <span className="mt-1 block truncate text-xs text-dim">{project.path}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3 text-xs text-dim">
        {!mobile && (
          <span className="hidden items-center gap-1.5 md:inline-flex">
            <Clock3 size={13} />
            {formatRelativeDate(project.updatedAt)}
          </span>
        )}
        <ArrowRight size={16} className="transition-transform duration-150 ease-out-quart group-hover/project:translate-x-0.5" />
      </span>
    </Link>
  );
}

function ProjectSkeleton({ mobile = false }: { mobile?: boolean }) {
  const rows = mobile ? 5 : 7;

  return (
    <div className="grid gap-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`grid animate-pulse items-center gap-3 rounded-lg px-3 ${mobile ? 'grid-cols-[auto_1fr] py-3' : 'grid-cols-[auto_1fr_auto] py-2.5'}`}
        >
          <div className="h-9 w-9 rounded-md bg-secondary" />
          <div className="min-w-0">
            <div className="h-3.5 w-40 rounded bg-secondary" />
            <div className="mt-2 h-3 w-2/3 rounded bg-secondary" />
          </div>
          {!mobile && <div className="h-3 w-20 rounded bg-secondary" />}
        </div>
      ))}
    </div>
  );
}

function ProjectHomeEmpty({
  searchActive,
  onCreateProject,
}: {
  searchActive: boolean;
  onCreateProject: () => void;
}) {
  return (
    <V2Empty
      icon={<FolderGit2 size={28} />}
      title={searchActive ? 'No projects match' : 'No projects yet'}
      body={searchActive ? 'Try a broader name, path, branch, or remote.' : 'Add a repository to start here.'}
      action={
        !searchActive && (
          <Button size="sm" variant="primary" icon={<BookPlus size={14} />} onClick={onCreateProject}>
            New project
          </Button>
        )
      }
    />
  );
}

function filterProjects(projects: Project[], search: string): Project[] {
  const query = search.trim().toLowerCase();
  if (!query) return projects;

  return projects.filter((project) => {
    const text = [
      project.name,
      project.path,
      project.gitOrigin,
      project.defaultBranch,
    ].filter(Boolean).join(' ').toLowerCase();
    return text.includes(query);
  });
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return 'Updated recently';

  const diffMs = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Updated now';
  if (diffMs < hour) return `Updated ${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `Updated ${Math.max(1, Math.floor(diffMs / hour))}h ago`;
  if (diffMs < 14 * day) return `Updated ${Math.max(1, Math.floor(diffMs / day))}d ago`;
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
