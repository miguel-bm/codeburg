import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronDown, GitBranch } from 'lucide-react';
import { tasksApi, invalidateTaskQueries, projectsApi, labelsApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { TaskStatus, Label } from '../../api/types';
import { Layout } from '../../components/layout/Layout';

function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'task';
}

const TASK_TYPES = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'chore', label: 'Chore' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'task', label: 'Task' },
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

export function TaskCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);

  const defaultProjectId = searchParams.get('project') || undefined;
  const defaultStatus = (searchParams.get('status') as TaskStatus) || TASK_STATUS.BACKLOG;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState('feature');
  const [priority, setPriority] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [branch, setBranch] = useState('');
  const [pendingLabels, setPendingLabels] = useState<Label[]>([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [editingTitle, setEditingTitle] = useState(true);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  // Set default project when projects load
  useEffect(() => {
    if (!projectId && projects?.length) {
      setProjectId(defaultProjectId || projects[0].id);
    }
  }, [projects, projectId, defaultProjectId]);

  // Focus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      const task = await tasksApi.create(projectId, {
        title,
        description: description || undefined,
        taskType: taskType || undefined,
        priority: priority || undefined,
        branch: branch || undefined,
      });

      // Assign pending labels
      for (const label of pendingLabels) {
        await labelsApi.assign(task.id, label.id);
      }

      // Move to target status if not backlog
      if (defaultStatus !== TASK_STATUS.BACKLOG) {
        await tasksApi.update(task.id, { status: defaultStatus });
      }

      return task;
    },
    onSuccess: (task) => {
      invalidateTaskQueries(queryClient, task.id);
      navigate(`/tasks/${task.id}`);
    },
  });

  const handleDiscard = () => {
    navigate(-1);
  };

  const canCreate = title.trim().length > 0 && !!projectId && !createMutation.isPending;

  const selectedProject = projects?.find(p => p.id === projectId);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="bg-secondary border-b border-subtle shrink-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={handleDiscard}
                className="text-dim hover:text-[var(--color-text-primary)] transition-colors shrink-0 text-sm"
              >
                {selectedProject?.name || 'back'}
              </button>
              <span className="text-dim shrink-0">/</span>
              <h1 className="text-sm font-medium text-dim">New task</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDiscard}
                className="px-3 py-1.5 text-sm text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!canCreate}
                className="px-4 py-1.5 bg-accent text-white font-medium text-sm rounded-md hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </header>

        {/* Error */}
        {createMutation.error && (
          <div className="mx-4 mt-3 border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
            {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create task'}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col sm:flex-row max-w-5xl mx-auto h-full">
            {/* Main content area */}
            <div className="flex-1 p-6 space-y-6 min-w-0">
              {/* Title */}
              <div
                onClick={() => setEditingTitle(true)}
                className={`px-3 py-2 border rounded-lg transition-colors cursor-text ${
                  editingTitle
                    ? 'border-accent shadow-accent'
                    : 'border-transparent hover:border-[var(--color-border)]'
                }`}
              >
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onFocus={() => setEditingTitle(true)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCreate) {
                      createMutation.mutate();
                    }
                    if (e.key === 'Escape') handleDiscard();
                  }}
                  placeholder="Task title..."
                  className="w-full p-0 m-0 border-0 bg-transparent text-lg font-medium text-[var(--color-text-primary)] focus:outline-none placeholder:text-dim"
                />
              </div>

              {/* Description */}
              <div
                className="px-3 py-2 border rounded-lg transition-colors cursor-text min-h-[100px] border-transparent hover:border-[var(--color-border)] focus-within:border-accent focus-within:shadow-accent"
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCreate) {
                      createMutation.mutate();
                    }
                  }}
                  rows={Math.max(4, description.split('\n').length + 1)}
                  className="w-full p-0 m-0 border-0 bg-transparent text-sm text-[var(--color-text-primary)] focus:outline-none resize-y min-h-[80px] leading-relaxed placeholder:text-dim"
                  placeholder="Describe the task..."
                />
              </div>

              {/* Mobile: properties inline */}
              <div className="sm:hidden space-y-4">
                <MobileCreateProperties
                  projects={projects || []}
                  projectId={projectId}
                  taskType={taskType}
                  priority={priority}
                  branch={branch}
                  title={title}
                  pendingLabels={pendingLabels}
                  onProjectChange={setProjectId}
                  onTaskTypeChange={setTaskType}
                  onPriorityChange={setPriority}
                  onBranchChange={setBranch}
                  onShowLabelPicker={() => setShowLabelPicker(true)}
                  onRemoveLabel={(id) => setPendingLabels(ls => ls.filter(l => l.id !== id))}
                  onCreate={() => canCreate && createMutation.mutate()}
                  onDiscard={handleDiscard}
                  canCreate={canCreate}
                  isPending={createMutation.isPending}
                />
              </div>
            </div>

            {/* Desktop: Properties sidebar */}
            <div className="hidden sm:block w-72 border-l border-subtle p-4 space-y-4 shrink-0">
              <CreatePropertiesSidebar
                projects={projects || []}
                projectId={projectId}
                taskType={taskType}
                priority={priority}
                branch={branch}
                title={title}
                pendingLabels={pendingLabels}
                onProjectChange={setProjectId}
                onTaskTypeChange={setTaskType}
                onPriorityChange={setPriority}
                onBranchChange={setBranch}
                onShowLabelPicker={() => setShowLabelPicker(true)}
                onRemoveLabel={(id) => setPendingLabels(ls => ls.filter(l => l.id !== id))}
                onCreate={() => canCreate && createMutation.mutate()}
                onDiscard={handleDiscard}
                canCreate={canCreate}
                isPending={createMutation.isPending}
              />
            </div>
          </div>
        </div>

        {/* Label picker */}
        {showLabelPicker && projectId && (
          <CreateLabelPicker
            projectId={projectId}
            assignedLabels={pendingLabels}
            onToggleLabel={(label, assigned) => {
              if (assigned) {
                setPendingLabels(ls => ls.filter(l => l.id !== label.id));
              } else {
                setPendingLabels(ls => [...ls, label]);
              }
            }}
            onClose={() => setShowLabelPicker(false)}
          />
        )}
      </div>
    </Layout>
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

