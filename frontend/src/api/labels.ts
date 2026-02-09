import { api } from './client';
import type { Label } from './types';

export const labelsApi = {
  list: (projectId: string) =>
    api.get<Label[]>(`/projects/${projectId}/labels`),

  create: (projectId: string, input: { name: string; color: string }) =>
    api.post<Label>(`/projects/${projectId}/labels`, input),

  delete: (id: string) =>
    api.delete(`/labels/${id}`),

  assign: (taskId: string, labelId: string) =>
    api.post(`/tasks/${taskId}/labels`, { labelId }),

  unassign: (taskId: string, labelId: string) =>
    api.delete(`/tasks/${taskId}/labels/${labelId}`),
};
