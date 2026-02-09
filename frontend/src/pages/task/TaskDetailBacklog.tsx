import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskHeader } from './TaskHeader';
import { tasksApi } from '../../api';
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
  const [title, setTitle] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [description, setDescription] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [branchValue, setBranchValue] = useState(task.branch || '');
  const [editingBranch, setEditingBranch] = useState(false);
  const branchRef = useRef<HTMLInputElement>(null);

  const updateTask = useMutation({
    mutationFn: (input: Parameters<typeof tasksApi.update>[1]) =>
      tasksApi.update(task.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
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

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        project={project}
        actions={
          <button
            onClick={handleStartWorking}
            disabled={updateTask.isPending}
            className="px-4 py-1.5 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {updateTask.isPending ? 'Starting...' : 'Start Working'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {/* Title */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Title</h3>
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
                className="w-full bg-primary border border-subtle rounded-md px-3 py-2 text-lg font-medium focus:outline-none focus:border-[var(--color-text-secondary)]"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-lg font-medium hover:text-accent transition-colors text-left w-full"
              >
                {task.title}
              </button>
            )}
          </div>

          {/* Description */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Description</h3>
            {editingDesc ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescSave}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setDescription(task.description || ''); setEditingDesc(false); }
                }}
                rows={Math.max(4, description.split('\n').length + 1)}
                className="w-full bg-primary border border-subtle rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-text-secondary)] resize-none"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingDesc(true)}
                className="text-sm text-left w-full hover:text-accent transition-colors whitespace-pre-wrap min-h-[4em]"
              >
                {task.description || <span className="text-dim italic">Click to add description...</span>}
              </button>
            )}
          </div>

          {/* Branch */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Branch</h3>
            {editingBranch ? (
              <input
                ref={branchRef}
                type="text"
                value={branchValue}
                onChange={(e) => setBranchValue(e.target.value)}
                onBlur={handleBranchSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBranchSave();
                  if (e.key === 'Escape') { setBranchValue(task.branch || ''); setEditingBranch(false); }
                }}
                placeholder={slugify(task.title)}
                className="w-full bg-primary border border-subtle rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:border-[var(--color-text-secondary)]"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingBranch(true)}
                className="font-mono text-sm text-left hover:text-accent transition-colors"
              >
                {task.branch || slugify(task.title)}
                {!task.branch && <span className="text-dim/50 ml-2">(auto)</span>}
              </button>
            )}
          </div>

          {/* Details */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">Details</h3>
            <div className="space-y-2 text-sm">
              {project && (
                <div className="flex gap-4">
                  <span className="text-dim w-24">project</span>
                  <span>{project.name}</span>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-dim w-24">created</span>
                <span>{new Date(task.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
