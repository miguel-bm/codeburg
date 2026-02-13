import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CornerDownLeft,
  GitBranch,
  Maximize2,
  Minimize2,
  Play,
  Terminal,
  X,
} from 'lucide-react';
import { useSetHeader } from '../../components/layout/Header';
import { tasksApi, sessionsApi, invalidateTaskQueries, projectsApi, labelsApi } from '../../api';
import { TASK_STATUS } from '../../api/types';
import type { Label } from '../../api/types';
import type { SessionProvider } from '../../api/sessions';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Toggle } from '../../components/ui/settings';
import { MarkdownField } from '../../components/ui/MarkdownField';
import { DEFAULT_LABEL_COLORS } from '../../constants/tasks';
import { buildBranchName, pickColorFromName } from '../../utils/text';
import {
  Field,
  LabelPicker,
  PriorityToggle,
  ProjectSearchSelect,
  ProviderPill,
  TaskTypeToggle,
} from './components/TaskCreateFormParts';
import { TASK_TYPE_OPTIONS } from './components/taskCreateOptions';
import type { PriorityValue, TaskTypeValue } from './components/taskCreateOptions';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';

type CreateMode = 'backlog' | 'in_progress';
type WizardProvider = SessionProvider | 'none';

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
  const [priority, setPriority] = useState<PriorityValue>('none');
  const [manualProjectId, setManualProjectId] = useState(defaultProjectId);
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

  const projectId = useMemo(() => {
    if (manualProjectId) return manualProjectId;
    if (sortedProjects.length === 1) return sortedProjects[0].id;
    if (defaultProjectId) {
      const defaultIsVisible = sortedProjects.some((project) => project.id === defaultProjectId);
      if (defaultIsVisible) return defaultProjectId;
    }
    return '';
  }, [defaultProjectId, manualProjectId, sortedProjects]);

  const autoDetectedTaskType = useMemo(
    () => detectTaskTypeFromTitle(title),
    [title],
  );

  const effectiveTaskType = taskTypeTouched
    ? taskType
    : (autoDetectedTaskType ?? taskType);

  const effectiveProvider: WizardProvider = isInProgressCreate
    ? (provider === 'none' ? 'claude' : provider)
    : 'none';

  const autoBranch = useMemo(
    () => (title.trim() ? buildBranchName(title) : ''),
    [title],
  );

  const effectiveBranch = branchDirty ? branch : autoBranch;

  const { data: projectLabels = [] } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => labelsApi.list(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    const id = window.setTimeout(() => titleRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, []);

  const selectedProject = sortedProjects.find((project) => project.id === projectId);
  const showPromptToggle = effectiveProvider === 'claude' || effectiveProvider === 'codex';
  const filteredPendingLabels = useMemo(() => {
    const validIds = new Set(projectLabels.map((label) => label.id));
    return pendingLabels.filter((label) => validIds.has(label.id));
  }, [pendingLabels, projectLabels]);

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
        taskType: effectiveTaskType,
        priority: effectivePriority,
        branch: effectiveBranch.trim() || undefined,
      });

      if (filteredPendingLabels.length > 0) {
        await Promise.all(filteredPendingLabels.map((label) => labelsApi.assign(task.id, label.id)));
      }

      let sessionId: string | undefined;

      if (isInProgressCreate) {
        await tasksApi.update(task.id, { status: TASK_STATUS.IN_PROGRESS });

        if (effectiveProvider !== 'none') {
          const shouldSendPrompt = showPromptToggle && includePrompt;
          const sessionPrompt = shouldSendPrompt
            ? buildSessionPrompt(trimmedTitle, trimmedDescription)
            : '';

          const session = await sessionsApi.start(task.id, {
            provider: effectiveProvider as SessionProvider,
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5 min-h-full">
          <Field label="Project">
            <ProjectSearchSelect
              projects={sortedProjects}
              value={projectId}
              onChange={setManualProjectId}
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

          <div className="flex-1 flex flex-col min-h-[120px] px-3 py-2 border border-subtle bg-primary rounded-lg focus-within:border-accent">
            <MarkdownField
              value={description}
              onChange={setDescription}
              onKeyDown={handleDescriptionKeyDown}
              disabled={createMutation.isPending}
              rows={4}
              minHeight="0"
              className="flex-1 flex flex-col"
            />
          </div>

          <Field label="Type">
            <div className="space-y-2">
              <TaskTypeToggle
                value={effectiveTaskType}
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
                value={effectiveBranch}
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
                    setBranch(autoBranch);
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
              selected={filteredPendingLabels}
              onToggle={(label) => {
                setPendingLabels((labels) => {
                  const validIds = new Set(projectLabels.map((entry) => entry.id));
                  const validLabels = labels.filter((entry) => validIds.has(entry.id));
                  const exists = validLabels.some((entry) => entry.id === label.id);
                  return exists
                    ? validLabels.filter((entry) => entry.id !== label.id)
                    : [...validLabels, label];
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
                    selected={effectiveProvider === 'claude'}
                    onClick={() => setProvider('claude')}
                  />
                  <ProviderPill
                    label="Codex"
                    logo={<img src={openaiLogo} alt="" className="h-4 w-4 object-contain" />}
                    selected={effectiveProvider === 'codex'}
                    onClick={() => setProvider('codex')}
                  />
                  <ProviderPill
                    label="Terminal"
                    logo={<Terminal size={14} className="text-[var(--color-text-primary)]" />}
                    selected={effectiveProvider === 'terminal'}
                    onClick={() => setProvider('terminal')}
                  />
                  <ProviderPill
                    label="None"
                    logo={<span className="text-xs text-dim">-</span>}
                    selected={effectiveProvider === 'none'}
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

              {effectiveProvider === 'terminal' && (
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
