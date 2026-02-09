import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { tasksApi, invalidateTaskQueries } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';
import { useMobile } from '../../hooks/useMobile';

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

function relativeTime(dateStr: string): string {
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

export function TaskDetailBacklog({ task, project }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  // Editable field state
  const [title, setTitle] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [description, setDescription] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [branchValue, setBranchValue] = useState(task.branch || '');
  const [editingBranch, setEditingBranch] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sync local state when task data refreshes (unless actively editing)
  useEffect(() => {
    if (!editingTitle) setTitle(task.title);
  }, [task.title, editingTitle]);
  useEffect(() => {
    if (!editingDesc) setDescription(task.description || '');
  }, [task.description, editingDesc]);
  useEffect(() => {
    if (!editingBranch) setBranchValue(task.branch || '');
  }, [task.branch, editingBranch]);

  // Close delete modal on Escape
  useEffect(() => {
    if (!showDeleteConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDeleteConfirm(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showDeleteConfirm]);

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
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask.mutate({ title: trimmed });
    } else {
      setTitle(task.title);
    }
    setEditingTitle(false);
  };

  const handleDescSave = () => {
    const trimmed = description.trim();
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

  /* ── Content column ────────────────────────────────────────── */

  const content = (
    <div className="space-y-5">
      {/* Title — click to edit, seamless transition */}
      {editingTitle ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleTitleSave();
            if (e.key === 'Escape') { setTitle(task.title); setEditingTitle(false); }
          }}
          className="w-full bg-transparent border border-accent rounded-lg px-3 py-2 text-xl font-semibold text-[var(--color-text-primary)] focus:outline-none shadow-accent"
          autoFocus
        />
      ) : (
        <div
          onClick={() => setEditingTitle(true)}
          className="group cursor-text border border-transparent hover:border-[var(--color-border)] rounded-lg px-3 py-2 transition-colors"
        >
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)] group-hover:text-accent transition-colors">
            {task.title}
          </h2>
        </div>
      )}

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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setDescription(task.description || ''); setEditingDesc(false); }
              }}
              rows={Math.max(6, description.split('\n').length + 2)}
              className="w-full bg-transparent border border-accent rounded-lg px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none shadow-accent resize-y min-h-[120px] leading-relaxed"
              placeholder="Describe the task — requirements, context, acceptance criteria..."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => { setDescription(task.description || ''); setEditingDesc(false); }}
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-3 py-1.5 rounded-md border border-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDescSave}
                className="text-xs text-white bg-accent hover:bg-accent-dim px-3 py-1.5 rounded-md transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setEditingDesc(true)}
            className="cursor-text border border-transparent hover:border-[var(--color-border)] rounded-lg px-3 py-2.5 transition-colors min-h-[120px]"
          >
            {task.description ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--color-text-primary)]">
                {task.description}
              </p>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)] italic">
                Click to add description...
              </p>
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
    </div>
  );

  /* ── Sidebar column ────────────────────────────────────────── */

  const sidebar = (
    <div className="space-y-4">
      {/* Primary CTA */}
      <div>
        <button
          onClick={handleStartWorking}
          disabled={updateTask.isPending}
          className="w-full px-4 py-3 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {updateTask.isPending ? 'Starting...' : (
            <>Start Working <span className="opacity-60">&rarr;</span></>
          )}
        </button>
        <p className="text-[10px] text-[var(--color-text-secondary)] text-center mt-1.5 uppercase tracking-wider">
          Creates worktree &amp; branch
        </p>
      </div>

      {/* Details panel */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] px-3 py-2 border-b border-[var(--color-border)] bg-secondary">
          Details
        </div>
        <div className="divide-y divide-[var(--color-border)] text-xs">
          <MetaRow label="Status">
            <span className="text-[var(--color-status-backlog)]">backlog</span>
          </MetaRow>
          {project && (
            <MetaRow label="Project">
              <button
                onClick={() => navigate(`/projects/${project.id}/settings`)}
                className="text-accent hover:underline truncate"
              >
                {project.name}
              </button>
            </MetaRow>
          )}
          {project && (
            <div className="px-3 py-2.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Path</span>
              <div className="font-mono text-[10px] text-[var(--color-text-primary)] opacity-60 mt-1 break-all leading-relaxed">
                {project.path}
              </div>
            </div>
          )}
          <MetaRow label="Created">
            <span title={new Date(task.createdAt).toLocaleString()}>
              {relativeTime(task.createdAt)}
            </span>
          </MetaRow>
          <MetaRow label="ID">
            <span
              className="font-mono text-[10px] text-[var(--color-text-secondary)] cursor-default"
              title={task.id}
            >
              {task.id.slice(0, 12)}
            </span>
          </MetaRow>
        </div>
      </div>

      {/* Actions panel */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] px-3 py-2 border-b border-[var(--color-border)] bg-secondary">
          Actions
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          <button
            onClick={handleTogglePin}
            disabled={updateTask.isPending}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-[var(--color-text-primary)] hover:bg-tertiary transition-colors disabled:opacity-50"
          >
            <span>{task.pinned ? 'Unpin task' : 'Pin task'}</span>
            <span className={task.pinned ? 'text-accent' : 'text-[var(--color-text-secondary)]'}>
              {task.pinned ? '\u25C6' : '\u25C7'}
            </span>
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-[var(--color-error)] hover:bg-tertiary transition-colors"
          >
            <span>Delete task</span>
            <span>&times;</span>
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Layout ────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePin}
              disabled={updateTask.isPending}
              className={`px-2 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 ${
                task.pinned ? 'text-accent' : 'text-[var(--color-text-secondary)] hover:text-accent'
              }`}
              title={task.pinned ? 'Unpin' : 'Pin'}
            >
              {task.pinned ? '\u25C6' : '\u25C7'}
            </button>
            <button
              onClick={handleStartWorking}
              disabled={updateTask.isPending}
              className="px-4 py-1.5 bg-accent text-white font-medium text-sm rounded-md hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {updateTask.isPending ? 'Starting...' : 'Start Working'}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {isMobile ? (
          <div className="space-y-8">
            {content}
            {sidebar}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto flex gap-8">
            <div className="flex-1 min-w-0">{content}</div>
            <div className="w-56 shrink-0">{sidebar}</div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-elevated border border-subtle rounded-xl w-full max-w-sm shadow-lg">
            <div className="px-5 py-4 border-b border-subtle">
              <h2 className="text-sm font-medium text-[var(--color-text-primary)]">Delete Task</h2>
            </div>
            <div className="p-5 space-y-5">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Delete <strong className="text-[var(--color-text-primary)]">{task.title}</strong>?
                This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 px-4 bg-tertiary text-[var(--color-text-secondary)] text-sm rounded-lg hover:bg-[var(--color-border)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteTask.mutate()}
                  disabled={deleteTask.isPending}
                  className="flex-1 py-2 px-4 bg-[var(--color-error)] text-white font-medium text-sm rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {deleteTask.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small presentational helpers (file-local) ───────────────── */

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      {children}
    </div>
  );
}
