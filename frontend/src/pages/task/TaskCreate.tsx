import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bug,
  Check,
  ChevronDown,
  CornerDownLeft,
  GitBranch,
  Hammer,
  ListTodo,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSetHeader } from '../../components/layout/Header';
import { tasksApi, sessionsApi, invalidateTaskQueries, projectsApi, labelsApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Label, Project } from '../../api/types';
import type { SessionProvider } from '../../api/sessions';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Toggle } from '../../components/ui/settings';
import { MarkdownField } from '../../components/ui/MarkdownField';
import { DEFAULT_LABEL_COLORS } from '../../constants/tasks';
import { buildBranchName, pickColorFromName } from '../../utils/text';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';

type CreateMode = 'backlog' | 'in_progress';
type WizardProvider = SessionProvider | 'none';

type TaskTypeValue = 'feature' | 'bug' | 'investigation' | 'chore' | 'improvement' | 'task';

interface TaskTypeOption {
  value: TaskTypeValue;
  label: string;
  icon: LucideIcon;
}

interface PriorityOption {
  value: 'none' | 'urgent' | 'high' | 'medium' | 'low';
  label: string;
  color?: string;
}

function parseCreateMode(status: string | null): CreateMode {
  return status === TASK_STATUS.IN_PROGRESS ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.BACKLOG;
}

function buildSessionPrompt(title: string, description: string): string {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();

  if (!cleanTitle && !cleanDescription) return '';
  if (!cleanDescription) return cleanTitle;
  if (!cleanTitle) return cleanDescription;

  return `Task: ${cleanTitle}\n\nDescription:\n${cleanDescription}`;
}

function detectTaskTypeFromTitle(title: string): TaskTypeValue | null {
  const normalized = title.trim().toLowerCase();
  const match = normalized.match(/^([a-z]+)/);
  const prefix = match?.[1] ?? '';

  if (prefix === 'feat' || prefix === 'feature') return 'feature';
  if (prefix === 'fix') return 'bug';
  if (prefix === 'refactor') return 'improvement';
  if (prefix === 'chore') return 'chore';
  if (prefix === 'investigate' || prefix === 'investigation') return 'investigation';
  return null;
}

function pickLabelColor(name: string): string {
  return pickColorFromName(name, DEFAULT_LABEL_COLORS);
}

const TASK_TYPE_OPTIONS: TaskTypeOption[] = [
  { value: 'feature', label: 'Feature', icon: Sparkles },
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'investigation', label: 'Investigation', icon: Search },
  { value: 'chore', label: 'Chore', icon: Hammer },
  { value: 'improvement', label: 'Improvement', icon: Wrench },
  { value: 'task', label: 'Task', icon: ListTodo },
];

const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 'none', label: 'None' },
  { value: 'urgent', label: 'P0 · Urgent', color: 'var(--color-error)' },
  { value: 'high', label: 'P1 · High', color: '#f97316' },
  { value: 'medium', label: 'P2 · Medium', color: '#eab308' },
  { value: 'low', label: 'P3 · Low', color: 'var(--color-text-dim)' },
];

