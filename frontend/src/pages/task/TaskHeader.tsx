import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';

interface TaskHeaderProps {
  task: Task;
  project?: Project;
  actions?: ReactNode;
}

const statusColors: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'bg-[var(--color-status-backlog)]/15 text-[var(--color-status-backlog)]',
  [TASK_STATUS.IN_PROGRESS]: 'bg-[var(--color-status-in-progress)]/15 text-[var(--color-status-in-progress)]',
  [TASK_STATUS.IN_REVIEW]: 'bg-[var(--color-status-in-review)]/15 text-[var(--color-status-in-review)]',
  [TASK_STATUS.DONE]: 'bg-[var(--color-status-done)]/15 text-[var(--color-status-done)]',
};

const statusLabels: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'backlog',
  [TASK_STATUS.IN_PROGRESS]: 'in progress',
  [TASK_STATUS.IN_REVIEW]: 'in review',
  [TASK_STATUS.DONE]: 'done',
};

export function TaskHeader({ task, project, actions }: TaskHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="bg-secondary border-b border-subtle px-4 py-3 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(project ? `/?project=${project.id}` : '/')}
            className="text-dim hover:text-[var(--color-text-primary)] transition-colors shrink-0 text-sm"
          >
            {project?.name || 'back'}
          </button>
          <span className="text-dim shrink-0">/</span>
          <h1 className="text-sm font-medium truncate">{task.title}</h1>
          <span className={`text-xs shrink-0 rounded-full px-2 py-0.5 font-medium ${statusColors[task.status] || 'text-dim'}`}>
            {statusLabels[task.status] || task.status}
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
