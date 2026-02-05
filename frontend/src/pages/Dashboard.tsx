import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { tasksApi, projectsApi } from '../api';
import type { Task, TaskStatus, CreateProjectInput, CreateTaskInput } from '../api';
import { useMobile } from '../hooks/useMobile';
import { useSwipe } from '../hooks/useSwipe';
import { useLongPress } from '../hooks/useLongPress';

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'backlog', title: 'BACKLOG', color: 'status-backlog' },
  { id: 'in_progress', title: 'IN_PROGRESS', color: 'status-in-progress' },
  { id: 'blocked', title: 'BLOCKED', color: 'status-blocked' },
  { id: 'done', title: 'DONE', color: 'status-done' },
];

interface ContextMenu {
  taskId: string;
  x: number;
  y: number;
}

export function Dashboard() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => setActiveColumnIndex((i) => Math.min(i + 1, COLUMNS.length - 1)),
    onSwipeRight: () => setActiveColumnIndex((i) => Math.max(i - 1, 0)),
    threshold: 50,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => tasksApi.list(selectedProjectId ? { project: selectedProjectId } : undefined),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      tasksApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const getTasksByStatus = (status: TaskStatus): Task[] => {
    return tasks?.filter((t) => t.status === status) ?? [];
  };

  const getProjectName = (projectId: string): string => {
    return projects?.find((p) => p.id === projectId)?.name ?? 'unknown';
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDragEnd = () => {
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) {
      updateTaskMutation.mutate({ id: taskId, status });
    }
  };

  const hasProjects = projects && projects.length > 0;

  return (
    <Layout>
      {/* Header */}
      <header className="bg-secondary border-b border-subtle px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
            {/* On mobile, leave space for hamburger menu */}
            {isMobile && <div className="w-8" />}
            <h2 className="text-xs md:text-sm text-dim truncate hidden md:block">
              // {selectedProjectId
                ? projects?.find((p) => p.id === selectedProjectId)?.name
                : 'all_tasks'}
            </h2>
            <select
              value={selectedProjectId ?? ''}
              onChange={(e) => setSelectedProjectId(e.target.value || undefined)}
              className="px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none flex-1 md:flex-none max-w-[150px] md:max-w-none"
            >
              <option value="">all_projects</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1 md:gap-2">
            <button
              onClick={() => setShowCreateProject(true)}
              className="px-2 md:px-4 py-1.5 md:py-2 border border-subtle text-xs md:text-sm hover:border-accent hover:text-accent transition-colors"
            >
              <span className="hidden md:inline">+ project</span>
              <span className="md:hidden">+P</span>
            </button>
            <button
              onClick={() => setShowCreateTask(true)}
              disabled={!hasProjects}
              className="px-2 md:px-4 py-1.5 md:py-2 border border-accent text-accent text-xs md:text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="hidden md:inline">+ task</span>
              <span className="md:hidden">+T</span>
            </button>
          </div>
        </div>
      </header>

      {/* Kanban Board */}
      {isMobile ? (
        // Mobile: Tabbed columns with swipe navigation
        <div className="flex flex-col h-[calc(100vh-73px)]">
          {/* Tab Navigation */}
          <div className="flex border-b border-subtle bg-secondary overflow-x-auto">
            {COLUMNS.map((column, index) => (
              <button
                key={column.id}
                onClick={() => setActiveColumnIndex(index)}
                className={`flex-1 min-w-0 px-3 py-2 text-xs font-medium transition-colors ${
                  activeColumnIndex === index
                    ? `${column.color} border-b-2 border-accent`
                    : 'text-dim hover:text-[var(--color-text-primary)]'
                }`}
              >
                {column.title.slice(0, 8)}
                <span className="ml-1 text-dim">
                  [{getTasksByStatus(column.id).length}]
                </span>
              </button>
            ))}
          </div>

          {/* Swipeable Content */}
          <div
            className="flex-1 overflow-y-auto p-4"
            {...swipeHandlers}
          >
            {tasksLoading ? (
              <div className="text-center text-dim py-8 text-sm">loading...</div>
            ) : getTasksByStatus(COLUMNS[activeColumnIndex].id).length === 0 ? (
              <div className="text-center text-dim py-8 text-sm">empty</div>
            ) : (
              <div className="space-y-3">
                {getTasksByStatus(COLUMNS[activeColumnIndex].id).map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    isMobile
                    onLongPress={(x, y) => setContextMenu({ taskId: task.id, x, y })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        // Desktop: Horizontal scrolling kanban
        <div className="p-6 h-[calc(100vh-73px)] overflow-x-auto">
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((column) => (
              <div
                key={column.id}
                className={`w-80 flex flex-col bg-secondary border transition-colors ${
                  dragOverColumn === column.id
                    ? 'border-accent bg-[oklch(0.75_0.2_145_/_0.08)]'
                    : 'border-subtle'
                }`}
                onDragOver={(e) => handleDragOver(e, column.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, column.id)}
              >
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-subtle">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-sm font-medium ${column.color}`}>
                      {column.title}
                    </h3>
                    <span className="text-sm text-dim">
                      [{getTasksByStatus(column.id).length}]
                    </span>
                  </div>
                </div>

                {/* Tasks */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {tasksLoading ? (
                    <div className="text-center text-dim py-4 text-sm">
                      loading...
                    </div>
                  ) : getTasksByStatus(column.id).length === 0 ? (
                    <div className="text-center text-dim py-4 text-sm">
                      empty
                    </div>
                  ) : (
                    getTasksByStatus(column.id).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        projectName={!selectedProjectId ? getProjectName(task.projectId) : undefined}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Context Menu for mobile long-press */}
      {contextMenu && (
        <TaskContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          taskId={contextMenu.taskId}
          currentStatus={tasks?.find((t) => t.id === contextMenu.taskId)?.status ?? 'backlog'}
          onClose={() => setContextMenu(null)}
          onStatusChange={(status) => {
            updateTaskMutation.mutate({ id: contextMenu.taskId, status });
            setContextMenu(null);
          }}
        />
      )}

      {/* Create Project Modal */}
      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} />
      )}

      {/* Create Task Modal */}
      {showCreateTask && hasProjects && (
        <CreateTaskModal
          projects={projects!}
          defaultProjectId={selectedProjectId}
          onClose={() => setShowCreateTask(false)}
        />
      )}
    </Layout>
  );
}

interface TaskCardProps {
  task: Task;
  projectName?: string;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: () => void;
  isMobile?: boolean;
  onLongPress?: (x: number, y: number) => void;
}

function TaskCard({ task, projectName, onDragStart, onDragEnd, isMobile, onLongPress }: TaskCardProps) {
  const navigate = useNavigate();
  const handleClick = () => {
    // Navigate to task detail on click (but not on drag)
    navigate(`/tasks/${task.id}`);
  };

  const longPressHandlers = useLongPress({
    onLongPress: () => {
      if (onLongPress) {
        // Get element position for context menu
        const rect = document.getElementById(`task-${task.id}`)?.getBoundingClientRect();
        if (rect) {
          onLongPress(rect.left, rect.bottom);
        }
      }
    },
    onClick: handleClick,
    delay: 500,
  });

  return (
    <div
      id={`task-${task.id}`}
      draggable={!isMobile}
      onDragStart={!isMobile ? (e) => onDragStart(e, task.id) : undefined}
      onDragEnd={!isMobile ? onDragEnd : undefined}
      {...(isMobile ? longPressHandlers : { onClick: handleClick })}
      className={`bg-primary p-3 border border-subtle hover:border-accent transition-colors cursor-pointer ${
        isMobile ? 'select-none' : ''
      }`}
    >
      <h4 className="font-medium text-sm">
        {task.title}
      </h4>
      {task.description && (
        <p className="text-xs text-dim mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center flex-wrap gap-2 mt-2">
        {projectName && (
          <span className="text-xs text-accent">
            {projectName}
          </span>
        )}
        {task.branch && (
          <span className="text-xs text-dim font-mono">
            [{task.branch}]
          </span>
        )}
        {task.pinned && (
          <span className="text-xs text-[var(--color-status-blocked)]">
            pinned
          </span>
        )}
      </div>
    </div>
  );
}

interface TaskContextMenuProps {
  x: number;
  y: number;
  taskId: string;
  currentStatus: TaskStatus;
  onClose: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

function TaskContextMenu({ x, y, currentStatus, onClose, onStatusChange }: TaskContextMenuProps) {
  // Adjust position to keep menu on screen
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 160),
    top: Math.min(y, window.innerHeight - 200),
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
      />
      {/* Menu */}
      <div
        className="fixed z-50 bg-secondary border border-subtle min-w-[150px]"
        style={menuStyle}
      >
        <div className="px-3 py-2 text-xs text-dim border-b border-subtle">
          // move_to
        </div>
        {COLUMNS.map((column) => (
          <button
            key={column.id}
            onClick={() => onStatusChange(column.id)}
            disabled={column.id === currentStatus}
            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
              column.id === currentStatus
                ? 'text-dim cursor-not-allowed'
                : `${column.color} hover:bg-tertiary`
            }`}
          >
            {column.title}
            {column.id === currentStatus && (
              <span className="ml-2 text-xs">(current)</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

interface CreateProjectModalProps {
  onClose: () => void;
}

function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => projectsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    createMutation.mutate({ name, path });
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// new_project</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-status-blocked)] p-3 text-sm text-[var(--color-status-blocked)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-1">name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="my-project"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">path</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="/home/user/projects/my-project"
              required
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'creating...' : 'create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CreateTaskModalProps {
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  onClose: () => void;
}

function CreateTaskModal({ projects, defaultProjectId, onClose }: CreateTaskModalProps) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: CreateTaskInput }) =>
      tasksApi.create(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    createMutation.mutate({
      projectId,
      input: { title, description: description || undefined },
    });
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// new_task</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-status-blocked)] p-3 text-sm text-[var(--color-status-blocked)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-1">project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="implement feature x"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none resize-none"
              placeholder="optional description..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'creating...' : 'create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