export function TaskCreate() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const { isExpanded, toggleExpanded, navigateToPanel, closePanel } = usePanelNavigation();

  const mode = parseCreateMode(searchParams.get('status'));
  const isInProgressCreate = mode === TASK_STATUS.IN_PROGRESS;
  const defaultProjectId = searchParams.get('project') || '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<TaskTypeValue>('feature');
  const [taskTypeTouched, setTaskTypeTouched] = useState(false);
  const [priority, setPriority] = useState<PriorityOption['value']>('none');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [branch, setBranch] = useState('');
  const [branchDirty, setBranchDirty] = useState(false);
  const [pendingLabels, setPendingLabels] = useState<Label[]>([]);

  const [provider, setProvider] = useState<WizardProvider>(isInProgressCreate ? 'claude' : 'none');
  const [includePrompt, setIncludePrompt] = useState(true);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const sortedProjects = useMemo(
    () => [...(projects ?? [])].filter((p) => !p.hidden).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const { data: projectLabels = [] } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => labelsApi.list(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!projectId && sortedProjects.length === 1) {
      setProjectId(sortedProjects[0].id);
    } else if (!projectId && defaultProjectId) {
      const defaultIsVisible = sortedProjects.some((p) => p.id === defaultProjectId);
      if (defaultIsVisible) setProjectId(defaultProjectId);
    }
  }, [defaultProjectId, projectId, sortedProjects]);

  useEffect(() => {
    if (!taskTypeTouched) {
      const autoType = detectTaskTypeFromTitle(title);
      if (autoType && autoType !== taskType) {
        setTaskType(autoType);
      }
    }
  }, [title, taskType, taskTypeTouched]);

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
      setBranch(title.trim() ? buildBranchName(title) : '');
    }
  }, [title, branchDirty]);

  useEffect(() => {
    const validIds = new Set(projectLabels.map((label) => label.id));
    setPendingLabels((labels) => labels.filter((label) => validIds.has(label.id)));
  }, [projectLabels]);

  useEffect(() => {
    const id = window.setTimeout(() => titleRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, []);

  const selectedProject = sortedProjects.find((project) => project.id === projectId);
  const showPromptToggle = provider === 'claude' || provider === 'codex';

  const sessionPromptPreview = useMemo(
    () => buildSessionPrompt(title, description),
    [title, description],
  );

  const createLabelMutation = useMutation({
    mutationFn: (name: string) => labelsApi.create(projectId, { name, color: pickLabelColor(name) }),
    onSuccess: (label) => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      setPendingLabels((labels) => labels.some((entry) => entry.id === label.id) ? labels : [...labels, label]);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim();
      const trimmedDescription = description.trim();
      const effectivePriority = priority === 'none' ? undefined : priority;

      const task = await tasksApi.create(projectId, {
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        taskType,
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
      navigateToPanel(sessionId ? `/tasks/${taskId}?session=${sessionId}` : `/tasks/${taskId}`);
    },
  });

  const canCreate = title.trim().length > 0 && !!projectId && !createMutation.isPending;

  const handleClose = () => closePanel();

  const handleSubmit = () => {
    if (!canCreate) return;
    createMutation.mutate();
  };

  const handleInputEsc = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const handleTitleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    handleInputEsc(e);
  };

  const handleDescriptionKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
          className="text-dim hover:text-[var(--color-text-primary)] transition-colors min-w-0 truncate text-sm"
          title={selectedProject?.name || 'back'}
        >
          {selectedProject?.name || 'back'}
        </button>
        <span className="text-dim shrink-0">/</span>
        <h1 className="text-sm font-medium text-dim shrink-0">
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
          icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          onClick={toggleExpanded}
          tooltip={isExpanded ? 'Collapse panel' : 'Expand panel'}
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
    `task-create-${mode}-${projectId}-${selectedProject?.name ?? ''}-${canCreate}-${createMutation.isPending}-${isExpanded}`,
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
          <Field label="Project">
            <ProjectSearchSelect
              projects={sortedProjects}
              value={projectId}
              onChange={setProjectId}
              disabled={createMutation.isPending}
            />
          </Field>

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

          <div className="px-3 py-2 border border-subtle bg-primary rounded-lg focus-within:border-accent">
            <MarkdownField
              value={description}
              onChange={setDescription}
              onKeyDown={handleDescriptionKeyDown}
              disabled={createMutation.isPending}
              rows={4}
              minHeight="88px"
            />
          </div>

          <Field label="Type">
            <div className="space-y-2">
              <TaskTypeToggle
                value={taskType}
                options={TASK_TYPE_OPTIONS}
                onChange={(next) => {
                  setTaskType(next);
                  setTaskTypeTouched(true);
                }}
              />
              {taskTypeTouched && (
                <button
                  type="button"
                  onClick={() => {
                    setTaskTypeTouched(false);
                    const autoType = detectTaskTypeFromTitle(title);
                    if (autoType) {
                      setTaskType(autoType);
                    }
                  }}
                  className="text-[11px] text-dim hover:text-[var(--color-text-primary)]"
                >
                  Resume auto type detection from title
                </button>
              )}
            </div>
          </Field>

          <Field label="Priority">
            <PriorityToggle value={priority} onChange={setPriority} />
          </Field>

          <Field label="Branch">
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
                    setBranch(title.trim() ? buildBranchName(title) : '');
                    setBranchDirty(false);
                  }}
                  className="text-[10px] text-dim hover:text-[var(--color-text-primary)] shrink-0"
                >
                  reset
                </button>
              )}
            </div>
            <p className="text-[11px] text-dim mt-1">Colon separators are converted to path separators.</p>
          </Field>

          <Field label="Labels">
            <LabelPicker
              labels={projectLabels}
              selected={pendingLabels}
              onToggle={(label) => {
                setPendingLabels((labels) => {
                  const exists = labels.some((entry) => entry.id === label.id);
                  return exists
                    ? labels.filter((entry) => entry.id !== label.id)
                    : [...labels, label];
                });
              }}
              onCreate={(name) => createLabelMutation.mutate(name)}
              createPending={createLabelMutation.isPending}
              disabled={!projectId || createMutation.isPending}
            />
          </Field>

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

