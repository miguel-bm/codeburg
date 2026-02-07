import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../../api';
import { useAuthStore } from '../../stores/auth';

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const navigate = useNavigate();
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
                <div className="flex items-center justify-between px-3 py-2 text-sm hover:text-accent hover:bg-tertiary transition-colors group">
                  <span>{project.name}</span>
                  <button
                    onClick={() => { navigate(`/projects/${project.id}/settings`); onClose?.(); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-dim hover:text-accent transition-all"
                    title="settings"
                  >
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                    </svg>
                  </button>
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
