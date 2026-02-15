import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChatSessionView } from './ChatSessionView';
import type { AgentSession } from '../../api/sessions';
import type { ChatMessage } from '../../api/chat';
import { useChatDraftStore } from '../../stores/chatDrafts';

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

function makeSession(status: AgentSession['status'], id = 'session-1'): AgentSession {
  return {
    id,
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
    role: partial.role,
    text: partial.text,
    isThinking: partial.isThinking,
    tool: partial.tool,
    data: partial.data,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

describe('ChatSessionView', () => {
  beforeEach(() => {
    useChatSessionMock.mockReset();
    useChatDraftStore.getState().clearAll();
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

  it('shows subagent badge for tagged agent messages', () => {
    useChatSessionMock.mockReturnValue({
      messages: [
        makeMessage({
          id: 'm1',
          kind: 'agent-text',
          text: 'Subagent output',
          data: { subagentId: 'sub-1', subagentTitle: 'Search docs' },
        }),
      ],
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    render(<ChatSessionView session={makeSession('waiting_input')} />);

    expect(screen.getByText('Subagent: Search docs')).toBeInTheDocument();
    expect(screen.getByText('Subagent output')).toBeInTheDocument();
  });

  it('hides tool-call messages flagged as hidden', () => {
    useChatSessionMock.mockReturnValue({
      messages: [
        makeMessage({
          id: 'm1',
          kind: 'tool-call',
          data: { hidden: true },
          tool: { callId: 'c1', name: 'Task', state: 'running' },
        }),
        makeMessage({
          id: 'm2',
          kind: 'tool-call',
          tool: { callId: 'c2', name: 'Bash', state: 'running' },
        }),
      ],
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    render(<ChatSessionView session={makeSession('waiting_input')} />);

    expect(screen.getAllByText('tool')).toHaveLength(1);
  });

  it('keeps drafts isolated per session when switching', () => {
    useChatSessionMock.mockReturnValue({
      messages: [],
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    const { rerender } = render(<ChatSessionView session={makeSession('waiting_input', 'session-1')} />);

    const input = screen.getByPlaceholderText('Describe your next step...') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'draft for one', selectionStart: 13, selectionEnd: 13 } });
    expect(input.value).toBe('draft for one');

    rerender(<ChatSessionView session={makeSession('waiting_input', 'session-2')} />);
    const secondInput = screen.getByPlaceholderText('Describe your next step...') as HTMLTextAreaElement;
    expect(secondInput.value).toBe('');

    fireEvent.change(secondInput, { target: { value: 'draft for two', selectionStart: 13, selectionEnd: 13 } });
    rerender(<ChatSessionView session={makeSession('waiting_input', 'session-1')} />);
    expect((screen.getByPlaceholderText('Describe your next step...') as HTMLTextAreaElement).value).toBe('draft for one');
  });

  it('restores an unsent draft after unmount and remount', () => {
    useChatSessionMock.mockReturnValue({
      messages: [],
      connected: true,
      connecting: false,
      error: null,
      sendMessage: vi.fn(),
      interrupt: vi.fn(),
    });

    const { unmount } = render(<ChatSessionView session={makeSession('waiting_input', 'session-1')} />);
    const input = screen.getByPlaceholderText('Describe your next step...') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'persist me', selectionStart: 10, selectionEnd: 10 } });
    unmount();

    render(<ChatSessionView session={makeSession('waiting_input', 'session-1')} />);
    expect((screen.getByPlaceholderText('Describe your next step...') as HTMLTextAreaElement).value).toBe('persist me');
  });
});
