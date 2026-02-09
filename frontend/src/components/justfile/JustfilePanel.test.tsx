import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JustfilePanel } from './JustfilePanel';
import { TestWrapper } from '../../test/wrapper';

vi.mock('../../api', () => ({
  justfileApi: {
    listTaskRecipes: vi.fn(),
    runTaskRecipe: vi.fn(),
  },
}));

import { justfileApi } from '../../api';

const mockedApi = vi.mocked(justfileApi);

describe('JustfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockedApi.listTaskRecipes.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    expect(screen.getByText('Loading justfile...')).toBeInTheDocument();
  });

  it('shows "no justfile" when project has none', async () => {
    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: false,
      recipes: [],
    });

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('No justfile found')).toBeInTheDocument();
    });
  });

  it('renders recipe list', async () => {
    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: true,
      recipes: [
        { name: 'build', description: 'Build the project' },
        { name: 'test', description: 'Run tests' },
        { name: 'deploy', args: 'env', description: 'Deploy to environment' },
      ],
    });

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('build')).toBeInTheDocument();
      expect(screen.getByText('test')).toBeInTheDocument();
      expect(screen.getByText('deploy')).toBeInTheDocument();
    });

    expect(screen.getByText('Build the project')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByText('Recipes (3)')).toBeInTheDocument();
  });

  it('shows recipe args', async () => {
    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: true,
      recipes: [
        { name: 'deploy', args: 'env region', description: 'Deploy' },
      ],
    });

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('env region')).toBeInTheDocument();
    });
  });

  it('runs a recipe on click', async () => {
    const user = userEvent.setup();

    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: true,
      recipes: [{ name: 'test', description: 'Run tests' }],
    });

    mockedApi.runTaskRecipe.mockResolvedValue({
      exitCode: 0,
      output: 'All tests passed!',
    });

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('test')).toBeInTheDocument();
    });

    // Click the recipe button (the containing button, not just the text)
    const button = screen.getByText('test').closest('button')!;
    await user.click(button);

    expect(mockedApi.runTaskRecipe).toHaveBeenCalledWith('task-1', 'test', undefined);

    await waitFor(() => {
      expect(screen.getByText('All tests passed!')).toBeInTheDocument();
    });
  });

  it('shows error output on failed recipe', async () => {
    const user = userEvent.setup();

    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: true,
      recipes: [{ name: 'build' }],
    });

    mockedApi.runTaskRecipe.mockRejectedValue(new Error('Command failed'));

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('build')).toBeInTheDocument();
    });

    const button = screen.getByText('build').closest('button')!;
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('Error: Command failed')).toBeInTheDocument();
    });
  });

  it('shows default output placeholder', async () => {
    mockedApi.listTaskRecipes.mockResolvedValue({
      hasJustfile: true,
      recipes: [{ name: 'build' }],
    });

    render(
      <TestWrapper>
        <JustfilePanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Run a recipe to see output')).toBeInTheDocument();
    });
  });
});
