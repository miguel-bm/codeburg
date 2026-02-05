import { api } from './client';

export interface TunnelInfo {
  id: string;
  taskId: string;
  port: number;
  url: string;
}

export const tunnelsApi = {
  // List tunnels for a task
  list: (taskId: string) =>
    api.get<TunnelInfo[]>(`/tasks/${taskId}/tunnels`),

  // Create a tunnel
  create: (taskId: string, port: number) =>
    api.post<TunnelInfo>(`/tasks/${taskId}/tunnels`, { port }),

  // Stop a tunnel
  stop: (tunnelId: string) =>
    api.delete(`/tunnels/${tunnelId}`),
};
