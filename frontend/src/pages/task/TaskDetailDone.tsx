import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Archive, ArchiveRestore } from 'lucide-react';
import { TaskHeader } from './TaskHeader';
import { TaskGitMetaBar } from './TaskGitMetaBar';
import { BaseDiffExplorer } from '../../components/git';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';

interface Props {
  task: Task;
  project?: Project;
}

export function TaskDetailDone({ task, project }: Props) {
  const queryClient = useQueryClient();
  const { closePanel } = usePanelNavigation();
  const isArchived = !!task.archivedAt;

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
  });

  const handleReopen = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const handleToggleArchive = () => {
    if (!isArchived) {
      // Archiving: close panel since the task will disappear from the board
      updateTask.mutate({ archived: true }, {
        onSuccess: () => {
          invalidateTaskQueries(queryClient, task.id);
          closePanel();
        },
      });
    } else {
      updateTask.mutate({ archived: false });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={isArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
              onClick={handleToggleArchive}
              disabled={updateTask.isPending}
            >
              {isArchived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={12} />}
              onClick={handleReopen}
              disabled={updateTask.isPending}
            >
              Reopen
            </Button>
          </>
        }
      />

      <TaskGitMetaBar task={task} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl space-y-6">
          {/* Diff view if worktree still exists */}
          {task.worktreePath && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Changes</h3>
              <Card padding="none" className="overflow-hidden h-[28rem] md:h-[34rem]">
                <BaseDiffExplorer taskId={task.id} />
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
