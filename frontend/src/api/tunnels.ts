import { api } from './client';

export interface TunnelInfo {
  id: string;
  workspaceId: string;
  projectId: string;
  port: number;
  url: string;
  status: 'starting' | 'active' | 'stopping' | 'failed';
  createdAt: string;
}

export const tunnelsApi = {
  list: (workspaceId: string) =>
    api.get<TunnelInfo[]>(`/workspaces/${workspaceId}/tunnels`),

  create: (workspaceId: string, port: number) =>
    api.post<TunnelInfo>(`/workspaces/${workspaceId}/tunnels`, { port }),

  stop: (workspaceId: string, tunnelId: string) =>
    api.delete(`/workspaces/${workspaceId}/tunnels/${tunnelId}`),
};
