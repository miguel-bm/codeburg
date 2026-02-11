import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, GitBranch, Maximize2, Minimize2, Play, Terminal, CornerDownLeft } from 'lucide-react';
import { useSetHeader } from '../../components/layout/Header';
import { tasksApi, sessionsApi, invalidateTaskQueries, projectsApi, labelsApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Label } from '../../api/types';
import type { SessionProvider } from '../../api/sessions';
import { usePanelStore } from '../../stores/panel';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/settings';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';

type CreateMode = 'backlog' | 'in_progress';
type WizardProvider = SessionProvider | 'none';

function parseCreateMode(status: string | null): CreateMode {
  return status === TASK_STATUS.IN_PROGRESS ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.BACKLOG;
}

function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'task';
}

function buildSessionPrompt(title: string, description: string): string {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();

  if (!cleanTitle && !cleanDescription) return '';
  if (!cleanDescription) return cleanTitle;
  if (!cleanTitle) return cleanDescription;

  return `Task: ${cleanTitle}\n\nDescription:\n${cleanDescription}`;
}

const TASK_TYPE_OPTIONS = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'chore', label: 'Chore' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'task', label: 'Task' },
];

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'urgent', label: 'P0 · Urgent' },
  { value: 'high', label: 'P1 · High' },
  { value: 'medium', label: 'P2 · Medium' },
  { value: 'low', label: 'P3 · Low' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: '#f97316',
  medium: '#eab308',
  low: 'var(--color-text-dim)',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
};

const DEFAULT_LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

