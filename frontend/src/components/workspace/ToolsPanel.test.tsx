import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsPanel } from './ToolsPanel';
import { TestWrapper } from '../../test/wrapper';

const mockUseWorkspaceRecipes = vi.fn();
const mockUseWorkspaceTunnels = vi.fn();
const mockUseWorkspaceSessions = vi.fn();
const mockUseWorkspaceStore = vi.fn();
const mockUseMobile = vi.fn();

vi.mock('../../hooks/useWorkspaceRecipes', () => ({
  useWorkspaceRecipes: () => mockUseWorkspaceRecipes(),
}));

vi.mock('../../hooks/useWorkspaceTunnels', () => ({
  useWorkspaceTunnels: () => mockUseWorkspaceTunnels(),
}));

vi.mock('../../hooks/useWorkspaceSessions', () => ({
  useWorkspaceSessions: () => mockUseWorkspaceSessions(),
}));

vi.mock('../../stores/workspace', () => ({
  useWorkspaceStore: () => mockUseWorkspaceStore(),
}));

vi.mock('../../hooks/useMobile', () => ({
  useMobile: () => mockUseMobile(),
}));

describe('Workspace ToolsPanel recipe confirmation', () => {
  const startSession = vi.fn();
  const openSession = vi.fn();
  const setActivePanel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseWorkspaceRecipes.mockReturnValue({
      recipes: [
        {
          name: 'test',
          source: 'justfile',
          command: 'just test',
          description: 'Run tests',
        },
      ],
      isLoading: false,
    });

    mockUseWorkspaceTunnels.mockReturnValue({
      tunnels: [],
      isLoading: false,
      createTunnel: vi.fn(),
      isCreating: false,
      stopTunnel: vi.fn(),
    });

    mockUseWorkspaceSessions.mockReturnValue({
      startSession,
    });

    mockUseWorkspaceStore.mockReturnValue({
      openSession,
      setActivePanel,
    });

    mockUseMobile.mockReturnValue(false);
    startSession.mockResolvedValue({ id: 'session-1' });
  });

  it('requires confirm before starting a recipe session', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ToolsPanel />
      </TestWrapper>,
    );

    await user.click(screen.getByTitle('Run: just test'));

    expect(startSession).not.toHaveBeenCalled();
    expect(screen.getByText('Run recipe?')).toBeInTheDocument();
    expect(screen.getByText(/Start a terminal session for/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run recipe' }));

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith({ provider: 'terminal', prompt: 'just test' });
      expect(openSession).toHaveBeenCalledWith('session-1');
    });
    expect(setActivePanel).not.toHaveBeenCalled();
  });

  it('switches to sessions view on mobile after confirm', async () => {
    const user = userEvent.setup();
    mockUseMobile.mockReturnValue(true);

    render(
      <TestWrapper>
        <ToolsPanel />
      </TestWrapper>,
    );

    await user.click(screen.getByTitle('Run: just test'));
    await user.click(screen.getByRole('button', { name: 'Run recipe' }));

    await waitFor(() => {
      expect(openSession).toHaveBeenCalledWith('session-1');
      expect(setActivePanel).toHaveBeenCalledWith(null);
    });
  });
});
