export type ChatMessageKind = 'user-text' | 'agent-text' | 'tool-call' | 'system' | 'result';
export type ChatToolState = 'running' | 'completed' | 'error';

export interface ChatToolCall {
  callId: string;
  name: string;
  title?: string;
  description?: string;
  state: ChatToolState;
  input?: unknown;
  result?: unknown;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId?: string;
  seq?: number;
  kind: ChatMessageKind;
  provider: 'claude' | 'codex' | 'terminal' | string;
  role?: 'user' | 'assistant' | string;
  text?: string;
  isThinking?: boolean;
  tool?: ChatToolCall;
  data?: Record<string, unknown>;
  createdAt?: string;
}

