import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task, Project } from '../../api/types';

interface TaskHeaderProps {
  task: Task;
  project?: Project;
  actions?: ReactNode;
}

const statusColors: Record<string, string> = {
  backlog: 'status-backlog',
  in_progress: 'status-in-progress',
  in_review: 'status-in-review',
  done: 'status-done',
};

export function TaskHeader({ task, project, actions }: TaskHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="bg-secondary border-b border-subtle px-4 py-3 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(project ? `/?project=${project.id}` : '/')}
            className="text-dim hover:text-accent transition-colors shrink-0 text-sm"
          >
            {project?.name || 'back'}
          </button>
          <span className="text-dim shrink-0">/</span>
          <h1 className="text-sm font-medium truncate">{task.title}</h1>
          <span className={`text-xs shrink-0 ${statusColors[task.status] || 'text-dim'}`}>
            [{task.status}]
          </span>
          {task.branch && (
            <span className="text-xs text-dim font-mono shrink-0 hidden sm:inline">
              {task.branch}
            </span>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
