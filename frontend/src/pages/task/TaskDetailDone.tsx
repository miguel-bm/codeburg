import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { TaskHeader } from './TaskHeader';
import { TaskGitMetaBar } from './TaskGitMetaBar';
import { BaseDiffExplorer } from '../../components/git';
import { tasksApi, invalidateTaskQueries } from '../../api';
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
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
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
            className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <RotateCcw size={12} />
            Reopen
          </button>
        }
      />

      <TaskGitMetaBar task={task} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl space-y-6">
          {/* Diff view if worktree still exists */}
          {task.worktreePath && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Changes</h3>
              <div className="border border-subtle rounded-lg overflow-hidden h-[28rem] md:h-[34rem]">
                <BaseDiffExplorer taskId={task.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
