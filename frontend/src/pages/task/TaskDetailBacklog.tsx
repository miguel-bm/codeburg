import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Plus, X, Play, Pin, Trash2 } from 'lucide-react';
import { TaskHeader } from './TaskHeader';
import { relativeTime } from './TaskHeader';
import { tasksApi, invalidateTaskQueries, labelsApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Task, Project } from '../../api/types';

interface Props {
  task: Task;
  project?: Project;
}

const TASK_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'chore', label: 'Chore' },
  { value: 'improvement', label: 'Improvement' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', color: 'var(--color-error)' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'medium', label: 'Medium', color: '#eab308' },
  { value: 'low', label: 'Low', color: 'var(--color-text-dim)' },
];

const DEFAULT_LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'task';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="text-dim hover:text-[var(--color-text-primary)] transition-colors p-0.5"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function TaskDetailBacklog({ task, project }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [titleValue, setTitleValue] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [descValue, setDescValue] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);

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

  const handleStartWorking = () => {
    updateTask.mutate({ status: TASK_STATUS.IN_PROGRESS });
  };

  const handleTogglePin = () => {
    updateTask.mutate({ pinned: !task.pinned });
  };

  const branchDisplay = task.branch || `task-${slugify(task.title)}`;
  const isAutoBranch = !task.branch;

  const priorityInfo = PRIORITIES.find(p => p.value === task.priority);

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
            className="px-4 py-1.5 bg-accent text-white font-medium text-sm rounded-md hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Play size={14} />
            {updateTask.isPending ? 'Starting...' : 'Start Working'}
          </button>
        }
      />

      {/* Mobile: compact properties bar */}
      <div className="sm:hidden flex items-center gap-2 px-4 py-2 bg-secondary border-b border-subtle overflow-x-auto">
        <span className="text-xs bg-[var(--color-status-backlog)]/15 text-[var(--color-status-backlog)] rounded-full px-2 py-0.5 shrink-0">
          backlog
        </span>
        <span className="text-xs bg-tertiary rounded-full px-2 py-0.5 shrink-0 capitalize">
          {task.taskType}
        </span>
        {priorityInfo && (
          <span className="text-xs rounded-full px-2 py-0.5 shrink-0" style={{ color: priorityInfo.color }}>
            {priorityInfo.label}
          </span>
        )}
        {project && (
          <button
            onClick={() => navigate(`/projects/${project.id}/settings`)}
            className="text-xs text-accent shrink-0"
          >
            {project.name}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col sm:flex-row max-w-5xl mx-auto h-full">
          {/* Main content area */}
          <div className="flex-1 p-6 space-y-6 min-w-0">
            {/* Title */}
            <div
              onClick={() => !editingTitle && setEditingTitle(true)}
              className={`px-3 py-2 border rounded-lg transition-colors cursor-text ${
                editingTitle
                  ? 'border-accent shadow-accent'
                  : 'border-transparent hover:border-[var(--color-border)]'
              }`}
            >
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
                  className="w-full p-0 m-0 border-0 bg-transparent text-lg font-medium text-[var(--color-text-primary)] focus:outline-none"
                  autoFocus
                />
              ) : (
                <span className="text-lg font-medium">{task.title}</span>
              )}
            </div>

            {/* Description */}
            <div
              onClick={() => !editingDesc && setEditingDesc(true)}
              className={`px-3 py-2 border rounded-lg transition-colors cursor-text min-h-[100px] ${
                editingDesc
                  ? 'border-accent shadow-accent'
                  : 'border-transparent hover:border-[var(--color-border)]'
              }`}
            >
              {editingDesc ? (
                <div>
                  <textarea
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setDescValue(task.description || ''); setEditingDesc(false); }
                    }}
                    rows={Math.max(4, descValue.split('\n').length + 1)}
                    className="w-full p-0 m-0 border-0 bg-transparent text-sm text-[var(--color-text-primary)] focus:outline-none resize-y min-h-[80px] leading-relaxed"
                    placeholder="Describe the task..."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDescValue(task.description || ''); setEditingDesc(false); }}
                      className="text-xs text-dim hover:text-[var(--color-text-primary)] px-2.5 py-1 rounded border border-subtle transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDescSave(); }}
                      className="text-xs text-white bg-accent hover:bg-accent-dim px-2.5 py-1 rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                task.description ? (
                  <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{task.description}</p>
                ) : (
                  <p className="text-sm text-dim italic">Click to add description...</p>
                )
              )}
            </div>

            {/* Mobile: full details */}
            <div className="sm:hidden space-y-4">
              <MobileDetails
                task={task}
                project={project}
                branchDisplay={branchDisplay}
                isAutoBranch={isAutoBranch}
                onTogglePin={handleTogglePin}
                onDelete={() => setShowDeleteConfirm(true)}
                onStartWorking={handleStartWorking}
                isPending={updateTask.isPending}
                onShowLabelPicker={() => setShowLabelPicker(true)}
              />
            </div>
          </div>

          {/* Desktop: Properties sidebar */}
          <div className="hidden sm:block w-72 border-l border-subtle p-4 space-y-4 shrink-0">
            <PropertiesSidebar
              task={task}
              project={project}
              branchDisplay={branchDisplay}
              isAutoBranch={isAutoBranch}
              updateTask={updateTask}
              onTogglePin={handleTogglePin}
              onDelete={() => setShowDeleteConfirm(true)}
              onStartWorking={handleStartWorking}
              isPending={updateTask.isPending}
              onShowLabelPicker={() => setShowLabelPicker(true)}
            />
          </div>
        </div>
      </div>

      {/* Label picker popover */}
      {showLabelPicker && project && (
        <LabelPickerModal
          task={task}
          projectId={project.id}
          onClose={() => setShowLabelPicker(false)}
        />
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
    </div>
  );
}

