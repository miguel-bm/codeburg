import { useState, useEffect, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, GitBranch, Maximize2, Minimize2, Pin, Trash2, X } from 'lucide-react';
import { useSetHeader } from '../../components/layout/Header';
import { Breadcrumb } from '../../components/ui/Breadcrumb';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';

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

const statusTextColorMap: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'var(--color-status-backlog)',
  [TASK_STATUS.IN_PROGRESS]: 'var(--color-status-in-progress)',
  [TASK_STATUS.IN_REVIEW]: 'var(--color-status-in-review)',
  [TASK_STATUS.DONE]: 'var(--color-status-done)',
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
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { isExpanded, toggleExpanded, navigateToPanel, closePanel } = usePanelNavigation();

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
      closePanel();
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

  // Push the compact bar into the HeaderContext
  useSetHeader(
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <Breadcrumb items={[
          ...(project ? [{ label: project.name, href: `/projects/${project.id}` }] : []),
          { label: task.title, style: { color: statusTextColorMap[task.status] } },
        ]} />
        {task.branch && (
          <span className="items-center gap-1 text-xs text-dim font-mono min-w-0 hidden sm:flex" title={task.branch}>
            <GitBranch size={11} className="shrink-0" />
            <span className="truncate">{task.branch}</span>
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
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <IconButton
          icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          onClick={toggleExpanded}
          tooltip={isExpanded ? 'Collapse panel' : 'Expand panel'}
          size="xs"
        />
        <IconButton
          icon={<X size={14} />}
          onClick={() => closePanel()}
          tooltip="Close panel"
          size="xs"
        />
      </div>
    </div>,
    `task-header-${task.id}-${task.status}-${task.title}-${project?.name ?? ''}-${expanded}-${isExpanded}`,
  );

  return (
    <>
      {/* Expandable detail panel */}
      {expandable && expanded && (
        <div className="bg-primary px-4 py-3 space-y-3 shrink-0">
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
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => { setDescValue(task.description || ''); setEditingDesc(false); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="xs"
                    onClick={handleDescSave}
                  >
                    Save
                  </Button>
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
                  onClick={() => navigateToPanel(`/projects/${project.id}/settings`)}
                  className="hover:text-accent transition-colors"
                >
                  {project.name}
                </button>
              )}
              <span className="font-mono" title={task.id}>{task.id.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                icon={<Pin size={11} />}
                onClick={handleTogglePin}
                disabled={updateTask.isPending}
                className={task.pinned ? 'text-accent' : ''}
              >
                {task.pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button
                variant="danger"
                size="xs"
                icon={<Trash2 size={11} />}
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete task"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => deleteTask.mutate()}
              loading={deleteTask.isPending}
            >
              {deleteTask.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-3">
          <p className="text-xs text-dim">
            Delete <strong className="text-[var(--color-text-primary)]">{task.title}</strong>? This cannot be undone.
          </p>
        </div>
      </Modal>
    </>
  );
}