function ProjectSearchSelect({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const selected = projects.find((project) => project.id === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => {
      return project.name.toLowerCase().includes(normalized)
        || project.path.toLowerCase().includes(normalized);
    });
  }, [projects, query]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`w-full px-3 py-2 rounded-md border bg-primary flex items-center justify-between gap-2 text-left ${
          open ? 'border-accent ring-1 ring-accent/20' : 'border-subtle hover:border-[var(--color-text-dim)]'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <div className="min-w-0">
          <div className="text-sm text-[var(--color-text-primary)] truncate">
            {selected?.name ?? 'Select project'}
          </div>
          {selected?.path && (
            <div className="text-[11px] text-dim truncate">{selected.path}</div>
          )}
        </div>
        <ChevronDown size={14} className={`text-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-subtle bg-elevated shadow-lg shadow-black/25 overflow-hidden">
          <div className="p-2 border-b border-subtle">
            <label className="relative block">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects..."
                className="w-full h-8 rounded-md border border-subtle bg-primary pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-xs text-dim text-center">No matching projects.</div>
            ) : (
              filtered.map((project) => {
                const active = project.id === value;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      onChange(project.id);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-2 py-2 rounded-md transition-colors ${active ? 'bg-accent/10 text-accent' : 'hover:bg-tertiary text-[var(--color-text-primary)]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">{project.name}</span>
                      {active && <Check size={12} className="shrink-0" />}
                    </div>
                    <div className="text-[11px] text-dim truncate mt-0.5">{project.path}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskTypeToggle({
  value,
  options,
  onChange,
}: {
  value: TaskTypeValue;
  options: TaskTypeOption[];
  onChange: (value: TaskTypeValue) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${
              active
                ? 'border-accent bg-accent/12 text-[var(--color-text-primary)]'
                : 'border-subtle bg-primary text-[var(--color-text-secondary)] hover:border-[var(--color-text-dim)]'
            }`}
          >
            <Icon size={14} className={active ? 'text-accent' : 'text-dim'} />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PriorityToggle({
  value,
  onChange,
}: {
  value: PriorityOption['value'];
  onChange: (value: PriorityOption['value']) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
      {PRIORITY_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-2 py-2 text-xs sm:text-[11px] font-medium transition-colors ${
              active
                ? 'border-accent bg-accent/12'
                : 'border-subtle bg-primary hover:border-[var(--color-text-dim)]'
            }`}
            style={option.color ? { color: option.color } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function LabelPicker({
  labels,
  selected,
  onToggle,
  onCreate,
  createPending,
  disabled,
}: {
  labels: Label[];
  selected: Label[];
  onToggle: (label: Label) => void;
  onCreate: (name: string) => void;
  createPending: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const selectedIds = useMemo(() => new Set(selected.map((label) => label.id)), [selected]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
    if (!normalized) return sorted;
    return sorted.filter((label) => label.name.toLowerCase().includes(normalized));
  }, [labels, query]);

  const canCreate = query.trim().length > 0
    && !labels.some((label) => label.name.toLowerCase() === query.trim().toLowerCase());

  const handleCreate = () => {
    const name = query.trim();
    if (!name || createPending) return;
    onCreate(name);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="border border-subtle rounded-lg bg-primary px-2.5 py-2 space-y-2">
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selected.map((label) => (
              <span
                key={label.id}
                className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
                <button
                  type="button"
                  onClick={() => onToggle(label)}
                  className="hover:opacity-70"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        <label className="relative block">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (canCreate) {
                  handleCreate();
                } else if (filtered.length > 0) {
                  onToggle(filtered[0]);
                }
              }
            }}
            placeholder={disabled ? 'Select a project first' : 'Search labels or create new...'}
            className="w-full h-8 rounded-md border border-subtle bg-primary pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
      </div>

      {open && !disabled && (
        <div className="rounded-lg border border-subtle bg-elevated overflow-hidden">
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-1">
            {filtered.map((label) => {
              const active = selectedIds.has(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => onToggle(label)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                    active ? 'bg-accent/10 text-accent' : 'hover:bg-tertiary text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                    <span className="text-xs truncate">{label.name}</span>
                  </span>
                  {active && <Check size={12} className="shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-3 text-xs text-dim text-center">No matching labels.</div>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={createPending}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
              >
                <Plus size={12} />
                Create "{query.trim()}"
              </button>
            )}
          </div>
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
