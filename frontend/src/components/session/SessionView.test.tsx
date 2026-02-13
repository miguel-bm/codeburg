import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionView } from './SessionView';
import type { AgentSession } from '../../api/sessions';

vi.mock('./TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view">terminal</div>,
}));

vi.mock('../chat', () => ({
  ChatSessionView: () => <div data-testid="chat-view">chat</div>,
}));

function makeSession(sessionType: AgentSession['sessionType']): AgentSession {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    taskId: 'task-1',
    projectId: 'project-1',
    provider: 'claude',
    sessionType,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('SessionView', () => {
  it('renders chat view for chat sessions', () => {
    render(<SessionView session={makeSession('chat')} showOpenInNewTab={false} />);
    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
    expect(screen.getAllByText('chat').length).toBeGreaterThan(0);
  });

  it('renders terminal view for terminal sessions', () => {
    render(<SessionView session={makeSession('terminal')} showOpenInNewTab={false} />);
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-view')).not.toBeInTheDocument();
    expect(screen.getAllByText('terminal').length).toBeGreaterThan(0);
  });
});
