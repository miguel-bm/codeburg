import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { TestWrapper } from '../../test/wrapper';
import { v2Api } from '../../api/v2';

vi.mock('../../api/v2', () => ({
  v2Api: {
    getSidebar: vi.fn(),
    listConversations: vi.fn(),
  },
}));

const mockedV2Api = vi.mocked(v2Api);

function renderPalette(initialSearch = '') {
  return render(
    <MemoryRouter>
      <TestWrapper>
        <CommandPalette initialSearch={initialSearch} onClose={vi.fn()} />
      </TestWrapper>
    </MemoryRouter>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedV2Api.getSidebar.mockResolvedValue({ projects: [] });
    mockedV2Api.listConversations.mockResolvedValue([]);
  });

  it('opens without searching conversations and switches to conversation search mode', async () => {
    const user = userEvent.setup();

    renderPalette();

    expect(screen.getByText('Search conversations')).toBeInTheDocument();
    expect(mockedV2Api.listConversations).not.toHaveBeenCalled();

    await user.click(screen.getByText('Search conversations'));

    expect(screen.getByPlaceholderText('Search conversation titles and summaries')).toBeInTheDocument();
    expect(mockedV2Api.listConversations).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox'), 'archive');

    await waitFor(() => {
      expect(mockedV2Api.listConversations).toHaveBeenCalledWith({
        q: 'archive',
        provider: 'pi',
        limit: 20,
      });
    });
  });
});
