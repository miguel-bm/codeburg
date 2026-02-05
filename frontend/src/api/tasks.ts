import { api } from './client';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskStatus, WorktreeResponse } from './types';

export const tasksApi = {
  list: (params?: { project?: string; status?: TaskStatus }) => {
    const searchParams = new URLSearchParams();
    if (params?.project) searchParams.set('project', params.project);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return api.get<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  },

  get: (id: string) => api.get<Task>(`/tasks/${id}`),

  create: (projectId: string, input: CreateTaskInput) =>
    api.post<Task>(`/projects/${projectId}/tasks`, input),

  update: (id: string, input: UpdateTaskInput) =>
    api.patch<Task>(`/tasks/${id}`, input),

  delete: (id: string) => api.delete(`/tasks/${id}`),

  // Worktree operations
  createWorktree: (taskId: string) =>
    api.post<WorktreeResponse>(`/tasks/${taskId}/worktree`, {}),

  deleteWorktree: (taskId: string) =>
    api.delete(`/tasks/${taskId}/worktree`),
};
