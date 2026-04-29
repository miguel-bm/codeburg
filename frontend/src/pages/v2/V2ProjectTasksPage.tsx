import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
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
import { Badge } from '../../components/ui/Badge';
import { Button, V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Select, V2Textarea } from './v2-ui';

const COLUMNS: Array<{ id: TaskStatus; title: string; short: string; icon: typeof Circle; tone: string }> = [
  { id: 'backlog', title: 'Backlog', short: 'Next', icon: Circle, tone: 'text-dim' },
  { id: 'in_progress', title: 'Active', short: 'Now', icon: CircleDot, tone: 'text-[var(--color-accent)]' },
  { id: 'in_review', title: 'Review', short: 'Check', icon: Clock3, tone: 'text-amber-400' },
  { id: 'done', title: 'Done', short: 'Done', icon: CheckCircle2, tone: 'text-emerald-400' },
];

export function V2ProjectTasksPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
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
    mutationFn: () => v2Api.createProjectTask(id!, {
      title: title.trim(),
      description: description.trim() || undefined,
    }),
    onSuccess: async (task) => {
      setTitle('');
      setDescription('');
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
        relationType: target.type === 'workspace' ? 'workspace' : 'conversation',
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

  const normalizedSearch = search.trim().toLowerCase();
  const safeTasks = Array.isArray(tasks) ? tasks : [];
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
  const selectedTask = safeTasks.find((task) => task.id === selectedTaskId) ?? safeTasks[0] ?? null;
  const availableTargets = useMemo<LinkTarget[]>(() => [
    ...workspaces.map((workspace) => ({
      type: 'workspace' as const,
      id: workspace.id,
      label: workspace.name,
      meta: workspace.branchName,
      icon: 'workspace' as const,
    })),
    ...conversations.map((conversation) => ({
      type: 'conversation' as const,
      id: conversation.id,
      label: conversation.title,
      meta: conversation.status,
      icon: 'conversation' as const,
    })),
  ], [conversations, workspaces]);

  const linkedTargetIds = new Set((selectedTask ? linksByTask.get(selectedTask.id) ?? [] : []).map((link) => `${link.targetType}:${link.targetId}`));
  const attachableTargets = availableTargets.filter((target) => !linkedTargetIds.has(`${target.type}:${target.id}`));
  const chosenTarget = attachableTargets.find((target) => `${target.type}:${target.id}` === linkTarget);
  const counts = COLUMNS.map((column) => filteredTasks.filter((task) => task.status === column.id).length);

  const submit = () => {
    if (!title.trim()) return;
    createTask.mutate();
  };

  return (
    <V2ScreenWithHeader
      projectId={project?.id}
      title={project?.name ?? 'Project'}
      taskCount={safeTasks.length}
      activeCount={safeTasks.filter((task) => task.status === 'in_progress').length}
      search={search}
      onSearch={setSearch}
    >
      <V2Content className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <V2Panel className="min-h-0 overflow-hidden">
          <V2PanelHeader
            title="Project tasks"
            subtitle={safeTasks.length === 0 ? 'Optional tracking, unused until you need it' : `${counts.reduce((sum, value) => sum + value, 0)} visible cards`}
          />

          {safeTasks.length === 0 ? (
            <V2Empty
              icon={<Archive size={28} />}
              title="No task system in the way"
              body="Add the first card when this project needs a memory layer. Workspaces and conversations keep working without tasks."
            />
          ) : (
            <div className="grid h-full min-h-0 gap-3 overflow-auto px-3 pb-3 lg:grid-cols-4">
              {COLUMNS.map((column) => {
                const Icon = column.icon;
                const columnTasks = filteredTasks.filter((task) => task.status === column.id);
                return (
                  <section key={column.id} className="min-h-[18rem] rounded-lg bg-primary/60">
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-lg bg-primary/95 px-3 py-2 backdrop-blur">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon size={14} className={column.tone} />
                        <span className="truncate text-sm font-medium">{column.title}</span>
                      </div>
                      <span className="text-xs text-dim">{columnTasks.length}</span>
                    </div>
                    <div className="space-y-2 p-2">
                      {columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          active={selectedTask?.id === task.id}
                          links={linksByTask.get(task.id) ?? []}
                          workspaces={workspaces}
                          conversations={conversations}
                          pending={updateTask.isPending || deleteTask.isPending}
                          onSelect={() => setSelectedTaskId(task.id)}
                          onMove={(status) => updateTask.mutate({ taskId: task.id, input: { status } })}
                          onDelete={() => deleteTask.mutate(task.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </V2Panel>

        <aside className="space-y-4">
          <V2Panel>
            <V2PanelHeader title="New card" subtitle="Project-local, optional" />
            <div className="space-y-3 p-4">
              <V2Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Polish task tracking" className="w-full" />
              <V2Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Notes, scope, or next thought" className="min-h-24 w-full resize-none" />
              {createTask.error instanceof Error && <p className="text-xs text-[var(--color-error)]">{createTask.error.message}</p>}
              <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={createTask.isPending} disabled={!title.trim()} onClick={submit} className="w-full">
                Add task
              </Button>
            </div>
          </V2Panel>

          <V2Panel>
            <V2PanelHeader title="Related work" subtitle={selectedTask ? selectedTask.title : 'Select a card'} />
            {selectedTask ? (
              <div className="space-y-3 p-4">
                <div className="space-y-2">
                  {(linksByTask.get(selectedTask.id) ?? []).map((link) => (
                    <LinkedTargetRow
                      key={link.id}
                      link={link}
                      workspaces={workspaces}
                      conversations={conversations}
                      pending={deleteLink.isPending}
                      onDelete={() => deleteLink.mutate(link)}
                    />
                  ))}
                  {(linksByTask.get(selectedTask.id) ?? []).length === 0 && (
                    <p className="rounded-md bg-primary px-3 py-2 text-xs leading-5 text-dim">Attach a workspace or conversation when it helps. This card stays independent.</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <V2Select value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)} className="w-full">
                    <option value="">Attach related work...</option>
                    {attachableTargets.map((target) => (
                      <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                        {target.type === 'workspace' ? 'Workspace' : 'Conversation'} · {target.label}
                      </option>
                    ))}
                  </V2Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Link2 size={14} />}
                    disabled={!chosenTarget}
                    loading={createLink.isPending}
                    onClick={() => {
                      if (!selectedTask || !chosenTarget) return;
                      createLink.mutate({ taskId: selectedTask.id, target: chosenTarget });
                    }}
                  >
                    Attach
                  </Button>
                </div>
              </div>
            ) : (
              <V2Empty title="No selected task" body="Create or select a card to relate it to project work." />
            )}
          </V2Panel>
        </aside>
      </V2Content>
    </V2ScreenWithHeader>
  );
}

function V2ScreenWithHeader({
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
        subtitle={taskCount === 0 ? 'A quiet tracking layer for projects that need one.' : `${taskCount} task${taskCount === 1 ? '' : 's'}, ${activeCount} active`}
        actions={
          <label className="flex h-8 items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-primary px-2">
            <Search size={14} className="text-dim" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search"
              className="h-full w-36 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
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
  icon: 'workspace' | 'conversation';
};

function TaskCard({
  task,
  active,
  links,
  workspaces,
  conversations,
  pending,
  onSelect,
  onMove,
  onDelete,
}: {
  task: Task;
  active: boolean;
  links: TaskLink[];
  workspaces: Workspace[];
  conversations: Conversation[];
  pending: boolean;
  onSelect: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const currentIndex = COLUMNS.findIndex((column) => column.id === task.status);
  const prevStatus = COLUMNS[currentIndex - 1]?.id;
  const nextStatus = COLUMNS[currentIndex + 1]?.id;

  return (
    <V2Row active={active} className="border border-transparent bg-card px-3 py-3 shadow-sm hover:border-[var(--color-card-border)]" >
      <button type="button" onClick={onSelect} className="block w-full cursor-pointer text-left">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-sm font-medium leading-5 text-[var(--color-text-primary)]">{task.title}</h3>
          {task.pinned && <Badge variant="label" color="blue">Pinned</Badge>}
        </div>
        {task.description && <p className="mt-2 line-clamp-3 text-xs leading-5 text-dim">{task.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {links.slice(0, 3).map((link) => (
            <RelationChip key={link.id} link={link} workspaces={workspaces} conversations={conversations} />
          ))}
          {links.length > 3 && <span className="text-xs text-dim">+{links.length - 3}</span>}
        </div>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!prevStatus || pending}
            onClick={() => prevStatus && onMove(prevStatus)}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-30"
            title="Move back"
          >
            <ArrowRight size={13} className="rotate-180" />
          </button>
          <button
            type="button"
            disabled={!nextStatus || pending}
            onClick={() => nextStatus && onMove(nextStatus)}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-30"
            title="Move forward"
          >
            <ArrowRight size={13} />
          </button>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onDelete}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:cursor-default disabled:opacity-30"
          title="Delete task"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </V2Row>
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
      <Icon size={14} className="shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        {href ? (
          <Link to={href} className="block truncate text-sm font-medium hover:text-accent">{title}</Link>
        ) : (
          <div className="truncate text-sm font-medium">{title}</div>
        )}
        <div className="truncate text-xs text-dim">{meta}</div>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-40"
        title="Remove relation"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
