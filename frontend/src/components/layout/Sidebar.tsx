import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../../api';
import { useAuthStore } from '../../stores/auth';

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const logout = useAuthStore((s) => s.logout);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  return (
    <aside className="w-64 bg-secondary border-r border-subtle flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-subtle flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">CODEBURG</h1>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:text-accent transition-colors"
            aria-label="Close menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        )}
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs text-dim uppercase tracking-wider px-3 py-2">
          // projects ({projects?.length ?? 0})
        </div>

        {isLoading ? (
          <div className="px-3 py-2 text-sm text-dim">
            loading...
          </div>
        ) : projects?.length === 0 ? (
          <div className="px-3 py-2 text-sm text-dim">
            no projects
          </div>
        ) : (
          <ul className="space-y-1">
            {projects?.map((project) => (
              <li key={project.id}>
                <div className="px-3 py-2 text-sm hover:text-accent hover:bg-tertiary transition-colors cursor-pointer">
                  {project.name}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-subtle">
        <button
          onClick={logout}
          className="w-full px-3 py-2 text-sm text-dim hover:text-accent hover:bg-tertiary transition-colors"
        >
          logout
        </button>
      </div>
    </aside>
  );
}
