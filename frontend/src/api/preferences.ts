import { api } from './client';

export const preferencesApi = {
  get: <T>(key: string) => api.get<T>(`/preferences/${key}`),
  set: <T>(key: string, value: T) => api.put<T>(`/preferences/${key}`, value),
  delete: (key: string) => api.delete(`/preferences/${key}`),

  // Convenience helpers
  getPinnedProjects: () =>
    api.get<string[]>('/preferences/pinned_projects').catch(() => []),
  setPinnedProjects: (ids: string[]) =>
    api.put<string[]>('/preferences/pinned_projects', ids),
};