export function TaskCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const { size, toggleSize } = usePanelStore();

  const mode = parseCreateMode(searchParams.get('status'));
  const isInProgressCreate = mode === TASK_STATUS.IN_PROGRESS;
  const defaultProjectId = searchParams.get('project') || '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState('feature');
  const [priority, setPriority] = useState('none');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [branch, setBranch] = useState('');
  const [branchDirty, setBranchDirty] = useState(false);
  const [pendingLabels, setPendingLabels] = useState<Label[]>([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);

  const [provider, setProvider] = useState<WizardProvider>(isInProgressCreate ? 'claude' : 'none');
  const [includePrompt, setIncludePrompt] = useState(true);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  useEffect(() => {
    if (!projectId && projects?.length) {
      setProjectId(defaultProjectId || projects[0].id);
    }
  }, [defaultProjectId, projectId, projects]);

  useEffect(() => {
    if (isInProgressCreate && provider === 'none') {
      setProvider('claude');
      return;
    }
    if (!isInProgressCreate && provider !== 'none') {
      setProvider('none');
    }
  }, [isInProgressCreate, provider]);

  useEffect(() => {
    if (!branchDirty) {
      setBranch(title.trim() ? slugify(title) : '');
    }
  }, [title, branchDirty]);

  useEffect(() => {
    const id = window.setTimeout(() => titleRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, []);

  const selectedProject = projects?.find((project) => project.id === projectId);
  const showPromptToggle = provider === 'claude' || provider === 'codex';

  const sessionPromptPreview = useMemo(
    () => buildSessionPrompt(title, description),
    [title, description],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim();
      const trimmedDescription = description.trim();
      const effectivePriority = priority === 'none' ? undefined : priority;

      const task = await tasksApi.create(projectId, {
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        taskType: taskType || undefined,
        priority: effectivePriority,
        branch: branch.trim() || undefined,
      });

      if (pendingLabels.length > 0) {
        await Promise.all(pendingLabels.map((label) => labelsApi.assign(task.id, label.id)));
      }

      let sessionId: string | undefined;

      if (isInProgressCreate) {
        await tasksApi.update(task.id, { status: TASK_STATUS.IN_PROGRESS });

        if (provider !== 'none') {
          const shouldSendPrompt = showPromptToggle && includePrompt;
          const sessionPrompt = shouldSendPrompt
            ? buildSessionPrompt(trimmedTitle, trimmedDescription)
            : '';

          const session = await sessionsApi.start(task.id, {
            provider: provider as SessionProvider,
            prompt: sessionPrompt || undefined,
          });
          sessionId = session.id;
        }
      }

      return { taskId: task.id, sessionId };
    },
    onSuccess: ({ taskId, sessionId }) => {
      invalidateTaskQueries(queryClient, taskId);
      navigate(sessionId ? `/tasks/${taskId}?session=${sessionId}` : `/tasks/${taskId}`);
    },
  });

  const canCreate = title.trim().length > 0 && !!projectId && !createMutation.isPending;

  const handleClose = () => navigate('/');

  const handleSubmit = () => {
    if (!canCreate) return;
    createMutation.mutate();
  };

  const handleInputEsc = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    handleInputEsc(e);
  };

  const handleDescriptionKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    handleInputEsc(e);
  };

  useSetHeader(
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={handleClose}
          className="text-dim hover:text-[var(--color-text-primary)] transition-colors shrink-0 text-sm"
        >
          {selectedProject?.name || 'back'}
        </button>
        <span className="text-dim shrink-0">/</span>
        <h1 className="text-sm font-medium text-dim">
          {isInProgressCreate ? 'New in-progress task' : 'New task'}
        </h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canCreate}
          loading={createMutation.isPending}
        >
          <Play size={11} />
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </Button>
        <IconButton
          icon={size === 'half' ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          onClick={toggleSize}
          tooltip={size === 'half' ? 'Expand panel' : 'Collapse panel'}
          size="xs"
        />
        <IconButton
          icon={<X size={14} />}
          onClick={handleClose}
          tooltip="Close panel"
          size="xs"
        />
      </div>
    </div>,
    `task-create-${mode}-${projectId}-${selectedProject?.name ?? ''}-${canCreate}-${createMutation.isPending}-${size}`,
  );

  return (
    <div className="flex flex-col h-full">
      {createMutation.error && (
        <div className="mx-4 mt-3 border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
          {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create task'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <div>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              disabled={createMutation.isPending}
              placeholder="Task title..."
              className="w-full px-3 py-2.5 text-base border border-subtle bg-primary text-[var(--color-text-primary)] rounded-lg focus:outline-none focus:border-accent placeholder:text-dim"
            />
          </div>

          <div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleDescriptionKeyDown}
              disabled={createMutation.isPending}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-subtle bg-primary text-[var(--color-text-primary)] rounded-lg focus:outline-none focus:border-accent placeholder:text-dim resize-y min-h-[88px]"
              placeholder="Describe the task..."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Project">
              <Select
                value={projectId}
                onChange={setProjectId}
                options={(projects ?? []).map((project) => ({ value: project.id, label: project.name }))}
              />
            </Field>

            <Field label="Type">
              <Select
                value={taskType}
                onChange={setTaskType}
                options={TASK_TYPE_OPTIONS}
              />
            </Field>

            <Field label="Priority">
              <PrioritySelect value={priority} onChange={setPriority} />
            </Field>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-dim mb-1.5">Branch</p>
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-dim shrink-0" />
              <input
                type="text"
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setBranchDirty(true);
                }}
                onKeyDown={handleInputEsc}
                disabled={createMutation.isPending}
                placeholder="auto-generated from title"
                className="flex-1 px-2 py-1.5 text-sm font-mono border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-accent placeholder:text-dim"
              />
              {branchDirty && (
                <button
                  type="button"
                  onClick={() => {
                    setBranch(title.trim() ? slugify(title) : '');
                    setBranchDirty(false);
                  }}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] shrink-0"
                >
                  reset
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-dim">Labels</p>
              <button
                type="button"
                onClick={() => setShowLabelPicker(true)}
                className="inline-flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-[11px] text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)] transition-colors"
              >
                <Plus size={10} />
                Add label
              </button>
            </div>
            {pendingLabels.length > 0 ? (
              <div className="flex items-center flex-wrap gap-1.5">
                {pendingLabels.map((label) => (
                  <span
                    key={label.id}
                    className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                    <button
                      onClick={() => setPendingLabels((labels) => labels.filter((entry) => entry.id !== label.id))}
                      className="hover:opacity-70"
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-dim border border-subtle rounded-md px-2 py-2 bg-primary">
                No labels selected.
              </div>
            )}
          </div>

          {isInProgressCreate && (
            <div className="pt-3 border-t border-subtle space-y-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-dim mb-2">Session</p>
                <div className="grid grid-cols-4 gap-1.5">
                  <ProviderPill
                    label="Claude"
                    logo={<img src={claudeLogo} alt="" className="h-4 w-4 object-contain" />}
                    selected={provider === 'claude'}
                    onClick={() => setProvider('claude')}
                  />
                  <ProviderPill
                    label="Codex"
                    logo={<img src={openaiLogo} alt="" className="h-4 w-4 object-contain" />}
                    selected={provider === 'codex'}
                    onClick={() => setProvider('codex')}
                  />
                  <ProviderPill
                    label="Terminal"
                    logo={<Terminal size={14} className="text-[var(--color-text-primary)]" />}
                    selected={provider === 'terminal'}
                    onClick={() => setProvider('terminal')}
                  />
                  <ProviderPill
                    label="None"
                    logo={<span className="text-xs text-dim">-</span>}
                    selected={provider === 'none'}
                    onClick={() => setProvider('none')}
                  />
                </div>
              </div>

              {showPromptToggle && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-dim">
                      Use title + description as initial prompt
                    </span>
                    <Toggle checked={includePrompt} onChange={setIncludePrompt} />
                  </div>
                  {includePrompt ? (
                    <div className="border border-subtle bg-primary rounded-lg px-3 py-2 text-xs text-dim whitespace-pre-wrap">
                      {sessionPromptPreview || 'Prompt will be generated from title and description.'}
                    </div>
                  ) : (
                    <div className="border border-subtle bg-primary rounded-lg px-3 py-2 text-xs text-dim">
                      Session will start interactively with no prompt.
                    </div>
                  )}
                </div>
              )}

              {provider === 'terminal' && (
                <div className="border border-subtle bg-primary rounded-lg px-3 py-2 text-xs text-dim">
                  Terminal sessions ignore prompts and start in interactive shell mode.
                </div>
              )}
            </div>
          )}

          <div className="sm:hidden pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={!canCreate}
              loading={createMutation.isPending}
              className="w-full justify-center"
            >
              <Play size={12} />
              {createMutation.isPending ? 'Creating...' : 'Create Task'}
              <span className="inline-flex items-center gap-0.5 rounded border border-white/20 bg-white/10 px-1 py-0.5 text-[10px] ml-1">
                <CornerDownLeft size={9} />
              </span>
            </Button>
          </div>
        </div>
      </div>

      {showLabelPicker && projectId && (
        <CreateLabelPicker
          projectId={projectId}
          assignedLabels={pendingLabels}
          onToggleLabel={(label, assigned) => {
            if (assigned) {
              setPendingLabels((labels) => labels.filter((entry) => entry.id !== label.id));
            } else {
              setPendingLabels((labels) => [...labels, label]);
            }
          }}
          onClose={() => setShowLabelPicker(false)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-dim mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function PrioritySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const color = value !== 'none' ? PRIORITY_COLORS[value] : undefined;
  const displayLabel = value !== 'none'
    ? `${PRIORITY_LABELS[value]} · ${value.charAt(0).toUpperCase() + value.slice(1)}`
    : 'None';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2 text-sm rounded-md border transition-colors
          bg-primary
          ${open
            ? 'border-accent ring-1 ring-accent/20'
            : 'border-subtle hover:border-[var(--color-text-dim)]'
          }
          focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20
        `}
      >
        <span style={color ? { color } : undefined} className={color ? 'font-medium' : 'text-[var(--color-text-primary)]'}>
          {displayLabel}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-dim flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-subtle bg-elevated shadow-lg py-1 max-h-60 overflow-y-auto">
          {PRIORITY_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            const optionColor = option.value !== 'none' ? PRIORITY_COLORS[option.value] : undefined;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent/10 ${isSelected ? 'bg-accent/5' : ''}`}
              >
                <span style={optionColor ? { color: optionColor } : undefined} className={optionColor ? 'font-medium' : 'text-[var(--color-text-primary)]'}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderPill({
  label,
  logo,
  selected,
  onClick,
}: {
  label: string;
  logo: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
        selected
          ? 'border-accent bg-accent/10 text-[var(--color-text-primary)]'
          : 'border-subtle bg-secondary text-[var(--color-text-secondary)] hover:bg-tertiary hover:border-[var(--color-text-secondary)]/50'
      }`}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center shrink-0">{logo}</span>
      <span>{label}</span>
    </button>
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
      onToggleLabel(label, false);
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

  const assignedIds = new Set(assignedLabels.map((label) => label.id));

  useEffect(() => {
    if (showCreate && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCreate]);

  return (
    <Modal open={true} onClose={onClose} title="Labels" size="sm">
      <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
        {projectLabels?.map((label) => {
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
              <IconButton
                icon={<X size={10} />}
                onClick={() => deleteLabel.mutate(label.id)}
                tooltip="Delete label"
                size="xs"
                className="text-dim hover:text-[var(--color-error)]"
              />
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
              if (e.key === 'Escape') {
                setShowCreate(false);
              }
            }}
            placeholder="Label name"
            className="w-full px-2 py-1 text-xs border border-subtle bg-primary rounded focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-1">
            {DEFAULT_LABEL_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setNewLabelColor(color)}
                className={`w-5 h-5 rounded-full transition-transform ${newLabelColor === color ? 'ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-bg-primary)] scale-110' : ''}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="xs"
              onClick={() => {
                if (newLabelName.trim()) {
                  createLabel.mutate({ name: newLabelName.trim(), color: newLabelColor });
                }
              }}
              disabled={!newLabelName.trim() || createLabel.isPending}
              loading={createLabel.isPending}
            >
              Create
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-subtle p-2">
          <Button
            variant="ghost"
            size="xs"
            icon={<Plus size={12} />}
            onClick={() => setShowCreate(true)}
            className="w-full justify-center"
          >
            Create Label
          </Button>
        </div>
      )}
    </Modal>
  );
}
