import type { QueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Task, CreateTaskInput, UpdateTaskInput, UpdateTaskResponse, TaskStatus, WorktreeResponse } from './types';

/** Invalidate all task-related queries. Call after any task mutation. */
export function invalidateTaskQueries(queryClient: QueryClient, taskId?: string) {
  if (taskId) queryClient.invalidateQueries({ queryKey: ['task', taskId] });
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  queryClient.invalidateQueries({ queryKey: ['sidebar'] });
}

export const tasksApi = {
  list: (params?: { project?: string; status?: TaskStatus; archived?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.project) searchParams.set('project', params.project);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.archived) searchParams.set('archived', 'true');
    const query = searchParams.toString();
    return api.get<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  },

  get: (id: string) => api.get<Task>(`/tasks/${id}`),

  create: (projectId: string, input: CreateTaskInput) =>
    api.post<Task>(`/projects/${projectId}/tasks`, input),

  update: (id: string, input: UpdateTaskInput) =>
    api.patch<UpdateTaskResponse>(`/tasks/${id}`, input),

  delete: (id: string) => api.delete(`/tasks/${id}`),

  // Worktree operations
  createWorktree: (taskId: string) =>
    api.post<WorktreeResponse>(`/tasks/${taskId}/worktree`, {}),

  deleteWorktree: (taskId: string) =>
    api.delete(`/tasks/${taskId}/worktree`),

  createPR: (taskId: string) =>
    api.post<{ prUrl: string }>(`/tasks/${taskId}/create-pr`, {}),
};
