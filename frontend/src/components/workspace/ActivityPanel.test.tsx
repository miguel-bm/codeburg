import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActivityBar } from './ActivityPanel';

const invalidateQueries = vi.fn();
const refetchQueries = vi.fn();
const togglePanel = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries,
    refetchQueries,
  }),
}));

vi.mock('./WorkspaceContext', () => ({
  useWorkspace: () => ({
    scopeType: 'task',
    scopeId: 'task-1',
  }),
}));

vi.mock('../../stores/workspace', () => ({
  useWorkspaceStore: () => ({
    activePanel: 'files',
    togglePanel,
  }),
}));

describe('ActivityBar', () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    refetchQueries.mockReset();
    togglePanel.mockReset();
  });

  it('refreshes workspace caches and emits a refresh event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<ActivityBar />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh workspace/i }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-files', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-sessions', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-git-status', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-git-basediff', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-git-log', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-diff', 'task', 'task-1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-diff-content', 'task', 'task-1'],
      });
    });

    await waitFor(() => {
      expect(refetchQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-files', 'task', 'task-1'],
        type: 'active',
      });
      expect(refetchQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-git-status', 'task', 'task-1'],
        type: 'active',
      });
      expect(refetchQueries).toHaveBeenCalledWith({
        queryKey: ['workspace-diff-content', 'task', 'task-1'],
        type: 'active',
      });
    });

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalled();
      const [event] = dispatchSpy.mock.calls.at(-1) ?? [];
      expect(event).toBeInstanceOf(Event);
      expect((event as Event).type).toBe('codeburg:workspace-refresh');
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh workspace/i })).toHaveAttribute('title', expect.stringContaining('Last refreshed'));
    });

    dispatchSpy.mockRestore();
  });
});
