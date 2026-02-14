import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, GitBranch, Maximize2, Minimize2, Pin, Trash2, X, AlertTriangle } from 'lucide-react';
import { useSetHeader } from '../../components/layout/Header';
import { Breadcrumb } from '../../components/ui/Breadcrumb';
import { tasksApi, sessionsApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import { MarkdownField } from '../../components/ui/MarkdownField';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { relativeTime } from '../../utils/text';
import { useTaskEditorDrafts } from './useTaskEditorDrafts';

interface TaskHeaderProps {
  task: Task;
  project?: Project;
  actions?: ReactNode;
  expandable?: boolean;
}

const statusTextColorMap: Record<string, string> = {
  [TASK_STATUS.BACKLOG]: 'var(--color-status-backlog)',
  [TASK_STATUS.IN_PROGRESS]: 'var(--color-status-in-progress)',
  [TASK_STATUS.IN_REVIEW]: 'var(--color-status-in-review)',
  [TASK_STATUS.DONE]: 'var(--color-status-done)',
};

export function TaskHeader({ task, project, actions, expandable = true }: TaskHeaderProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { isExpanded, toggleExpanded, navigateToPanel, closePanel } = usePanelNavigation();
  const hasMissingWorktree =
    task.status === TASK_STATUS.IN_PROGRESS && (!task.worktreePath || task.worktreePath.trim() === '');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch sessions when delete modal is open (for smart warnings)
  const { data: deleteSessions } = useQuery({
    queryKey: ['sessions', task.id, 'delete-check'],
    queryFn: () => sessionsApi.list(task.id),
    enabled: showDeleteConfirm,
  });

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

  const {
    editingTitle,
    titleDraft,
    editingDesc,
    descDraft,
    setTitleDraft,
    setDescDraft,
    startTitleEditing,
    saveTitle,
    cancelTitleEditing,
    startDescEditing,
    saveDesc,
    cancelDescEditing,
  } = useTaskEditorDrafts({
    task,
    onUpdate: (input) => updateTask.mutate(input),
  });

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
        {hasMissingWorktree && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/12 text-[var(--color-warning)] text-[10px] font-medium uppercase tracking-wider shrink-0"
            title="This task is in progress but has no worktree."
          >
            <AlertTriangle size={10} />
            No worktree
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
          icon={<Trash2 size={14} />}
          onClick={() => setShowDeleteConfirm(true)}
          tooltip="Delete task"
          size="xs"
          className="text-dim hover:!text-[var(--color-error)]"
        />
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
    `task-header-${task.id}-${task.status}-${task.title}-${task.worktreePath ?? ''}-${project?.name ?? ''}-${expanded}-${isExpanded}-${showDeleteConfirm}`,
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
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') cancelTitleEditing();
                }}
                className="w-full mt-1 bg-transparent border border-accent rounded px-2 py-1 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none"
                autoFocus
              />
            ) : (
              <div
                onClick={startTitleEditing}
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
                  onClick={startDescEditing}
                  className="text-[10px] text-dim hover:text-accent transition-colors"
                >
                  edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="mt-1">
                <div className="border border-accent rounded px-2 py-1.5">
                  <MarkdownField
                    value={descDraft}
                    onChange={setDescDraft}
                    textSize="xs"
                    rows={Math.max(3, descDraft.split('\n').length + 1)}
                    minHeight="60px"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') cancelDescEditing();
                    }}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 mt-1.5">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={cancelDescEditing}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="xs"
                    onClick={saveDesc}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onClick={startDescEditing}
                className="mt-1 cursor-text text-xs leading-relaxed min-h-[20px]"
              >
                {task.description ? (
                  <MarkdownRenderer className="text-xs">{task.description}</MarkdownRenderer>
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
        <div className="px-5 py-3 space-y-3">
          <p className="text-xs text-dim">
            Delete <strong className="text-[var(--color-text-primary)]">{task.title}</strong>? This cannot be undone.
          </p>
          {(task.worktreePath || task.branch || (deleteSessions && deleteSessions.length > 0)) && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-warning)]">
                <AlertTriangle size={11} />
                <span className="font-medium">The following will be cleaned up:</span>
              </div>
              <ul className="text-[11px] text-dim space-y-1 pl-5 list-disc">
                {task.worktreePath && (
                  <li>Worktree at <span className="font-mono text-[10px]">{task.worktreePath}</span></li>
                )}
                {task.branch && (
                  <li>Branch <span className="font-mono text-[10px]">{task.branch}</span></li>
                )}
                {deleteSessions && deleteSessions.length > 0 && (
                  <li>{deleteSessions.length} session{deleteSessions.length !== 1 ? 's' : ''} will be stopped</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
