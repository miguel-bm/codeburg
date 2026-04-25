import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  FolderGit2,
  GitBranch,
  MessageSquareText,
  Plus,
  Search,
  Settings,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Project, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';

export function V2Layout() {
  const location = useLocation();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });

  const workspaceQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['v2-workspaces', project.id],
      queryFn: () => v2Api.listWorkspaces(project.id),
      enabled: !!project.id,
      staleTime: 30_000,
    })),
  });

  const workspacesByProject = new Map<string, Workspace[]>();
  (projects ?? []).forEach((project, index) => {
    workspacesByProject.set(project.id, workspaceQueries[index]?.data ?? []);
  });

  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-[var(--color-text-primary)]">
      <aside
        className="flex w-[19.5rem] shrink-0 flex-col border-r border-[var(--color-card-border)] bg-canvas"
        style={desktopTopInset > 0 ? { paddingTop: `${desktopTopInset}px` } : undefined}
      >
        <div className="flex h-12 items-center justify-between px-3">
          <Link to="/v2" className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-card)]">
            <CodeburgIcon size={22} />
            <CodeburgWordmark className="text-[var(--color-text-primary)]" />
          </Link>
          <Badge variant="count">V2</Badge>
        </div>

        <div className="px-3 pb-3">
          <div className="flex h-8 items-center gap-2 rounded-lg bg-[var(--color-card)] px-2.5 text-xs text-dim">
            <Search size={14} />
            <span className="truncate">Search soon: projects, threads, files</span>
          </div>
        </div>

        <nav className="space-y-1 px-2">
          <V2NavLink
            to="/v2"
            active={location.pathname === '/v2'}
            icon={<FolderGit2 size={15} />}
            label="Projects"
          />
          <V2NavLink
            to="/v2/conversations"
            active={location.pathname.startsWith('/v2/conversations')}
            icon={<MessageSquareText size={15} />}
            label="Conversations"
          />
        </nav>

        <div className="mt-5 flex items-center justify-between px-4 text-[11px] font-medium uppercase tracking-wide text-dim">
          <span>Projects</span>
          <span>{projects?.length ?? 0}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {isLoading && (
            <div className="space-y-2 px-2 py-1">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-16 rounded-lg bg-[var(--color-card)] opacity-60" />
              ))}
            </div>
          )}

          {(projects ?? []).map((project) => (
            <ProjectTree
              key={project.id}
              project={project}
              workspaces={workspacesByProject.get(project.id) ?? []}
              pathname={location.pathname}
              search={location.search}
            />
          ))}
        </div>

        <div className="border-t border-[var(--color-card-border)] p-2">
          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
          >
            <Settings size={15} />
            Settings
          </Link>
          <div className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-dim">
            <Sparkles size={14} />
            Workspace-first V2
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function ProjectTree({
  project,
  workspaces,
  pathname,
  search,
}: {
  project: Project;
  workspaces: Workspace[];
  pathname: string;
  search: string;
}) {
  const projectActive = pathname.startsWith(`/v2/projects/${project.id}`);
  const selectedWorkspaceId = new URLSearchParams(search).get('workspace');
  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return (
    <div className="mb-1">
      <Link
        to={`/v2/projects/${project.id}`}
        className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
          projectActive
            ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <FolderGit2 size={15} className={projectActive ? 'text-accent' : 'text-dim'} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
        <Plus size={13} className="text-dim opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>

      {projectActive && (
        <div className="mt-1 space-y-0.5 pl-5 pr-1">
          {orderedWorkspaces.map((workspace) => {
            const active = selectedWorkspaceId
              ? selectedWorkspaceId === workspace.id
              : workspace.kind === 'main';
            return (
              <Link
                key={workspace.id}
                to={`/v2/projects/${project.id}?workspace=${workspace.id}`}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                    : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {workspace.kind === 'main' ? <TerminalSquare size={13} /> : <GitBranch size={13} />}
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                <span className="shrink-0 text-[10px] uppercase">{workspace.status}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function V2NavLink({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={`flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
        active
          ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
