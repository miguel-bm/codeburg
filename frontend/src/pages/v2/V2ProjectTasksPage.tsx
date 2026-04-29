import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Clock3,
  GripVertical,
  Link2,
  MessageSquareText,
  Plus,
  Search,
  SquareStack,
  Trash2,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, Task, TaskLink, TaskStatus, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Modal } from '../../components/ui/Modal';
import { Button, V2Content, V2Header, V2Input, V2Panel, V2Textarea } from './v2-ui';

const COLUMNS: Array<{ id: TaskStatus; title: string; icon: typeof Circle; tone: string }> = [
  { id: 'backlog', title: 'Backlog', icon: Circle, tone: 'text-dim' },
  { id: 'in_progress', title: 'Active', icon: CircleDot, tone: 'text-[var(--color-accent)]' },
  { id: 'in_review', title: 'Review', icon: Clock3, tone: 'text-amber-400' },
  { id: 'done', title: 'Done', icon: CheckCircle2, tone: 'text-emerald-400' },
];

const STATUS_LABELS = new Map(COLUMNS.map((column) => [column.id, column.title]));

export function V2ProjectTasksPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<TaskStatus>('backlog');
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [linkTarget, setLinkTarget] = useState('');

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['v2-project-tasks', id],
    queryFn: () => v2Api.listProjectTasks(id!),
    enabled: !!id,
  });
  const { data: links = [] } = useQuery({
    queryKey: ['v2-project-task-links', id],
    queryFn: () => v2Api.listProjectTaskLinks(id!),
    enabled: !!id,
  });
  const { data: workspaces = [] } = useQuery({
    queryKey: ['v2-workspaces', id],
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });
  const { data: conversations = [] } = useQuery({
    queryKey: ['v2-project-conversations', id, 'tasks-page'],
    queryFn: () => v2Api.listProjectConversations(id!, { provider: 'pi' }),
    enabled: !!id,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-project-tasks', id] }),
      queryClient.invalidateQueries({ queryKey: ['v2-project-task-links', id] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
    ]);
  };

  const createTask = useMutation({
    mutationFn: async (status: TaskStatus) => {
      const task = await v2Api.createProjectTask(id!, {
        title: draftTitle.trim(),
        description: draftDescription.trim() || undefined,
      });
      if (status === 'backlog') return task;
      return v2Api.updateTaskTracking(task.id, { status });
    },
    onSuccess: async () => {
      setDraftTitle('');
      setDraftDescription('');
      setCreateOpen(false);
      setSelectedTaskId('');
      await invalidate();
    },
  });
  const updateTask = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: Parameters<typeof v2Api.updateTaskTracking>[1] }) =>
      v2Api.updateTaskTracking(taskId, input),
    onSuccess: invalidate,
  });
  const deleteTask = useMutation({
    mutationFn: (taskId: string) => v2Api.deleteProjectTask(taskId),
    onSuccess: async (_, taskId) => {
      if (selectedTaskId === taskId) setSelectedTaskId('');
      await invalidate();
    },
  });
  const createLink = useMutation({
    mutationFn: ({ taskId, target }: { taskId: string; target: LinkTarget }) =>
      v2Api.createTaskLink(taskId, {
        targetType: target.type,
        targetId: target.id,
        relationType: target.type,
      }),
    onSuccess: async () => {
      setLinkTarget('');
      await invalidate();
    },
  });
  const deleteLink = useMutation({
    mutationFn: (link: TaskLink) => v2Api.deleteTaskLink(link.taskId, link.id),
    onSuccess: invalidate,
  });

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    if (!normalizedSearch) return safeTasks;
    return safeTasks.filter((task) => (
      task.title.toLowerCase().includes(normalizedSearch) ||
      (task.description ?? '').toLowerCase().includes(normalizedSearch)
    ));
  }, [normalizedSearch, safeTasks]);
  const linksByTask = useMemo(() => {
    const grouped = new Map<string, TaskLink[]>();
    for (const link of links) {
      grouped.set(link.taskId, [...(grouped.get(link.taskId) ?? []), link]);
    }
    return grouped;
  }, [links]);
  const tasksByStatus = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const column of COLUMNS) grouped.set(column.id, []);
    const sorted = [...filteredTasks].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    for (const task of sorted) grouped.set(task.status, [...(grouped.get(task.status) ?? []), task]);
    return grouped;
  }, [filteredTasks]);
  const selectedTask = safeTasks.find((task) => task.id === selectedTaskId) ?? null;
  const availableTargets = useMemo<LinkTarget[]>(() => [
    ...workspaces.map((workspace) => ({
      type: 'workspace' as const,
      id: workspace.id,
      label: workspace.name,
      meta: workspace.branchName,
    })),
    ...conversations.map((conversation) => ({
      type: 'conversation' as const,
      id: conversation.id,
      label: conversation.title,
      meta: conversation.status,
    })),
  ], [conversations, workspaces]);
  const selectedLinks = selectedTask ? linksByTask.get(selectedTask.id) ?? [] : [];
  const linkedTargetIds = useMemo(() => (
    new Set(selectedLinks.map((link) => `${link.targetType}:${link.targetId}`))
  ), [selectedLinks]);
  const attachableTargets = availableTargets.filter((target) => !linkedTargetIds.has(`${target.type}:${target.id}`));
  const chosenTarget = attachableTargets.find((target) => `${target.type}:${target.id}` === linkTarget);
  const currentWorkspaceId = searchParams.get('workspace');
  const quickTargets = useMemo(() => {
    const targets: LinkTarget[] = [];
    const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
    if (currentWorkspace) {
      targets.push({
        type: 'workspace',
        id: currentWorkspace.id,
        label: currentWorkspace.name,
        meta: currentWorkspace.branchName,
      });
    }
    for (const workspace of workspaces.filter((workspace) => workspace.status === 'active')) {
      if (targets.some((target) => target.type === 'workspace' && target.id === workspace.id)) continue;
      targets.push({ type: 'workspace', id: workspace.id, label: workspace.name, meta: workspace.branchName });
      if (targets.length >= 3) break;
    }
    const recentConversations = [...conversations]
      .filter((conversation) => conversation.status === 'active')
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    for (const conversation of recentConversations) {
      if (targets.length >= 6) break;
      targets.push({ type: 'conversation', id: conversation.id, label: conversation.title, meta: conversation.status });
    }
    return targets.filter((target) => !linkedTargetIds.has(`${target.type}:${target.id}`));
  }, [conversations, currentWorkspaceId, linkedTargetIds, workspaces]);
  const activeCount = safeTasks.filter((task) => task.status === 'in_progress').length;

  useEffect(() => {
    if (!selectedTask) {
      setEditTitle('');
      setEditDescription('');
      setLinkTarget('');
      return;
    }
    setEditTitle(selectedTask.title);
    setEditDescription(selectedTask.description ?? '');
    setLinkTarget('');
  }, [selectedTask]);

  const saveSelectedTask = () => {
    if (!selectedTask || !editTitle.trim()) return;
    updateTask.mutate({
      taskId: selectedTask.id,
      input: {
        title: editTitle.trim(),
        description: editDescription.trim(),
      },
    }, {
      onSuccess: () => setSelectedTaskId(''),
    });
  };

  const selectedTaskChanged = !!selectedTask && (editTitle.trim() !== selectedTask.title || editDescription.trim() !== (selectedTask.description ?? ''));
  const draftChanged = draftTitle.trim() !== '' || draftDescription.trim() !== '';
  const closeTaskDialog = () => {
    if (selectedTaskChanged && !window.confirm('Discard unsaved task changes?')) return;
    setSelectedTaskId('');
  };
  const closeCreateDialog = () => {
    if (draftChanged && !window.confirm('Discard this new task?')) return;
    setCreateOpen(false);
    setDraftTitle('');
    setDraftDescription('');
  };
  const openCreateDialog = (status: TaskStatus) => {
    setCreateStatus(status);
    setDraftTitle('');
    setDraftDescription('');
    setCreateOpen(true);
  };

  const handleDrop = (status: TaskStatus, beforeTaskId?: string) => {
    const task = safeTasks.find((candidate) => candidate.id === draggingTaskId);
    setDraggingTaskId(null);
    setDragOverStatus(null);
    setDragOverTaskId(null);
    if (!task) return;
    const columnTasks = (tasksByStatus.get(status) ?? []).filter((candidate) => candidate.id !== task.id);
    const beforeIndex = beforeTaskId ? columnTasks.findIndex((candidate) => candidate.id === beforeTaskId) : -1;
    const position = beforeIndex >= 0 ? beforeIndex : columnTasks.length;
    if (task.status === status && task.position === position) return;
    updateTask.mutate({ taskId: task.id, input: { status, position } });
  };

  return (
    <TaskScreen
      projectId={project?.id}
      title={project?.name ?? 'Project'}
      taskCount={safeTasks.length}
      activeCount={activeCount}
      search={search}
      onSearch={setSearch}
    >
      <V2Content className="min-h-0 px-0 py-0 md:px-4 md:pb-4">
        <V2Panel className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] px-3 py-2 md:px-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">Board</div>
              <div className="mt-0.5 truncate text-xs text-dim">
                {normalizedSearch ? `${filteredTasks.length} of ${safeTasks.length} matching` : `${activeCount} active, ${safeTasks.length} total`}
              </div>
            </div>
            <Button
              size="xs"
              variant="secondary"
              icon={<Plus size={13} />}
              onClick={() => {
                openCreateDialog('backlog');
              }}
            >
              New task
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 auto-cols-[minmax(18rem,86vw)] grid-flow-col gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain md:auto-cols-[minmax(19rem,22rem)] lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-4 lg:overflow-auto">
            {COLUMNS.map((column) => {
              const columnTasks = tasksByStatus.get(column.id) ?? [];
              const Icon = column.icon;
              const activeDrop = dragOverStatus === column.id;
              return (
                <section
                  key={column.id}
                  className={`flex min-h-[24rem] min-w-[18rem] flex-col border-b border-[var(--color-card-border)] bg-primary/35 transition-colors lg:border-b-0 lg:border-r ${
                    activeDrop ? 'bg-accent/5' : ''
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverStatus(column.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverStatus(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(column.id);
                  }}
                >
                  <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-card-border)] bg-card px-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon size={14} className={column.tone} />
                      <span className="truncate text-sm font-medium">{column.title}</span>
                    </div>
                    <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] text-dim">{columnTasks.length}</span>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        links={linksByTask.get(task.id) ?? []}
                        workspaces={workspaces}
                        conversations={conversations}
                        onSelect={() => setSelectedTaskId(task.id)}
                        dragOver={dragOverTaskId === task.id}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDragOverStatus(column.id);
                          setDragOverTaskId(task.id);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleDrop(column.id, task.id);
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', task.id);
                          setDraggingTaskId(task.id);
                        }}
                        onDragEnd={() => {
                          setDraggingTaskId(null);
                          setDragOverStatus(null);
                        }}
                      />
                    ))}

                    <button
                      type="button"
                      onClick={() => openCreateDialog(column.id)}
                      className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-dim hover:bg-card hover:text-[var(--color-text-primary)] md:h-9 md:text-xs"
                    >
                      <Plus size={13} />
                      Add task
                    </button>

                    {safeTasks.length === 0 && column.id === 'backlog' && (
                      <div className="rounded-lg bg-card px-3 py-4 text-sm">
                        <div className="flex items-center gap-2 font-medium">
                          <Archive size={15} className="text-dim" />
                          Optional by default
                        </div>
                        <p className="mt-2 text-xs leading-5 text-dim">
                          Tasks stay project-local. Workspaces and conversations can ignore them until tracking becomes useful.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </V2Panel>
      </V2Content>
      <TaskDialog
        task={selectedTask}
        links={selectedLinks}
        workspaces={workspaces}
        conversations={conversations}
        editTitle={editTitle}
        editDescription={editDescription}
        linkTarget={linkTarget}
        attachableTargets={attachableTargets}
        chosenTarget={chosenTarget}
        quickTargets={quickTargets}
        pending={updateTask.isPending || deleteTask.isPending || createLink.isPending || deleteLink.isPending}
        onClose={closeTaskDialog}
        onEditTitle={setEditTitle}
        onEditDescription={setEditDescription}
        onSave={saveSelectedTask}
        onCancelEdit={() => {
          if (!selectedTask) return;
          setEditTitle(selectedTask.title);
          setEditDescription(selectedTask.description ?? '');
        }}
        onStatusChange={(status) => {
          if (!selectedTask) return;
          updateTask.mutate({ taskId: selectedTask.id, input: { status } });
        }}
        onDelete={() => {
          if (!selectedTask) return;
          if (!window.confirm(`Delete "${selectedTask.title}"?`)) return;
          deleteTask.mutate(selectedTask.id);
        }}
        onLinkTargetChange={setLinkTarget}
        onCreateLink={() => {
          if (!selectedTask || !chosenTarget) return;
          createLink.mutate({ taskId: selectedTask.id, target: chosenTarget });
        }}
        onDeleteLink={(link) => deleteLink.mutate(link)}
        onQuickAttach={(target) => {
          if (!selectedTask) return;
          createLink.mutate({ taskId: selectedTask.id, target });
        }}
      />
      <CreateTaskDialog
        open={createOpen}
        status={createStatus}
        title={draftTitle}
        description={draftDescription}
        pending={createTask.isPending}
        error={createTask.error instanceof Error ? createTask.error.message : undefined}
        onClose={closeCreateDialog}
        onStatusChange={setCreateStatus}
        onTitleChange={setDraftTitle}
        onDescriptionChange={setDraftDescription}
        onSubmit={() => {
          if (!draftTitle.trim()) return;
          createTask.mutate(createStatus);
        }}
      />
    </TaskScreen>
  );
}

function TaskScreen({
  projectId,
  title,
  taskCount,
  activeCount,
  search,
  onSearch,
  children,
}: {
  projectId?: string;
  title: string;
  taskCount: number;
  activeCount: number;
  search: string;
  onSearch: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-[var(--color-text-primary)]">
      <V2Header
        backTo={projectId ? `/projects/${projectId}` : '/'}
        backLabel="Back to workspace"
        eyebrow="Project tasks"
        title={title}
        subtitle={taskCount === 0 ? 'Optional tracking for projects that need a memory layer.' : `${taskCount} task${taskCount === 1 ? '' : 's'}, ${activeCount} active`}
        actions={
          <label className="flex h-8 items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-primary px-2">
            <Search size={14} className="text-dim" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search"
              className="h-full w-40 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
            />
          </label>
        }
      />
      {children}
    </div>
  );
}

type LinkTarget = {
  type: 'workspace' | 'conversation';
  id: string;
  label: string;
  meta: string;
};

type SelectOption<T extends string> = {
  value: T;
  label: string;
  meta?: string;
  icon?: ReactNode;
};

function MenuSelect<T extends string>({
  value,
  options,
  placeholder,
  onChange,
  className = '',
}: {
  value: T | '';
  options: SelectOption<T>[];
  placeholder: string;
  onChange: (value: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`relative ${className}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-[44px] w-full cursor-pointer items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-primary px-3 text-left text-sm text-[var(--color-text-primary)] outline-none transition hover:bg-[var(--color-card-hover)] focus:border-[var(--color-accent)] md:h-8 md:px-2.5"
      >
        {selected?.icon && <span className="flex shrink-0 items-center text-dim">{selected.icon}</span>}
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-dim'}`}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.meta && <span className="hidden max-w-28 shrink-0 truncate text-xs text-dim sm:inline">{selected.meta}</span>}
        <ChevronDown size={14} className={`shrink-0 text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-[90] max-h-64 overflow-auto rounded-lg border border-[var(--color-card-border)] bg-card p-1 shadow-[var(--shadow-card)]">
          {options.length === 0 ? (
            <div className="px-2 py-2 text-xs text-dim">Nothing available</div>
          ) : options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-[var(--color-card-hover)] ${
                option.value === value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {option.icon && <span className="flex shrink-0 items-center text-dim">{option.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.meta && <span className="max-w-32 shrink-0 truncate text-xs text-dim">{option.meta}</span>}
              {option.value === value && <Check size={13} className="shrink-0 text-[var(--color-accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTaskDialog({
  open,
  status,
  title,
  description,
  pending,
  error,
  onClose,
  onStatusChange,
  onTitleChange,
  onDescriptionChange,
  onSubmit,
}: {
  open: boolean;
  status: TaskStatus;
  title: string;
  description: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onStatusChange: (value: TaskStatus) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" variant="primary" icon={<Check size={14} />} loading={pending} disabled={!title.trim()} onClick={onSubmit}>
            Save
          </Button>
        </div>
      )}
    >
      <form
        className="px-4 py-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Title</span>
              <V2Input
                autoFocus
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Task title"
                className="w-full bg-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Status</span>
              <MenuSelect
                value={status}
                placeholder="Choose status"
                options={COLUMNS.map((item) => ({
                  value: item.id,
                  label: item.title,
                  icon: <item.icon size={14} className={item.tone} />,
                }))}
                onChange={onStatusChange}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Notes</span>
            <V2Textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Scope, decisions, or next step"
              className="min-h-40 w-full resize-y bg-primary"
            />
          </label>
          {error && <div className="text-xs text-[var(--color-error)]">{error}</div>}
        </div>
      </form>
    </Modal>
  );
}

function TaskCard({
  task,
  links,
  workspaces,
  conversations,
  dragOver,
  onSelect,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  links: TaskLink[];
  workspaces: Workspace[];
  conversations: Conversation[];
  dragOver: boolean;
  onSelect: () => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      draggable
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border bg-card shadow-sm transition ${
        dragOver ? 'border-[var(--color-accent)]/50 bg-accent/5' : 'border-transparent hover:border-[var(--color-card-border)]'
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full cursor-pointer px-3 py-2 text-left">
        <div className="flex items-start gap-2">
          <GripVertical size={14} className="mt-0.5 shrink-0 text-dim" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium leading-5">{task.title}</span>
              <span className="shrink-0 text-[10px] uppercase text-dim">CB-{task.id.slice(-4)}</span>
            </div>
            {task.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-dim">{task.description}</p>}
            {links.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {links.slice(0, 3).map((link) => (
                  <RelationChip key={link.id} link={link} workspaces={workspaces} conversations={conversations} />
                ))}
                {links.length > 3 && <span className="text-xs text-dim">+{links.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}

function TaskDialog({
  task,
  links,
  workspaces,
  conversations,
  editTitle,
  editDescription,
  linkTarget,
  attachableTargets,
  chosenTarget,
  quickTargets,
  pending,
  onClose,
  onEditTitle,
  onEditDescription,
  onSave,
  onCancelEdit,
  onStatusChange,
  onDelete,
  onLinkTargetChange,
  onCreateLink,
  onDeleteLink,
  onQuickAttach,
}: {
  task: Task | null;
  links: TaskLink[];
  workspaces: Workspace[];
  conversations: Conversation[];
  editTitle: string;
  editDescription: string;
  linkTarget: string;
  attachableTargets: LinkTarget[];
  chosenTarget?: LinkTarget;
  quickTargets: LinkTarget[];
  pending: boolean;
  onClose: () => void;
  onEditTitle: (value: string) => void;
  onEditDescription: (value: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onDelete: () => void;
  onLinkTargetChange: (value: string) => void;
  onCreateLink: () => void;
  onDeleteLink: (link: TaskLink) => void;
  onQuickAttach: (target: LinkTarget) => void;
}) {
  const changed = !!task && (editTitle.trim() !== task.title || editDescription.trim() !== (task.description ?? ''));

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={task ? `CB-${task.id.slice(-4)}` : 'Task'}
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={!task || pending}
            onClick={onDelete}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:cursor-default disabled:opacity-40"
          >
            <Trash2 size={13} />
            Delete
          </button>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="ghost" disabled={!changed || pending} onClick={onCancelEdit}>
              Reset
            </Button>
            <Button type="button" size="sm" variant="primary" icon={<Check size={14} />} disabled={!changed || !editTitle.trim()} loading={pending} onClick={onSave}>
              Save
            </Button>
          </div>
        </div>
      )}
    >
      {task && (
        <div className="max-h-[calc(100dvh-7.5rem)] overflow-auto px-4 py-4 sm:max-h-[min(74vh,46rem)] sm:px-6">
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Title</span>
                <V2Input value={editTitle} onChange={(event) => onEditTitle(event.target.value)} className="w-full bg-primary" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Status</span>
                <MenuSelect
                  value={task.status}
                  placeholder="Choose status"
                  options={COLUMNS.map((item) => ({
                    value: item.id,
                    label: item.title,
                    icon: <item.icon size={14} className={item.tone} />,
                  }))}
                  onChange={onStatusChange}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Notes</span>
              <V2Textarea
                value={editDescription}
                onChange={(event) => onEditDescription(event.target.value)}
                placeholder="Scope, decisions, or next step"
                className="min-h-44 w-full resize-y bg-primary"
              />
            </label>

            <section className="border-t border-[var(--color-card-border)] pt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Related work</div>
                  <div className="mt-0.5 text-xs text-dim">Attach workspaces or conversations without making the task own them.</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {links.map((link) => (
                  <LinkedTargetRow
                    key={link.id}
                    link={link}
                    workspaces={workspaces}
                    conversations={conversations}
                    pending={pending}
                    onDelete={() => onDeleteLink(link)}
                  />
                ))}
                {links.length === 0 && <div className="rounded-md bg-primary px-2 py-2 text-xs leading-5 text-dim">No related work attached.</div>}
              </div>
              {quickTargets.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium text-[var(--color-text-secondary)]">Quick attach</div>
                  <div className="flex flex-wrap gap-1.5">
                    {quickTargets.slice(0, 6).map((target) => {
                      const Icon = target.type === 'workspace' ? SquareStack : MessageSquareText;
                      return (
                        <button
                          key={`${target.type}:${target.id}`}
                          type="button"
                          disabled={pending}
                          onClick={() => onQuickAttach(target)}
                          className="inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-md bg-primary px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
                        >
                          <Icon size={13} />
                          <span className="max-w-40 truncate">{target.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <MenuSelect
                  value={linkTarget}
                  placeholder="Attach workspace or conversation..."
                  options={attachableTargets.map((target) => ({
                    value: `${target.type}:${target.id}`,
                    label: target.label,
                    meta: target.type === 'workspace' ? 'Workspace' : 'Conversation',
                    icon: target.type === 'workspace' ? <SquareStack size={14} /> : <MessageSquareText size={14} />,
                  }))}
                  onChange={onLinkTargetChange}
                />
                <Button type="button" size="sm" variant="secondary" icon={<Link2 size={14} />} disabled={!chosenTarget || pending} onClick={onCreateLink} className="h-[44px] md:h-8">
                  Attach
                </Button>
              </div>
            </section>

            <section className="border-t border-[var(--color-card-border)] pt-4">
              <div className="mb-2 text-sm font-medium">Activity</div>
              <div className="grid gap-1.5">
                <ActivityRow label="Created" value={formatTaskDate(task.createdAt)} />
                <ActivityRow label="Status" value={STATUS_LABELS.get(task.status) ?? task.status} />
                {task.startedAt && <ActivityRow label="Started" value={formatTaskDate(task.startedAt)} />}
                {task.completedAt && <ActivityRow label="Completed" value={formatTaskDate(task.completedAt)} />}
                {links.length > 0 && <ActivityRow label="Related work" value={`${links.length} attached`} />}
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ActivityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 rounded-md bg-primary px-2 py-1.5 text-xs">
      <span className="text-dim">{label}</span>
      <span className="truncate text-[var(--color-text-secondary)]">{value}</span>
    </div>
  );
}

function formatTaskDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function RelationChip({ link, workspaces, conversations }: { link: TaskLink; workspaces: Workspace[]; conversations: Conversation[] }) {
  const workspace = link.targetType === 'workspace' ? workspaces.find((item) => item.id === link.targetId) : undefined;
  const conversation = link.targetType === 'conversation' ? conversations.find((item) => item.id === link.targetId) : undefined;
  const label = workspace?.name ?? conversation?.title ?? 'Missing relation';
  const Icon = link.targetType === 'workspace' ? SquareStack : MessageSquareText;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[11px] text-dim">
      <Icon size={11} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function LinkedTargetRow({
  link,
  workspaces,
  conversations,
  pending,
  onDelete,
}: {
  link: TaskLink;
  workspaces: Workspace[];
  conversations: Conversation[];
  pending: boolean;
  onDelete: () => void;
}) {
  const workspace = link.targetType === 'workspace' ? workspaces.find((item) => item.id === link.targetId) : undefined;
  const conversation = link.targetType === 'conversation' ? conversations.find((item) => item.id === link.targetId) : undefined;
  const Icon = link.targetType === 'workspace' ? SquareStack : MessageSquareText;
  const title = workspace?.name ?? conversation?.title ?? 'Missing relation';
  const meta = workspace?.branchName ?? conversation?.status ?? link.relationType;
  const href = workspace
    ? `/projects/${workspace.projectId}?workspace=${workspace.id}`
    : conversation
      ? `/conversations/${conversation.id}`
      : undefined;

  return (
    <div className="flex items-center gap-2 rounded-md bg-primary px-2 py-2">
      <Icon size={13} className="shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        {href ? (
          <Link to={href} className="block truncate text-xs font-medium hover:text-accent">{title}</Link>
        ) : (
          <div className="truncate text-xs font-medium">{title}</div>
        )}
        <div className="truncate text-[11px] text-dim">{meta}</div>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-40"
        title="Remove relation"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
