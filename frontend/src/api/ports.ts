import { api } from './client';

export type PortSuggestionStatus =
  | 'suggested'
  | 'already_tunneled_this_workspace'
  | 'already_tunneled_other_workspace';

export interface ExistingTunnelRef {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  projectId: string;
  port: number;
  url: string;
  status: 'starting' | 'active' | 'stopping' | 'failed';
}

export interface PortSuggestion {
  port: number;
  sources: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  status: PortSuggestionStatus;
  existingTunnel?: ExistingTunnelRef;
}

export interface WorkspacePortSuggestionsResponse {
  suggestions: PortSuggestion[];
}

export interface ScanPortsResult {
  scannedAt: string;
  portsFound: number[];
  suggestionsUpdated: number;
}

export const portsApi = {
  listWorkspaceSuggestions: (workspaceId: string) =>
    api.get<WorkspacePortSuggestionsResponse>(`/workspaces/${workspaceId}/port-suggestions`),

  scanWorkspacePorts: (workspaceId: string) =>
    api.post<ScanPortsResult>(`/workspaces/${workspaceId}/ports/scan`),
};
