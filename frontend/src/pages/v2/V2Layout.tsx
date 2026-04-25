import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2, MessageSquareText, Search, Settings, Sparkles } from 'lucide-react';
import { projectsApi } from '../../api';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { Badge } from '../../components/ui/Badge';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';

export function V2Layout() {
  const location = useLocation();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });

  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-[var(--color-text-primary)]">
      <aside
        className="flex w-[18rem] shrink-0 flex-col border-r border-[var(--color-card-border)] bg-canvas"
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
            <span className="truncate">Projects, conversations, skills</span>
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
                <div key={index} className="h-12 rounded-lg bg-[var(--color-card)] opacity-60" />
              ))}
            </div>
          )}

          {(projects ?? []).map((project) => {
            const active = location.pathname.startsWith(`/v2/projects/${project.id}`);
            return (
              <Link
                key={project.id}
                to={`/v2/projects/${project.id}`}
                className={`group block rounded-lg px-3 py-2.5 transition-colors ${
                  active
                    ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 size={15} className={active ? 'text-accent' : 'text-dim'} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
                </div>
                <div className="mt-1 truncate pl-6 text-xs text-dim">{project.defaultBranch}</div>
              </Link>
            );
          })}
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
            Workspace-first preview
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
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
