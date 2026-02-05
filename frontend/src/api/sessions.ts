import { api } from './client';

export type SessionStatus = 'idle' | 'running' | 'waiting_input' | 'completed' | 'error';

export interface AgentSession {
  id: string;
  taskId: string;
  provider: string;
  providerSessionId?: string;
  status: SessionStatus;
  tmuxWindow?: string;
  tmuxPane?: string;
  logFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StartSessionInput {
  provider?: string;
  prompt: string;
  model?: string;
}

export const sessionsApi = {
  list: (taskId: string) =>
    api.get<AgentSession[]>(`/tasks/${taskId}/sessions`),

  get: (id: string) =>
    api.get<AgentSession>(`/sessions/${id}`),

  start: (taskId: string, input: StartSessionInput) =>
    api.post<AgentSession>(`/tasks/${taskId}/sessions`, input),

  sendMessage: (sessionId: string, content: string) =>
    api.post<{ status: string }>(`/sessions/${sessionId}/message`, { content }),

  stop: (sessionId: string) =>
    api.delete(`/sessions/${sessionId}`),
};
