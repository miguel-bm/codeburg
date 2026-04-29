import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  CheckCircle2,
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
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, Task, TaskLink, TaskStatus, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Button, V2Content, V2Header, V2Input, V2Panel, V2Select, V2Textarea } from './v2-ui';

const COLUMNS: Array<{ id: TaskStatus; title: string; icon: typeof Circle; tone: string }> = [
  { id: 'backlog', title: 'Backlog', icon: Circle, tone: 'text-dim' },
  { id: 'in_progress', title: 'Active', icon: CircleDot, tone: 'text-[var(--color-accent)]' },
  { id: 'in_review', title: 'Review', icon: Clock3, tone: 'text-amber-400' },
  { id: 'done', title: 'Done', icon: CheckCircle2, tone: 'text-emerald-400' },
];

export function V2ProjectTasksPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [composerStatus, setComposerStatus] = useState<TaskStatus>('backlog');
  const [composerOpen, setComposerOpen] = useState<TaskStatus | null>('backlog');
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
    onSuccess: async (task) => {
      setDraftTitle('');
      setDraftDescription('');
      setComposerOpen(null);
      setSelectedTaskId(task.id);
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
    for (const task of filteredTasks) grouped.set(task.status, [...(grouped.get(task.status) ?? []), task]);
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
  const linkedTargetIds = new Set(selectedLinks.map((link) => `${link.targetType}:${link.targetId}`));
  const attachableTargets = availableTargets.filter((target) => !linkedTargetIds.has(`${target.type}:${target.id}`));
  const chosenTarget = attachableTargets.find((target) => `${target.type}:${target.id}` === linkTarget);
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
    });
  };

  const handleDrop = (status: TaskStatus) => {
    const task = safeTasks.find((candidate) => candidate.id === draggingTaskId);
    setDraggingTaskId(null);
    setDragOverStatus(null);
    if (!task || task.status === status) return;
    updateTask.mutate({ taskId: task.id, input: { status } });
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
                Drag cards between columns. Click a card to edit notes and related work.
              </div>
            </div>
            <Button
              size="xs"
              variant="secondary"
              icon={<Plus size={13} />}
              onClick={() => {
                setComposerStatus('backlog');
                setComposerOpen('backlog');
              }}
            >
              New task
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-4">
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
                        expanded={selectedTaskId === task.id}
                        links={linksByTask.get(task.id) ?? []}
                        workspaces={workspaces}
                        conversations={conversations}
                        editTitle={editTitle}
                        editDescription={editDescription}
                        linkTarget={linkTarget}
                        attachableTargets={attachableTargets}
                        chosenTarget={chosenTarget}
                        pending={updateTask.isPending || deleteTask.isPending || createLink.isPending || deleteLink.isPending}
                        onSelect={() => setSelectedTaskId((current) => current === task.id ? '' : task.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', task.id);
                          setDraggingTaskId(task.id);
                        }}
                        onDragEnd={() => {
                          setDraggingTaskId(null);
                          setDragOverStatus(null);
                        }}
                        onEditTitle={setEditTitle}
                        onEditDescription={setEditDescription}
                        onSave={saveSelectedTask}
                        onCancelEdit={() => {
                          setEditTitle(task.title);
                          setEditDescription(task.description ?? '');
                        }}
                        onMove={(status) => updateTask.mutate({ taskId: task.id, input: { status } })}
                        onDelete={() => deleteTask.mutate(task.id)}
                        onLinkTargetChange={setLinkTarget}
                        onCreateLink={() => {
                          if (!chosenTarget) return;
                          createLink.mutate({ taskId: task.id, target: chosenTarget });
                        }}
                        onDeleteLink={(link) => deleteLink.mutate(link)}
                      />
                    ))}

                    {composerOpen === column.id ? (
                      <InlineComposer
                        title={draftTitle}
                        description={draftDescription}
                        pending={createTask.isPending}
                        error={createTask.error instanceof Error ? createTask.error.message : undefined}
                        autoFocus={composerStatus === column.id}
                        onTitleChange={setDraftTitle}
                        onDescriptionChange={setDraftDescription}
                        onSubmit={() => {
                          if (!draftTitle.trim()) return;
                          createTask.mutate(column.id);
                        }}
                        onCancel={() => {
                          setComposerOpen(null);
                          setDraftTitle('');
                          setDraftDescription('');
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setComposerStatus(column.id);
                          setComposerOpen(column.id);
                        }}
                        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs text-dim hover:bg-card hover:text-[var(--color-text-primary)]"
                      >
                        <Plus size={13} />
                        Add task
                      </button>
                    )}

                    {safeTasks.length === 0 && column.id === 'backlog' && composerOpen !== column.id && (
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

function InlineComposer({
  title,
  description,
  pending,
  error,
  autoFocus,
  onTitleChange,
  onDescriptionChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  pending: boolean;
  error?: string;
  autoFocus?: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="rounded-lg border border-[var(--color-card-border)] bg-card p-2 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <V2Input
        autoFocus={autoFocus}
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Task title"
        className="h-8 w-full border-transparent bg-transparent px-1 focus:border-transparent"
      />
      <V2Textarea
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="Optional notes"
        className="mt-1 min-h-16 w-full resize-none border-transparent bg-primary/70"
      />
      {error && <div className="mt-2 text-xs text-[var(--color-error)]">{error}</div>}
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" icon={<X size={13} />} disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" variant="primary" icon={<Check size={13} />} loading={pending} disabled={!title.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

function TaskCard({
  task,
  expanded,
  links,
  workspaces,
  conversations,
  editTitle,
  editDescription,
  linkTarget,
  attachableTargets,
  chosenTarget,
  pending,
  onSelect,
  onDragStart,
  onDragEnd,
  onEditTitle,
  onEditDescription,
  onSave,
  onCancelEdit,
  onMove,
  onDelete,
  onLinkTargetChange,
  onCreateLink,
  onDeleteLink,
}: {
  task: Task;
  expanded: boolean;
  links: TaskLink[];
  workspaces: Workspace[];
  conversations: Conversation[];
  editTitle: string;
  editDescription: string;
  linkTarget: string;
  attachableTargets: LinkTarget[];
  chosenTarget?: LinkTarget;
  pending: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onEditTitle: (value: string) => void;
  onEditDescription: (value: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
  onLinkTargetChange: (value: string) => void;
  onCreateLink: () => void;
  onDeleteLink: (link: TaskLink) => void;
}) {
  const currentIndex = COLUMNS.findIndex((column) => column.id === task.status);
  const previousStatus = COLUMNS[currentIndex - 1]?.id;
  const nextStatus = COLUMNS[currentIndex + 1]?.id;
  const changed = editTitle.trim() !== task.title || editDescription.trim() !== (task.description ?? '');

  return (
    <article
      draggable={!expanded}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border bg-card shadow-sm transition ${
        expanded ? 'border-[var(--color-accent)]/40' : 'border-transparent hover:border-[var(--color-card-border)]'
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
            {task.description && !expanded && <p className="mt-1 line-clamp-2 text-xs leading-5 text-dim">{task.description}</p>}
            {!expanded && links.length > 0 && (
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

      {expanded && (
        <div className="border-t border-[var(--color-card-border)] px-3 pb-3 pt-2">
          <div className="space-y-2">
            <V2Input value={editTitle} onChange={(event) => onEditTitle(event.target.value)} className="h-8 w-full bg-primary" />
            <V2Textarea value={editDescription} onChange={(event) => onEditDescription(event.target.value)} placeholder="Notes" className="min-h-20 w-full resize-none bg-primary" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!previousStatus || pending}
                  onClick={() => previousStatus && onMove(previousStatus)}
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!nextStatus || pending}
                  onClick={() => nextStatus && onMove(nextStatus)}
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                >
                  Forward
                </button>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" size="xs" variant="ghost" disabled={!changed || pending} onClick={onCancelEdit}>Reset</Button>
                <Button type="button" size="xs" variant="primary" icon={<Check size={13} />} disabled={!changed || !editTitle.trim()} loading={pending} onClick={onSave}>
                  Save
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-[var(--color-card-border)] pt-3">
            <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Related work</div>
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
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <V2Select value={linkTarget} onChange={(event) => onLinkTargetChange(event.target.value)} className="w-full">
                <option value="">Attach workspace or conversation...</option>
                {attachableTargets.map((target) => (
                  <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                    {target.type === 'workspace' ? 'Workspace' : 'Conversation'} · {target.label}
                  </option>
                ))}
              </V2Select>
              <Button type="button" size="sm" variant="secondary" icon={<Link2 size={14} />} disabled={!chosenTarget || pending} onClick={onCreateLink}>
                Attach
              </Button>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:cursor-default disabled:opacity-40"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  );
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
