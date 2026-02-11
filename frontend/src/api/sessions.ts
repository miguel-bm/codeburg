import { api } from './client';

export type SessionStatus = 'idle' | 'running' | 'waiting_input' | 'completed' | 'error';
export type SessionProvider = 'claude' | 'codex' | 'terminal';

export interface AgentSession {
  id: string;
  taskId?: string;
  projectId: string;
  provider: SessionProvider;
  sessionType: string;
  providerSessionId?: string;
  status: SessionStatus;
  tmuxWindow?: string;
  tmuxPane?: string;
  logFile?: string;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StartSessionInput {
  provider?: SessionProvider;
  prompt?: string;
  model?: string;
  resumeSessionId?: string;
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
    api.post(`/sessions/${sessionId}/stop`),

  delete: (sessionId: string) =>
    api.delete(`/sessions/${sessionId}`),
};
