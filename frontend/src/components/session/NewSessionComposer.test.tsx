import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSessionComposer } from './NewSessionComposer';

describe('NewSessionComposer', () => {
  it('starts claude in chat mode by default', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <NewSessionComposer
        taskTitle="Fix flaky tests"
        onStart={onStart}
        onCancel={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: /start session/i }));
    expect(onStart).toHaveBeenCalledWith('claude', 'Fix flaky tests', 'chat');
  });

  it('allows switching to terminal interface mode for codex', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <NewSessionComposer
        taskTitle="Add UI polish"
        onStart={onStart}
        onCancel={() => {}}
      />
    );

    await user.click(screen.getByRole('radio', { name: /codex/i }));
    await user.click(screen.getByRole('button', { name: 'Terminal' }));
    await user.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStart).toHaveBeenCalledWith('codex', 'Add UI polish', 'terminal');
  });

  it('starts terminal provider immediately with terminal mode', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <NewSessionComposer
        taskTitle="Local shell"
        onStart={onStart}
        onCancel={() => {}}
      />
    );

    await user.click(screen.getByRole('radio', { name: /terminal/i }));
    expect(onStart).toHaveBeenCalledWith('terminal', '', 'terminal');
  });
});

