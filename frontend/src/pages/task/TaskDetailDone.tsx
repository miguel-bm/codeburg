import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { tasksApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';

interface Props {
  task: Task;
  project?: Project;
}

export function TaskDetailDone({ task, project }: Props) {
  const queryClient = useQueryClient();

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    },
  });

  const handleReopen = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <button
            onClick={handleReopen}
            disabled={updateTask.isPending}
            className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50"
          >
            Reopen
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Summary</h3>
            {task.description && (
              <p className="text-sm whitespace-pre-wrap mb-4">{task.description}</p>
            )}
            <div className="space-y-2 text-sm">
              {task.branch && (
                <div className="flex gap-4">
                  <span className="text-dim w-24">branch</span>
                  <span className="font-mono">{task.branch}</span>
                </div>
              )}
              {task.prUrl && (
                <div className="flex gap-4">
                  <span className="text-dim w-24">pull request</span>
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline font-mono text-xs"
                  >
                    {task.prUrl}
                  </a>
                </div>
              )}
              {task.diffStats && (
                <div className="flex gap-4">
                  <span className="text-dim w-24">changes</span>
                  <span>
                    <span className="text-[var(--color-success)]">+{task.diffStats.additions}</span>
                    {' / '}
                    <span className="text-[var(--color-error)]">-{task.diffStats.deletions}</span>
                  </span>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-dim w-24">created</span>
                <span>{new Date(task.createdAt).toLocaleString()}</span>
              </div>
              {task.completedAt && (
                <div className="flex gap-4">
                  <span className="text-dim w-24">completed</span>
                  <span>{new Date(task.completedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
          {/* TODO: git log of branch commits */}
        </div>
      </div>
    </div>
  );
}
