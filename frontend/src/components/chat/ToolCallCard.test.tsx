import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolCallCard } from './ToolCallCard';

describe('ToolCallCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders compact status and summary in collapsed mode', () => {
    render(
      <ToolCallCard
        tool={{
          callId: 'call-1',
          name: 'WebSearch',
          title: 'Search',
          state: 'completed',
          input: { query: 'Cloudflare Wrangler latest updates 2026' },
        }}
      />,
    );

    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText(/query: Cloudflare Wrangler latest updates 2026/i)).toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
  });

  it('shows details on expand and supports copying output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <ToolCallCard
        tool={{
          callId: 'call-2',
          name: 'Bash',
          state: 'completed',
          input: { command: 'ls -la' },
          result: { stdout: 'file-a\nfile-b' },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /bash/i }));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy output/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });
});
