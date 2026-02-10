import { api } from './client';

export type PortSuggestionStatus =
  | 'suggested'
  | 'already_tunneled_this_task'
  | 'already_tunneled_other_task';

export interface ExistingTunnelRef {
  id: string;
  taskId: string;
  taskTitle?: string;
  port: number;
  url: string;
}

export interface PortSuggestion {
  port: number;
  sources: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  status: PortSuggestionStatus;
  existingTunnel?: ExistingTunnelRef;
}

export interface TaskPortSuggestionsResponse {
  suggestions: PortSuggestion[];
}

export interface ScanPortsResult {
  scannedAt: string;
  portsFound: number[];
  suggestionsUpdated: number;
}

export const portsApi = {
  listTaskSuggestions: (taskId: string) =>
    api.get<TaskPortSuggestionsResponse>(`/tasks/${taskId}/port-suggestions`),

  scanTaskPorts: (taskId: string) =>
    api.post<ScanPortsResult>(`/tasks/${taskId}/ports/scan`),
};