interface CreateSidebarProps {
  projects: { id: string; name: string }[];
  projectId: string;
  taskType: string;
  priority: string;
  branch: string;
  title: string;
  pendingLabels: Label[];
  onProjectChange: (id: string) => void;
  onTaskTypeChange: (type: string) => void;
  onPriorityChange: (priority: string) => void;
  onBranchChange: (branch: string) => void;
  onShowLabelPicker: () => void;
  onRemoveLabel: (id: string) => void;
  onCreate: () => void;
  onDiscard: () => void;
  canCreate: boolean;
  isPending: boolean;
}

function CreatePropertiesSidebar({
  projects, projectId, taskType, priority, branch, title, pendingLabels,
  onProjectChange, onTaskTypeChange, onPriorityChange, onBranchChange,
  onShowLabelPicker, onRemoveLabel, onCreate, onDiscard, canCreate, isPending,
}: CreateSidebarProps) {
  return (
    <>
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-dim">Properties</h3>

      {/* Project */}
      <PropertyRow label="Project">
        <select
          value={projectId}
          onChange={(e) => onProjectChange(e.target.value)}
          className="text-xs bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none cursor-pointer p-0 pr-4 appearance-auto"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </PropertyRow>

      {/* Task Type */}
      <PropertyRow label="Type">
        <select
          value={taskType}
          onChange={(e) => onTaskTypeChange(e.target.value)}
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
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value)}
          className="text-xs bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none cursor-pointer p-0 pr-4 appearance-auto"
        >
          <option value="">None</option>
          {PRIORITIES.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </PropertyRow>

      {/* Branch */}
      <PropertyRow label="Branch">
        <BranchPicker
          projectId={projectId}
          branch={branch}
          title={title}
          onBranchChange={onBranchChange}
        />
      </PropertyRow>

      {/* Labels */}
      <PropertyRow label="Labels">
        <div className="flex items-center flex-wrap gap-1">
          {pendingLabels.map(label => (
            <span
              key={label.id}
              className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-0.5"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
              <button onClick={() => onRemoveLabel(label.id)} className="hover:opacity-70">
                <X size={8} />
              </button>
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

      {/* Create */}
      <button
        onClick={onCreate}
        disabled={!canCreate}
        className="w-full px-4 py-2.5 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50"
      >
        {isPending ? 'Creating...' : 'Create Task'}
      </button>

      {/* Discard */}
      <button
        onClick={onDiscard}
        className="w-full text-xs text-dim hover:text-[var(--color-text-primary)] py-1 transition-colors"
      >
        Discard
      </button>
    </>
  );
}

function MobileCreateProperties({
  projects, projectId, taskType, priority, branch, title, pendingLabels,
  onProjectChange, onTaskTypeChange, onPriorityChange, onBranchChange,
  onShowLabelPicker, onRemoveLabel, onCreate, onDiscard, canCreate, isPending,
}: CreateSidebarProps) {
  return (
    <>
      {/* Project */}
      <div className="px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Project</span>
        <select
          value={projectId}
          onChange={(e) => onProjectChange(e.target.value)}
          className="block w-full mt-1 px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] text-sm rounded-md focus:outline-none focus:border-accent"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Type & Priority row */}
      <div className="flex gap-3 px-1">
        <div className="flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Type</span>
          <select
            value={taskType}
            onChange={(e) => onTaskTypeChange(e.target.value)}
            className="block w-full mt-1 px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] text-sm rounded-md focus:outline-none focus:border-accent"
          >
            {TASK_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Priority</span>
          <select
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value)}
            className="block w-full mt-1 px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] text-sm rounded-md focus:outline-none focus:border-accent"
          >
            <option value="">None</option>
            {PRIORITIES.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Branch */}
      <div className="px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Branch</span>
        <div className="mt-1">
          <BranchPicker
            projectId={projectId}
            branch={branch}
            title={title}
            onBranchChange={onBranchChange}
            mobile
          />
        </div>
      </div>

      {/* Labels */}
      <div className="px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Labels</span>
        <div className="flex items-center flex-wrap gap-1.5 mt-1">
          {pendingLabels.map(label => (
            <span
              key={label.id}
              className="text-xs px-2 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
              <button onClick={() => onRemoveLabel(label.id)} className="hover:opacity-70">
                <X size={10} />
              </button>
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

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={onCreate}
          disabled={!canCreate}
          className="w-full px-4 py-3 bg-accent text-white font-medium text-sm rounded-lg hover:bg-accent-dim transition-colors disabled:opacity-50"
        >
          {isPending ? 'Creating...' : 'Create Task'}
        </button>
        <button
          onClick={onDiscard}
          className="w-full text-xs text-dim hover:text-[var(--color-text-primary)] py-1 transition-colors"
        >
          Discard
        </button>
      </div>
    </>
  );
}

interface BranchPickerProps {
  projectId: string;
  branch: string;
  title: string;
  onBranchChange: (branch: string) => void;
  mobile?: boolean;
}

function BranchPicker({ projectId, branch, title, onBranchChange, mobile }: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: branches, isLoading } = useQuery({
    queryKey: ['branches', projectId],
    queryFn: () => projectsApi.listBranches(projectId),
    enabled: open && !!projectId,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!branches) return [];
    if (!search) return branches;
    const lower = search.toLowerCase();
    return branches.filter(b => b.toLowerCase().includes(lower));
  }, [branches, search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      setSearch('');
    }
  }, [open]);

  const autoPreview = title.trim() ? slugify(title) : 'task';

  if (branch) {
    return (
      <div className={`flex items-center gap-1 ${mobile ? '' : 'justify-end'}`}>
        <GitBranch size={10} className="text-accent shrink-0" />
        <span className="text-xs font-mono text-accent truncate max-w-[140px]">{branch}</span>
        <button
          onClick={() => onBranchChange('')}
          className="text-dim hover:text-[var(--color-text-primary)] transition-colors shrink-0"
          title="Reset to auto"
        >
          <X size={10} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-xs text-dim hover:text-[var(--color-text-primary)] transition-colors ${mobile ? '' : 'justify-end'}`}
      >
        <span className="truncate max-w-[140px] font-mono opacity-50">{autoPreview}</span>
        <ChevronDown size={10} className="shrink-0" />
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 bg-elevated border border-subtle rounded-lg shadow-xl w-56 ${mobile ? 'left-0' : 'right-0'}`}>
          <div className="p-2 border-b border-subtle">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branches..."
              className="w-full px-2 py-1 text-xs border border-subtle bg-primary rounded focus:outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length === 1) {
                  onBranchChange(filtered[0]);
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {isLoading && (
              <p className="text-xs text-dim text-center py-3">Loading...</p>
            )}
            {!isLoading && filtered.length === 0 && (
              <p className="text-xs text-dim text-center py-3">
                {search ? 'No matching branches' : 'No branches found'}
              </p>
            )}
            {filtered.map(b => (
              <button
                key={b}
                onClick={() => {
                  onBranchChange(b);
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 text-xs font-mono rounded hover:bg-tertiary transition-colors truncate"
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface CreateLabelPickerProps {
  projectId: string;
  assignedLabels: Label[];
  onToggleLabel: (label: Label, currentlyAssigned: boolean) => void;
  onClose: () => void;
}

function CreateLabelPicker({ projectId, assignedLabels, onToggleLabel, onClose }: CreateLabelPickerProps) {
  const queryClient = useQueryClient();
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_LABEL_COLORS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: projectLabels } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => labelsApi.list(projectId),
  });

  const createLabel = useMutation({
    mutationFn: (input: { name: string; color: string }) => labelsApi.create(projectId, input),
    onSuccess: (label) => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      onToggleLabel(label, false); // auto-assign
      setNewLabelName('');
      setShowCreate(false);
    },
  });

  const deleteLabel = useMutation({
    mutationFn: (id: string) => labelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
    },
  });

  const assignedIds = new Set(assignedLabels.map(l => l.id));

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
                  onClick={() => onToggleLabel(label, isAssigned)}
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
