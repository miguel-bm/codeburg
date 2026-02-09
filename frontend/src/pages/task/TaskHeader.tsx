import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pin, Trash2 } from 'lucide-react';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';

interface TaskHeaderProps {
  task: Task;
  project?: Project;
  actions?: ReactNode;
  expandable?: boolean;
}

export const statusColors: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'bg-[var(--color-status-backlog)]/15 text-[var(--color-status-backlog)]',
  [TASK_STATUS.IN_PROGRESS]: 'bg-[var(--color-status-in-progress)]/15 text-[var(--color-status-in-progress)]',
  [TASK_STATUS.IN_REVIEW]: 'bg-[var(--color-status-in-review)]/15 text-[var(--color-status-in-review)]',
  [TASK_STATUS.DONE]: 'bg-[var(--color-status-done)]/15 text-[var(--color-status-done)]',
};

export const statusLabels: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'backlog',
  [TASK_STATUS.IN_PROGRESS]: 'in progress',
  [TASK_STATUS.IN_REVIEW]: 'in review',
  [TASK_STATUS.DONE]: 'done',
};

export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function TaskHeader({ task, project, actions, expandable = true }: TaskHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(task.description || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sync when task data refreshes
  useEffect(() => {
    if (!editingTitle) setTitleValue(task.title);
  }, [task.title, editingTitle]);
  useEffect(() => {
    if (!editingDesc) setDescValue(task.description || '');
  }, [task.description, editingDesc]);

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

  const handleTogglePin = () => {
    updateTask.mutate({ pinned: !task.pinned });
  };

  return (
    <header className="bg-secondary border-b border-subtle shrink-0">
      {/* Compact bar — always visible */}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
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
          {expandable && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-dim hover:text-[var(--color-text-primary)] transition-colors shrink-0"
              title={expanded ? 'collapse details' : 'expand details'}
            >
              <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Expandable detail panel */}
      {expandable && expanded && (
        <div className="border-t border-subtle px-4 py-3 space-y-3">
          {/* Editable title */}
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-dim">Title</span>
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
                className="w-full mt-1 bg-transparent border border-accent rounded px-2 py-1 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none"
                autoFocus
              />
            ) : (
              <div
                onClick={() => setEditingTitle(true)}
                className="mt-1 cursor-text text-sm font-medium text-[var(--color-text-primary)] hover:text-accent transition-colors"
              >
                {task.title}
              </div>
            )}
          </div>

          {/* Editable description */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-dim">Description</span>
              {!editingDesc && (
                <button
                  onClick={() => setEditingDesc(true)}
                  className="text-[10px] text-dim hover:text-accent transition-colors"
                >
                  edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="mt-1">
                <textarea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setDescValue(task.description || ''); setEditingDesc(false); }
                  }}
                  rows={Math.max(3, descValue.split('\n').length + 1)}
                  className="w-full bg-transparent border border-accent rounded px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none resize-y min-h-[60px] leading-relaxed"
                  placeholder="Describe the task..."
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-1.5">
                  <button
                    onClick={() => { setDescValue(task.description || ''); setEditingDesc(false); }}
                    className="text-[10px] text-dim hover:text-[var(--color-text-primary)] px-2 py-1 rounded border border-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDescSave}
                    className="text-[10px] text-white bg-accent hover:bg-accent-dim px-2 py-1 rounded transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingDesc(true)}
                className="mt-1 cursor-text text-xs leading-relaxed min-h-[20px]"
              >
                {task.description ? (
                  <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="text-dim italic">Click to add description...</p>
                )}
              </div>
            )}
          </div>

          {/* Metadata row + actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3 text-[10px] text-dim">
              <span title={new Date(task.createdAt).toLocaleString()}>
                Created {relativeTime(task.createdAt)}
              </span>
              {task.startedAt && (
                <span title={new Date(task.startedAt).toLocaleString()}>
                  Started {relativeTime(task.startedAt)}
                </span>
              )}
              {task.completedAt && (
                <span title={new Date(task.completedAt).toLocaleString()}>
                  Completed {relativeTime(task.completedAt)}
                </span>
              )}
              {project && (
                <button
                  onClick={() => navigate(`/projects/${project.id}/settings`)}
                  className="hover:text-accent transition-colors"
                >
                  {project.name}
                </button>
              )}
              <span className="font-mono" title={task.id}>{task.id.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePin}
                disabled={updateTask.isPending}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1 ${
                  task.pinned ? 'text-accent' : 'text-dim hover:text-accent'
                }`}
                title={task.pinned ? 'Unpin' : 'Pin'}
              >
                <Pin size={11} />
                {task.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-dim hover:text-[var(--color-error)] px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-1"
              >
                <Trash2 size={11} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
    </header>
  );
}
