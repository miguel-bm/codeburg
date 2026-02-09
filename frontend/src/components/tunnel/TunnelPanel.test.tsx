import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TunnelPanel } from './TunnelPanel';
import { TestWrapper } from '../../test/wrapper';

vi.mock('../../api', () => ({
  tunnelsApi: {
    list: vi.fn(),
    create: vi.fn(),
    stop: vi.fn(),
  },
}));

import { tunnelsApi } from '../../api';

const mockedApi = vi.mocked(tunnelsApi);

const mockWriteText = vi.fn().mockResolvedValue(undefined);

describe('TunnelPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API using defineProperty since navigator.clipboard is read-only
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });
  });

  it('shows loading state', () => {
    mockedApi.list.mockReturnValue(new Promise(() => {}));

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    expect(screen.getByText('loading tunnels...')).toBeInTheDocument();
  });

  it('shows empty state when no tunnels', async () => {
    mockedApi.list.mockResolvedValue([]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('No active tunnels')).toBeInTheDocument();
    });
  });

  it('renders tunnel list with URLs', async () => {
    mockedApi.list.mockResolvedValue([
      {
        id: 'tunnel-1',
        taskId: 'task-1',
        port: 3000,
        url: 'https://abc123.trycloudflare.com',
      },
      {
        id: 'tunnel-2',
        taskId: 'task-1',
        port: 8080,
        url: 'https://def456.trycloudflare.com',
      },
    ]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(':3000')).toBeInTheDocument();
      expect(screen.getByText(':8080')).toBeInTheDocument();
    });

    expect(screen.getByText('https://abc123.trycloudflare.com')).toBeInTheDocument();
    expect(screen.getByText('https://def456.trycloudflare.com')).toBeInTheDocument();
  });

  it('shows create form when clicking "+ new"', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue([]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('+ new')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ new'));

    expect(screen.getByPlaceholderText('port (e.g. 3000)')).toBeInTheDocument();
    expect(screen.getByText('create')).toBeInTheDocument();
    expect(screen.getByText('cancel')).toBeInTheDocument();
  });

  it('creates a tunnel with port', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue([]);
    mockedApi.create.mockResolvedValue({
      id: 'new-tunnel',
      taskId: 'task-1',
      port: 3000,
      url: 'https://new.trycloudflare.com',
    });

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('+ new')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ new'));

    const input = screen.getByPlaceholderText('port (e.g. 3000)');
    await user.type(input, '3000');
    await user.click(screen.getByText('create'));

    expect(mockedApi.create).toHaveBeenCalledWith('task-1', 3000);
  });

  it('hides create form on cancel', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue([]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('+ new')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ new'));
    expect(screen.getByPlaceholderText('port (e.g. 3000)')).toBeInTheDocument();

    await user.click(screen.getByText('cancel'));
    expect(screen.queryByPlaceholderText('port (e.g. 3000)')).not.toBeInTheDocument();
  });

  it('stops a tunnel', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue([
      {
        id: 'tunnel-1',
        taskId: 'task-1',
        port: 3000,
        url: 'https://test.trycloudflare.com',
      },
    ]);
    mockedApi.stop.mockResolvedValue(undefined);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(':3000')).toBeInTheDocument();
    });

    await user.click(screen.getByText('stop'));

    expect(mockedApi.stop).toHaveBeenCalledWith('tunnel-1');
  });

  it('copies URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockedApi.list.mockResolvedValue([
      {
        id: 'tunnel-1',
        taskId: 'task-1',
        port: 3000,
        url: 'https://test.trycloudflare.com',
      },
    ]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(':3000')).toBeInTheDocument();
    });

    // Use fireEvent instead of userEvent to avoid userEvent's clipboard interception
    fireEvent.click(screen.getByText('copy'));

    expect(writeText).toHaveBeenCalledWith(
      'https://test.trycloudflare.com'
    );
  });

  it('shows "Tunnels" header', async () => {
    mockedApi.list.mockResolvedValue([]);

    render(
      <TestWrapper>
        <TunnelPanel taskId="task-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Tunnels')).toBeInTheDocument();
    });
  });
});
