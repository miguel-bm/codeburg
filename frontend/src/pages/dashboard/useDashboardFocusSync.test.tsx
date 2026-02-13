import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useMemo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Task, TaskStatus } from '../../api';
import { COLUMNS } from '../../constants/tasks';
import { useDashboardFocusSync } from './useDashboardFocusSync';

interface HarnessProps {
  panelOpen?: boolean;
  tasks: Task[];
  selectedProjectId?: string;
  statusFilter?: Set<TaskStatus>;
  priorityFilter?: Set<string>;
  typeFilter?: Set<string>;
  labelFilter?: Set<string>;
  isMobile?: boolean;
  navigateToPanel?: (to: string, options?: { replace?: boolean }) => void;
  setActiveColumnIndex?: (index: number) => void;
}

function buildTasksByStatus(tasks: Task[]): Map<TaskStatus, Task[]> {
  const map = new Map<TaskStatus, Task[]>();
  for (const column of COLUMNS) {
    map.set(column.id, []);
  }
  for (const task of tasks) {
    const bucket = map.get(task.status);
    if (bucket) bucket.push(task);
  }
  return map;
}

function makeTask(id: string, status: TaskStatus, position = 0): Task {
  return {
    id,
    projectId: 'p1',
    title: `Task ${id}`,
    status,
    taskType: 'feature',
    pinned: false,
    position,
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function Harness({
  panelOpen = false,
  tasks,
  selectedProjectId,
  statusFilter = new Set<TaskStatus>(),
  priorityFilter = new Set<string>(),
  typeFilter = new Set<string>(),
  labelFilter = new Set<string>(),
  isMobile = false,
  navigateToPanel = () => {},
  setActiveColumnIndex = () => {},
}: HarnessProps) {
  const tasksByStatus = useMemo(() => buildTasksByStatus(tasks), [tasks]);
  const getColumnTasks = useCallback(
    (colIdx: number) => tasksByStatus.get(COLUMNS[colIdx]?.id) ?? [],
    [tasksByStatus],
  );

  const { focus, setFocus, getFocusedTask } = useDashboardFocusSync({
    panelOpen,
    tasks,
    tasksByStatus,
    selectedProjectId,
    statusFilter,
    priorityFilter,
    typeFilter,
    labelFilter,
    getColumnTasks,
    navigateToPanel,
    isMobile,
    setActiveColumnIndex,
  });

  return (
    <div>
      <div data-testid="focus">{focus ? `${focus.col}:${focus.card}` : 'none'}</div>
      <div data-testid="focused-task">{getFocusedTask()?.id ?? 'none'}</div>
      <button onClick={() => setFocus({ col: 0, card: 1 })}>focus-second-backlog</button>
      <button onClick={() => setFocus({ col: 1, card: 0 })}>focus-first-progress</button>
    </div>
  );
}

describe('useDashboardFocusSync', () => {
  it('initially focuses the first non-empty column', async () => {
    const tasks = [
      makeTask('in-progress-1', 'in_progress', 0),
      makeTask('done-1', 'done', 0),
    ];

    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness tasks={tasks} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('focus')).toHaveTextContent('1:0');
      expect(screen.getByTestId('focused-task')).toHaveTextContent('in-progress-1');
    });
  });

  it('syncs focus from /tasks/:id URL when panel is open', async () => {
    const tasks = [
      makeTask('backlog-1', 'backlog', 0),
      makeTask('progress-1', 'in_progress', 0),
      makeTask('review-1', 'in_review', 0),
    ];

    render(
      <MemoryRouter initialEntries={['/tasks/review-1']}>
        <Harness tasks={tasks} panelOpen />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('focus')).toHaveTextContent('2:0');
      expect(screen.getByTestId('focused-task')).toHaveTextContent('review-1');
    });
  });

  it('navigates panel to focused task when focus changes from keyboard actions', async () => {
    const navigateToPanel = vi.fn();
    const tasks = [
      makeTask('backlog-1', 'backlog', 0),
      makeTask('backlog-2', 'backlog', 1),
    ];

    render(
      <MemoryRouter initialEntries={['/tasks/backlog-1']}>
        <Harness tasks={tasks} panelOpen navigateToPanel={navigateToPanel} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('focus-second-backlog'));

    await waitFor(() => {
      expect(navigateToPanel).toHaveBeenCalledWith('/tasks/backlog-2', { replace: true });
    });
  });

  it('updates mobile active column whenever focus changes on mobile', async () => {
    const setActiveColumnIndex = vi.fn();
    const tasks = [
      makeTask('backlog-1', 'backlog', 0),
      makeTask('progress-1', 'in_progress', 0),
    ];

    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness
          tasks={tasks}
          isMobile
          setActiveColumnIndex={setActiveColumnIndex}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('focus-first-progress'));

    await waitFor(() => {
      expect(setActiveColumnIndex).toHaveBeenCalledWith(1);
    });
  });
});
