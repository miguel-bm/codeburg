import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChatSessionView } from './ChatSessionView';
import type { AgentSession } from '../../api/sessions';
import type { ChatMessage } from '../../api/chat';

const useChatSessionMock = vi.fn();

vi.mock('../../hooks/useChatSession', () => ({
  useChatSession: (...args: unknown[]) => useChatSessionMock(...args),
}));

vi.mock('../../hooks/useMobile', () => ({
  useMobile: () => false,
}));

vi.mock('../../api/workspace', () => ({
  createFilesApi: () => ({
    list: vi.fn().mockResolvedValue({ entries: [] }),
  }),
}));

vi.mock('../ui/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./ToolCallCard', () => ({
  ToolCallCard: () => <div>tool</div>,
}));

function makeSession(status: AgentSession['status']): AgentSession {
  return {
    id: 'session-1',
    taskId: 'task-1',
    projectId: 'project-1',
    provider: 'claude',
    sessionType: 'chat',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeMessage(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'kind'>): ChatMessage {
  return {
    id: partial.id,
    kind: partial.kind,
    provider: partial.provider ?? 'claude',
    text: partial.text,
    data: partial.data,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

describe('ChatSessionView', () => {
  beforeEach(() => {
    useChatSessionMock.mockReset();
  });

  it('hides init metadata and duplicate result echoes', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'm1', kind: 'system', text: 'init', data: { subtype: 'init' } }),
      makeMessage({ id: 'm2', kind: 'agent-text', text: 'Hello there' }),
      makeMessage({ id: 'm3', kind: 'result', text: 'Hello there' }),
      makeMessage({ id: 'm4', kind: 'result', text: 'Something failed' }),
    ];

    useChatSessionMock.mockReturnValue({
      messages,
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    render(<ChatSessionView session={makeSession('waiting_input')} />);

    expect(screen.queryByText('init')).not.toBeInTheDocument();
    expect(screen.getAllByText('Hello there')).toHaveLength(1);
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('shows resume button for completed sessions and triggers callback', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    useChatSessionMock.mockReturnValue({
      messages: [],
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    render(<ChatSessionView session={makeSession('completed')} onResume={onResume} />);

    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  });
});
