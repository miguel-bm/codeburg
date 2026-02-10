import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsPanel } from './ToolsPanel';
import { TestWrapper } from '../../test/wrapper';

vi.mock('../../api', () => ({
  recipesApi: {
    listTaskRecipes: vi.fn(),
  },
}));

vi.mock('../../hooks/useTunnels', () => ({
  useTunnels: vi.fn(() => ({
    tunnels: [],
    port: '',
    setPort: vi.fn(),
    showCreate: false,
    setShowCreate: vi.fn(),
    createMutation: { isPending: false, mutate: vi.fn() },
    stopMutation: { mutate: vi.fn() },
    copied: false,
    copyUrl: vi.fn(),
    handleCreate: vi.fn(),
  })),
}));

import { recipesApi } from '../../api';

const mockedRecipesApi = vi.mocked(recipesApi);

describe('ToolsPanel Recipes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders recipes from multiple sources and runs the provided command', async () => {
    const user = userEvent.setup();
    const onRecipeRun = vi.fn();

    mockedRecipesApi.listTaskRecipes.mockResolvedValue({
      sources: ['makefile', 'package.json'],
      recipes: [
        { name: 'lint', source: 'makefile', command: 'make lint', description: 'Lint code' },
        { name: 'test', source: 'package.json', command: 'npm run test', description: 'Run tests' },
      ],
    });

    render(
      <TestWrapper>
        <ToolsPanel taskId="task-1" onRecipeRun={onRecipeRun} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('lint')).toBeInTheDocument();
      expect(screen.getByText('test')).toBeInTheDocument();
      expect(screen.getByText('makefile')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Run test'));
    expect(onRecipeRun).toHaveBeenCalledWith('npm run test');
  });

  it('shows empty state when no recipes are discovered', async () => {
    mockedRecipesApi.listTaskRecipes.mockResolvedValue({
      sources: [],
      recipes: [],
    });

    render(
      <TestWrapper>
        <ToolsPanel taskId="task-1" onRecipeRun={vi.fn()} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('No recipes found')).toBeInTheDocument();
    });
  });
});
