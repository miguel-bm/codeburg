import { api } from './client';
import type { AuthStatus, AuthToken } from './types';

export const authApi = {
  getStatus: () => api.get<AuthStatus>('/auth/status'),

  setup: (password: string) =>
    api.post<AuthToken>('/auth/setup', { password }),

  login: (password: string) =>
    api.post<AuthToken>('/auth/login', { password }),

  me: () => api.get<{ user: string }>('/auth/me'),
};
