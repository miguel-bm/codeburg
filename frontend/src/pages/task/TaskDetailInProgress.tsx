import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { WorkspaceProvider, Workspace } from '../../components/workspace';
import type { WorkspaceScope } from '../../components/workspace';
import { tasksApi, invalidateTaskQueries, gitApi } from '../../api';
import { TASK_STATUS } from '../../api';
import type { Task, Project, UpdateTaskResponse } from '../../api';
import { OpenInEditorButton } from '../../components/common/OpenInEditorButton';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

interface Props {
  task: Task;
  project?: Project;
}

export function TaskDetailInProgress({ task, project }: Props) {
  const queryClient = useQueryClient();
  const [warning, setWarning] = useState<string | null>(null);
  const [dirtyConfirm, setDirtyConfirm] = useState<{ staged: number; unstaged: number; untracked: number } | null>(null);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: (data: UpdateTaskResponse) => {
      invalidateTaskQueries(queryClient, data.id);
      if (data.worktreeWarning?.length) {
        setWarning(data.worktreeWarning.join('; '));
      }
      if (data.workflowError) {
        setWarning((prev) => prev ? `${prev}; ${data.workflowError}` : data.workflowError!);
      }
    },
  });

  const doMoveToReview = () => {
    setDirtyConfirm(null);
    updateTask.mutate({ status: TASK_STATUS.IN_REVIEW });
  };

  const handleMoveToReview = async () => {
    try {
      const status = await gitApi.status(task.id);
      const dirty = status.staged.length + status.unstaged.length + status.untracked.length;
      if (dirty > 0) {
        setDirtyConfirm({
          staged: status.staged.length,
          unstaged: status.unstaged.length,
          untracked: status.untracked.length,
        });
        return;
      }
    } catch {
      // If git status fails (e.g. no worktree), proceed anyway
    }
    doMoveToReview();
  };

  const scope: WorkspaceScope = project
    ? { type: 'task', taskId: task.id, task, project }
    : { type: 'task', taskId: task.id, task, project: { id: task.projectId, name: 'Project', path: '', defaultBranch: 'main', hidden: false, createdAt: '', updatedAt: '' } };

  return (
    <WorkspaceProvider scope={scope}>
      <div className="flex flex-col h-full">
        <TaskHeader
          task={task}
          project={project}
          actions={
            <>
              {task.worktreePath && <OpenInEditorButton worktreePath={task.worktreePath} />}
              <Button
                variant="primary"
                size="sm"
                onClick={handleMoveToReview}
                disabled={updateTask.isPending}
              >
                Review
              </Button>
            </>
          }
        />

        {warning && (
          <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-warning,#b8860b)]/10 border-b border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)] text-xs">
            <span>{warning}</span>
            <button onClick={() => setWarning(null)} className="ml-4 hover:text-[var(--color-text-primary)] transition-colors">
              Dismiss
            </button>
          </div>
        )}

        <Modal
          open={!!dirtyConfirm}
          onClose={() => setDirtyConfirm(null)}
          title="Uncommitted changes"
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDirtyConfirm(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={doMoveToReview}>
                Move anyway
              </Button>
            </div>
          }
        >
          <div className="px-5 py-3">
            <p className="text-xs text-dim mb-3">
              This worktree has uncommitted changes that will not be included in the review:
            </p>
            {dirtyConfirm && (
              <ul className="text-xs text-dim space-y-1">
                {dirtyConfirm.staged > 0 && <li>{dirtyConfirm.staged} staged file{dirtyConfirm.staged !== 1 ? 's' : ''}</li>}
                {dirtyConfirm.unstaged > 0 && <li>{dirtyConfirm.unstaged} unstaged file{dirtyConfirm.unstaged !== 1 ? 's' : ''}</li>}
                {dirtyConfirm.untracked > 0 && <li>{dirtyConfirm.untracked} untracked file{dirtyConfirm.untracked !== 1 ? 's' : ''}</li>}
              </ul>
            )}
          </div>
        </Modal>

        <Workspace />
      </div>
    </WorkspaceProvider>
  );
}
