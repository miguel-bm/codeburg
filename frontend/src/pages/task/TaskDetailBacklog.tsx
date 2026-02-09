import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [titleValue, setTitleValue] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [descValue, setDescValue] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [branchValue, setBranchValue] = useState(task.branch || '');
  const [editingBranch, setEditingBranch] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sync when task data refreshes
  useEffect(() => {
    if (!editingTitle) setTitleValue(task.title);
  }, [task.title, editingTitle]);
  useEffect(() => {
    if (!editingDesc) setDescValue(task.description || '');
  }, [task.description, editingDesc]);
  useEffect(() => {
    if (!editingBranch) setBranchValue(task.branch || '');
  }, [task.branch, editingBranch]);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => invalidateTaskQueries(queryClient, task.id),
  });

  const deleteTask = useMutation({
    mutationFn: () => tasksApi.delete(task.id),
    onSuccess: () => {
      invalidateTaskQueries(queryClient, task.id);
      navigate('/');
    },
  });

  const handleTitleSave = () => {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask.mutate({ title: trimmed });
    } else {
      setTitleValue(task.title);
    }
    setEditingTitle(false);
  };

  const handleDescSave = () => {
    const trimmed = descValue.trim();
    if (trimmed !== (task.description || '')) {
      updateTask.mutate({ description: trimmed || undefined });
    }
    setEditingDesc(false);
  };

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

  const handleTogglePin = () => {
    updateTask.mutate({ pinned: !task.pinned });
  };

  const branchDisplay = task.branch || slugify(task.title);
  const isAutoBranch = !task.branch;

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        expandable={false}
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
          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Title</span>
              {!editingTitle && (
                <button
                  onClick={() => setEditingTitle(true)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-accent transition-colors"
                >
                  edit
                </button>
              )}
            </div>
            {editingTitle ? (
              <input
                type="text"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave();
                  if (e.key === 'Escape') { setTitleValue(task.title); setEditingTitle(false); }
                }}
                className="w-full bg-transparent border border-accent rounded-lg px-3 py-2 text-lg font-medium text-[var(--color-text-primary)] focus:outline-none shadow-accent"
                autoFocus
              />
            ) : (
              <div
                onClick={() => setEditingTitle(true)}
                className="cursor-text border border-transparent hover:border-[var(--color-border)] rounded-lg px-3 py-2 transition-colors"
              >
                <span className="text-lg font-medium">{task.title}</span>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Description</span>
              {!editingDesc && (
                <button
                  onClick={() => setEditingDesc(true)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-accent transition-colors"
                >
                  edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div>
                <textarea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setDescValue(task.description || ''); setEditingDesc(false); }
                  }}
                  rows={Math.max(4, descValue.split('\n').length + 1)}
                  className="w-full bg-transparent border border-accent rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none resize-y min-h-[80px] leading-relaxed shadow-accent"
                  placeholder="Describe the task..."
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setDescValue(task.description || ''); setEditingDesc(false); }}
                    className="text-xs text-dim hover:text-[var(--color-text-primary)] px-2.5 py-1 rounded border border-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDescSave}
                    className="text-xs text-white bg-accent hover:bg-accent-dim px-2.5 py-1 rounded transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingDesc(true)}
                className="cursor-text border border-transparent hover:border-[var(--color-border)] rounded-lg px-3 py-2 transition-colors min-h-[60px]"
              >
                {task.description ? (
                  <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{task.description}</p>
                ) : (
                  <p className="text-sm text-dim italic">Click to add description...</p>
                )}
              </div>
            )}
          </div>

          {/* Branch */}
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

          {/* Details */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] px-1">Details</span>
            <div className="mt-2 space-y-1.5 text-sm px-1">
              {project && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">project</span>
                  <button
                    onClick={() => navigate(`/projects/${project.id}/settings`)}
                    className="text-accent hover:underline transition-colors"
                  >
                    {project.name}
                  </button>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-dim w-20 shrink-0">created</span>
                <span className="text-[var(--color-text-secondary)]">{new Date(task.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-dim w-20 shrink-0">id</span>
                <span className="font-mono text-xs text-dim" title={task.id}>{task.id}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 px-1">
            <button
              onClick={handleTogglePin}
              disabled={updateTask.isPending}
              className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                task.pinned ? 'text-accent' : 'text-dim hover:text-accent'
              }`}
            >
              {task.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs text-dim hover:text-[var(--color-error)] px-2 py-1 rounded transition-colors"
            >
              Delete
            </button>
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

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-primary border border-subtle rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold mb-2">Delete task</h3>
            <p className="text-xs text-dim mb-4">
              Delete <strong className="text-[var(--color-text-primary)]">{task.title}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTask.mutate()}
                disabled={deleteTask.isPending}
                className="px-3 py-1.5 bg-[var(--color-error)] text-white rounded-md text-xs hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {deleteTask.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