interface PropertiesSidebarProps {
  task: Task;
  project?: Project;
  branchDisplay: string;
  isAutoBranch: boolean;
  updateTask: { mutate: (input: Parameters<typeof tasksApi.update>[1]) => void; isPending: boolean };
  onTogglePin: () => void;
  onDelete: () => void;
  onStartWorking: () => void;
  isPending: boolean;
  onShowLabelPicker: () => void;
}

function PropertiesSidebar({
  task, project, branchDisplay, isAutoBranch, updateTask,
  onTogglePin, onDelete, onStartWorking, isPending, onShowLabelPicker,
}: PropertiesSidebarProps) {
  const navigate = useNavigate();

  return (
    <>
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-dim">Properties</h3>

      {/* Status */}
      <PropertyRow label="Status">
        <span className="text-xs bg-[var(--color-status-backlog)]/15 text-[var(--color-status-backlog)] rounded-full px-2 py-0.5">
          backlog
        </span>
      </PropertyRow>

      {/* Task Type */}
      <PropertyRow label="Type">
        <select
          value={task.taskType}
          onChange={(e) => updateTask.mutate({ taskType: e.target.value })}
          className="text-xs bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none cursor-pointer p-0 pr-4 appearance-auto"
        >
          {TASK_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </PropertyRow>

      {/* Priority */}
      <PropertyRow label="Priority">
        <select
          value={task.priority || ''}
          onChange={(e) => updateTask.mutate({ priority: e.target.value || undefined })}
          className="text-xs bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none cursor-pointer p-0 pr-4 appearance-auto"
        >
          <option value="">None</option>
          {PRIORITIES.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </PropertyRow>

      {/* Project */}
      {project && (
        <PropertyRow label="Project">
          <button
            onClick={() => navigate(`/projects/${project.id}/settings`)}
            className="text-xs text-accent hover:underline transition-colors"
          >
            {project.name}
          </button>
        </PropertyRow>
      )}

      {/* Branch */}
      <PropertyRow label="Branch">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-xs text-accent truncate">{branchDisplay}</span>
          {isAutoBranch && (
            <span className="text-[9px] text-dim border border-[var(--color-border)] rounded-full px-1 py-px uppercase tracking-wider shrink-0">
              auto
            </span>
          )}
          <CopyButton text={branchDisplay} />
        </div>
      </PropertyRow>

      {/* Task ID */}
      <PropertyRow label="ID">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-dim" title={task.id}>{task.id.slice(0, 10)}...</span>
          <CopyButton text={task.id} />
        </div>
      </PropertyRow>

      {/* Created */}
      <PropertyRow label="Created">
        <span className="text-xs text-[var(--color-text-secondary)]" title={new Date(task.createdAt).toLocaleString()}>
          {relativeTime(task.createdAt)}
        </span>
      </PropertyRow>

      {/* Pinned */}
      <PropertyRow label="Pinned">
        <button
          onClick={onTogglePin}
          disabled={isPending}
          className={`text-xs transition-colors disabled:opacity-50 inline-flex items-center gap-1 ${
            task.pinned ? 'text-accent' : 'text-dim hover:text-accent'
          }`}
        >
          <Pin size={11} />
          {task.pinned ? 'Yes' : 'No'}
        </button>
      </PropertyRow>

      {/* Labels */}
      <PropertyRow label="Labels">
        <div className="flex items-center flex-wrap gap-1">
          {task.labels.map(label => (
            <span
              key={label.id}
              className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
          <button
            onClick={onShowLabelPicker}
            className="text-dim hover:text-accent transition-colors p-0.5"
            title="Add label"
          >
            <Plus size={12} />
          </button>
        </div>
      </PropertyRow>

      {/* Divider */}
      <div className="border-t border-subtle my-3" />

      {/* Start Working */}
      <button
        onClick={onStartWorking}
        disabled={isPending}
        className="w-full px-4 py-2.5 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
      >
        <Play size={14} />
        {isPending ? 'Starting...' : 'Start Working'}
      </button>
      <p className="text-[10px] text-dim text-center uppercase tracking-wider">
        Creates worktree &amp; branch
      </p>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full text-xs text-dim hover:text-[var(--color-error)] py-1 transition-colors inline-flex items-center justify-center gap-1"
      >
        <Trash2 size={11} />
        Delete task
      </button>
    </>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-dim shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface MobileDetailsProps {
  task: Task;
  project?: Project;
  branchDisplay: string;
  isAutoBranch: boolean;
  onTogglePin: () => void;
  onDelete: () => void;
  onStartWorking: () => void;
  isPending: boolean;
  onShowLabelPicker: () => void;
}

function MobileDetails({
  task, project, branchDisplay, isAutoBranch,
  onTogglePin, onDelete, onStartWorking, isPending, onShowLabelPicker,
}: MobileDetailsProps) {
  const navigate = useNavigate();

  return (
    <>
      {/* Branch */}
      <div className="px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Branch</span>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-mono text-sm text-accent">{branchDisplay}</span>
          {isAutoBranch && (
            <span className="text-[9px] text-dim border border-[var(--color-border)] rounded-full px-1 py-px uppercase tracking-wider">
              auto
            </span>
          )}
          <CopyButton text={branchDisplay} />
        </div>
      </div>

      {/* Labels */}
      <div className="px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Labels</span>
        <div className="flex items-center flex-wrap gap-1.5 mt-1">
          {task.labels.map(label => (
            <span
              key={label.id}
              className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
          <button
            onClick={onShowLabelPicker}
            className="text-dim hover:text-accent transition-colors p-0.5"
            title="Add label"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="px-1 space-y-1.5 text-sm">
        {project && (
          <div className="flex gap-4">
            <span className="text-dim w-16 shrink-0">project</span>
            <button
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              className="text-accent hover:underline"
            >
              {project.name}
            </button>
          </div>
        )}
        <div className="flex gap-4">
          <span className="text-dim w-16 shrink-0">created</span>
          <span className="text-[var(--color-text-secondary)]" title={new Date(task.createdAt).toLocaleString()}>
            {relativeTime(task.createdAt)}
          </span>
        </div>
        <div className="flex gap-4">
          <span className="text-dim w-16 shrink-0">id</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-dim">{task.id.slice(0, 10)}...</span>
            <CopyButton text={task.id} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 px-1">
        <button
          onClick={onTogglePin}
          disabled={isPending}
          className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1 ${
            task.pinned ? 'text-accent' : 'text-dim hover:text-accent'
          }`}
        >
          <Pin size={11} />
          {task.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-dim hover:text-[var(--color-error)] px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>

      {/* Start working CTA */}
      <div>
        <button
          onClick={onStartWorking}
          disabled={isPending}
          className="w-full px-4 py-3 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          <Play size={14} />
          {isPending ? 'Starting...' : 'Start Working'}
        </button>
        <p className="text-[10px] text-dim text-center mt-1.5 uppercase tracking-wider">
          Creates worktree &amp; branch
        </p>
      </div>
    </>
  );
}

interface LabelPickerModalProps {
  task: Task;
  projectId: string;
  onClose: () => void;
}

function LabelPickerModal({ task, projectId, onClose }: LabelPickerModalProps) {
  const queryClient = useQueryClient();
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_LABEL_COLORS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: projectLabels } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => labelsApi.list(projectId),
  });

  const assignLabel = useMutation({
    mutationFn: (labelId: string) => labelsApi.assign(task.id, labelId),
    onSuccess: () => {
      invalidateTaskQueries(queryClient, task.id);
    },
  });

  const unassignLabel = useMutation({
    mutationFn: (labelId: string) => labelsApi.unassign(task.id, labelId),
    onSuccess: () => {
      invalidateTaskQueries(queryClient, task.id);
    },
  });

  const createLabel = useMutation({
    mutationFn: (input: { name: string; color: string }) => labelsApi.create(projectId, input),
    onSuccess: (label) => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      // Auto-assign the newly created label
      assignLabel.mutate(label.id);
      setNewLabelName('');
      setShowCreate(false);
    },
  });

  const deleteLabel = useMutation({
    mutationFn: (id: string) => labelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      invalidateTaskQueries(queryClient, task.id);
    },
  });

  const assignedIds = new Set(task.labels.map(l => l.id));

  useEffect(() => {
    if (showCreate && inputRef.current) inputRef.current.focus();
  }, [showCreate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-elevated border border-subtle rounded-lg shadow-xl w-full max-w-xs mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-subtle">
          <span className="text-xs font-medium">Labels</span>
          <button onClick={onClose} className="text-dim hover:text-[var(--color-text-primary)] transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
          {projectLabels?.map(label => {
            const isAssigned = assignedIds.has(label.id);
            return (
              <div key={label.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-tertiary">
                <button
                  onClick={() => isAssigned ? unassignLabel.mutate(label.id) : assignLabel.mutate(label.id)}
                  className="flex items-center gap-2 min-w-0 flex-1"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border-2"
                    style={{
                      backgroundColor: isAssigned ? label.color : 'transparent',
                      borderColor: label.color,
                    }}
                  />
                  <span className="text-xs truncate">{label.name}</span>
                </button>
                <button
                  onClick={() => deleteLabel.mutate(label.id)}
                  className="text-dim hover:text-[var(--color-error)] transition-colors shrink-0"
                  title="Delete label"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}

          {!projectLabels?.length && !showCreate && (
            <p className="text-xs text-dim text-center py-2">No labels yet</p>
          )}
        </div>

        {/* Create new label */}
        {showCreate ? (
          <div className="border-t border-subtle p-2 space-y-2">
            <input
              ref={inputRef}
              type="text"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabelName.trim()) {
                  createLabel.mutate({ name: newLabelName.trim(), color: newLabelColor });
                }
                if (e.key === 'Escape') setShowCreate(false);
              }}
              placeholder="Label name"
              className="w-full px-2 py-1 text-xs border border-subtle bg-primary rounded focus:outline-none focus:border-accent"
            />
            <div className="flex items-center gap-1">
              {DEFAULT_LABEL_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setNewLabelColor(color)}
                  className={`w-5 h-5 rounded-full transition-transform ${newLabelColor === color ? 'ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-bg-primary)] scale-110' : ''}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 text-xs text-dim py-1 rounded border border-subtle hover:bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => newLabelName.trim() && createLabel.mutate({ name: newLabelName.trim(), color: newLabelColor })}
                disabled={!newLabelName.trim() || createLabel.isPending}
                className="flex-1 text-xs text-white bg-accent py-1 rounded hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-subtle p-2">
            <button
              onClick={() => setShowCreate(true)}
              className="w-full text-xs text-dim hover:text-accent py-1 flex items-center justify-center gap-1 transition-colors"
            >
              <Plus size={12} /> New label
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
