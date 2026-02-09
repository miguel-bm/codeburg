import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';

interface Props {
  task: Task;
  project?: Project;
}

function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'task';
}

export function TaskDetailBacklog({ task, project }: Props) {
  const queryClient = useQueryClient();

  const [branchValue, setBranchValue] = useState(task.branch || '');
  const [editingBranch, setEditingBranch] = useState(false);

  useEffect(() => {
    if (!editingBranch) setBranchValue(task.branch || '');
  }, [task.branch, editingBranch]);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
  });

  const handleBranchSave = () => {
    const trimmed = branchValue.trim();
    if (trimmed !== (task.branch || '')) {
      updateTask.mutate({ branch: trimmed || undefined });
    }
    setEditingBranch(false);
  };

  const handleStartWorking = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const branchDisplay = task.branch || slugify(task.title);
  const isAutoBranch = !task.branch;

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <button
            onClick={handleStartWorking}
            disabled={updateTask.isPending}
            className="px-4 py-1.5 bg-accent text-white font-medium text-sm rounded-md hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {updateTask.isPending ? 'Starting...' : 'Start Working'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Branch override */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Branch</span>
              {!editingBranch && (
                <button
                  onClick={() => setEditingBranch(true)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-accent transition-colors"
                >
                  edit
                </button>
              )}
            </div>
            {editingBranch ? (
              <input
                type="text"
                value={branchValue}
                onChange={(e) => setBranchValue(e.target.value)}
                onBlur={handleBranchSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBranchSave();
                  if (e.key === 'Escape') { setBranchValue(task.branch || ''); setEditingBranch(false); }
                }}
                placeholder={slugify(task.title)}
                className="w-full bg-transparent border border-accent rounded-lg px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:outline-none shadow-accent"
                autoFocus
              />
            ) : (
              <div
                onClick={() => setEditingBranch(true)}
                className="cursor-text border border-transparent hover:border-[var(--color-border)] rounded-lg px-3 py-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-accent">{branchDisplay}</span>
                  {isAutoBranch && (
                    <span className="text-[10px] text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-full px-1.5 py-px uppercase tracking-wider">
                      auto
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Start working CTA for mobile */}
          <div className="sm:hidden">
            <button
              onClick={handleStartWorking}
              disabled={updateTask.isPending}
              className="w-full px-4 py-3 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {updateTask.isPending ? 'Starting...' : 'Start Working'}
            </button>
            <p className="text-[10px] text-[var(--color-text-secondary)] text-center mt-1.5 uppercase tracking-wider">
              Creates worktree &amp; branch
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
