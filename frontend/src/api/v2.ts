import { api } from './client';
import type {
  Workspace,
  TerminalSession,
  Conversation,
  PiConversationSnapshot,
  PiStatus,
  PiConfigDocument,
  PiConfigResponse,
  ConversationWorkspaceLink,
  ManagedSkill,
  SkillCatalogEntry,
  ProjectSkillsResponse,
} from './types';
import type { GitStatus, GitDiff, GitDiffContent } from './git';

export interface V2FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modTime: string;
}

export interface V2FileListResponse {
  path: string;
  entries: V2FileEntry[];
}

export interface V2FileReadResponse {
  path: string;
  size: number;
  modTime: string;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export interface CreateWorkspaceInput {
  name: string;
  branchName?: string;
  baseBranch?: string;
  sourceWorkspaceId?: string;
}

export interface WorkspaceMutationResponse {
  workspace: Workspace;
  warnings?: string[];
}

export interface CreateConversationInput {
  title: string;
  currentWorkspaceId?: string;
  provider?: string;
}

export interface UpdateConversationInput {
  title?: string;
  currentWorkspaceId?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  summary?: string;
}

export interface ListConversationsInput {
  projectId?: string;
  q?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  provider?: string;
}

export interface ForkConversationInput {
  title?: string;
  currentWorkspaceId?: string;
}

export interface InstallProjectSkillInput {
  sourcePath: string;
  target?: string;
  mode?: 'symlink' | 'copy';
  name?: string;
}

export const v2Api = {
  listConversations: (input?: string | ListConversationsInput) => {
    const search = new URLSearchParams();
    const params = typeof input === 'string' ? { projectId: input } : input;
    if (params?.projectId) search.set('projectId', params.projectId);
    if (params?.q) search.set('q', params.q);
    if (params?.status) search.set('status', params.status);
    if (params?.provider) search.set('provider', params.provider);
    const query = search.toString();
    return api.get<Conversation[]>(`/conversations${query ? `?${query}` : ''}`);
  },

  listWorkspaces: (projectId: string) =>
    api.get<Workspace[]>(`/projects/${projectId}/workspaces`),

  createWorkspace: (projectId: string, input: CreateWorkspaceInput) =>
    api.post<WorkspaceMutationResponse>(`/projects/${projectId}/workspaces`, input),

  getWorkspace: (workspaceId: string) =>
    api.get<Workspace>(`/workspaces/${workspaceId}`),

  forkWorkspace: (workspaceId: string, input: Omit<CreateWorkspaceInput, 'sourceWorkspaceId'>) =>
    api.post<WorkspaceMutationResponse>(`/workspaces/${workspaceId}/fork`, input),

  syncWorkspace: (workspaceId: string) =>
    api.post<{ branch: string; baseBranch: string; remote: string; updated: boolean }>(`/workspaces/${workspaceId}/sync`, {}),

  activateWorkspace: (workspaceId: string) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/activate`, {}),

  mergeWorkspace: (workspaceId: string) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/merge`, {}),

  abandonWorkspace: (workspaceId: string) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/abandon`, {}),

  archiveWorkspace: (workspaceId: string) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/archive`, {}),

  deleteWorkspace: (workspaceId: string) =>
    api.delete(`/workspaces/${workspaceId}`),

  listProjectConversations: (projectId: string, input?: Omit<ListConversationsInput, 'projectId'>) => {
    const search = new URLSearchParams();
    if (input?.q) search.set('q', input.q);
    if (input?.status) search.set('status', input.status);
    if (input?.provider) search.set('provider', input.provider);
    const query = search.toString();
    return api.get<Conversation[]>(`/projects/${projectId}/conversations${query ? `?${query}` : ''}`);
  },

  createConversation: (projectId: string, input: CreateConversationInput) =>
    api.post<Conversation>(`/projects/${projectId}/conversations`, input),

  getConversation: (conversationId: string) =>
    api.get<Conversation>(`/conversations/${conversationId}`),

  updateConversation: (conversationId: string, input: UpdateConversationInput) =>
    api.patch<Conversation>(`/conversations/${conversationId}`, input),

  listConversationWorkspaceLinks: (conversationId: string) =>
    api.get<ConversationWorkspaceLink[]>(`/conversations/${conversationId}/workspaces`),

  switchConversationWorkspace: (conversationId: string, input: { currentWorkspaceId?: string; reason?: string }) =>
    api.post<Conversation>(`/conversations/${conversationId}/workspace`, input),

  forkConversation: (conversationId: string, input?: ForkConversationInput) =>
    api.post<Conversation>(`/conversations/${conversationId}/fork`, input ?? {}),

  pauseConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/pause`, {}),

  resumeConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/resume`, {}),

  completeConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/complete`, {}),

  archiveConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/archive`, {}),

  getConversationState: (conversationId: string) =>
    api.get<PiConversationSnapshot>(`/conversations/${conversationId}/state`),

  promptConversation: (conversationId: string, input: { message: string }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/prompt`, input),

  abortConversation: (conversationId: string) =>
    api.post(`/conversations/${conversationId}/abort`, {}),

  getPiStatus: () =>
    api.get<PiStatus>('/pi/status'),

  getPiConfig: () =>
    api.get<PiConfigResponse>('/pi/config'),

  getProjectPiConfig: (projectId: string) =>
    api.get<PiConfigResponse>(`/projects/${projectId}/pi/config`),

  updatePiSettings: (content: string) =>
    api.put<PiConfigDocument>('/pi/settings', { content }),

  updatePiModels: (content: string) =>
    api.put<PiConfigDocument>('/pi/models', { content }),

  updateProjectPiSettings: (projectId: string, content: string) =>
    api.put<PiConfigDocument>(`/projects/${projectId}/pi/settings`, { content }),

  installPiPackage: (source: string) =>
    api.post<PiConfigResponse>('/pi/packages/install', { source }),

  removePiPackage: (source: string) =>
    api.post<PiConfigResponse>('/pi/packages/remove', { source }),

  updatePiPackages: (source?: string) =>
    api.post<PiConfigResponse>('/pi/packages/update', source ? { source } : {}),

  installProjectPiPackage: (projectId: string, source: string) =>
    api.post<PiConfigResponse>(`/projects/${projectId}/pi/packages/install`, { source }),

  removeProjectPiPackage: (projectId: string, source: string) =>
    api.post<PiConfigResponse>(`/projects/${projectId}/pi/packages/remove`, { source }),

  updateProjectPiPackages: (projectId: string, source?: string) =>
    api.post<PiConfigResponse>(`/projects/${projectId}/pi/packages/update`, source ? { source } : {}),

  addPiExtension: (path: string) =>
    api.post<PiConfigResponse>('/pi/extensions', { path }),

  removePiExtension: (path: string) =>
    api.post<PiConfigResponse>('/pi/extensions/remove', { path }),

  addProjectPiExtension: (projectId: string, path: string) =>
    api.post<PiConfigResponse>(`/projects/${projectId}/pi/extensions`, { path }),

  removeProjectPiExtension: (projectId: string, path: string) =>
    api.post<PiConfigResponse>(`/projects/${projectId}/pi/extensions/remove`, { path }),

  listSkills: () =>
    api.get<ManagedSkill[]>('/skills'),

  listSkillCatalog: () =>
    api.get<SkillCatalogEntry[]>('/skills/catalog'),

  listProjectSkills: (projectId: string) =>
    api.get<ProjectSkillsResponse>(`/projects/${projectId}/skills`),

  installProjectSkill: (projectId: string, input: InstallProjectSkillInput) =>
    api.post<ManagedSkill>(`/projects/${projectId}/skills`, input),

  installCatalogSkill: (
    projectId: string,
    input: { sourceId: string; skillPath: string; target?: string; name?: string }
  ) => api.post<ManagedSkill>(`/projects/${projectId}/skills/catalog`, input),

  deleteProjectSkill: (projectId: string, target: string, name: string) =>
    api.delete(`/projects/${projectId}/skills/${encodeURIComponent(target)}/${encodeURIComponent(name)}`),

  listTerminals: (workspaceId: string) =>
    api.get<TerminalSession[]>(`/workspaces/${workspaceId}/terminals`),

  createTerminal: (
    workspaceId: string,
    input?: { title?: string; cwd?: string; shell?: string; providerHint?: string; initialCommand?: string }
  ) => api.post<TerminalSession>(`/workspaces/${workspaceId}/terminals`, input ?? {}),

  getTerminal: (terminalId: string) =>
    api.get<TerminalSession>(`/terminals/${terminalId}`),

  updateTerminal: (terminalId: string, input: { title?: string }) =>
    api.patch<TerminalSession>(`/terminals/${terminalId}`, input),

  deleteTerminal: (terminalId: string) =>
    api.delete(`/terminals/${terminalId}`),

  listFiles: (workspaceId: string, params?: { path?: string; depth?: number }) => {
    const search = new URLSearchParams();
    if (params?.path) search.set('path', params.path);
    if (params?.depth) search.set('depth', String(params.depth));
    const query = search.toString();
    return api.get<V2FileListResponse>(`/workspaces/${workspaceId}/files${query ? `?${query}` : ''}`);
  },

  readFile: (workspaceId: string, path: string) => {
    const search = new URLSearchParams({ path });
    return api.get<V2FileReadResponse>(`/workspaces/${workspaceId}/file?${search.toString()}`);
  },

  gitStatus: (workspaceId: string) =>
    api.get<GitStatus>(`/workspaces/${workspaceId}/git/status`),

  gitDiff: (workspaceId: string, opts?: { file?: string; staged?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.file) params.set('file', opts.file);
    if (opts?.staged) params.set('staged', 'true');
    const qs = params.toString();
    return api.get<GitDiff>(`/workspaces/${workspaceId}/git/diff${qs ? `?${qs}` : ''}`);
  },

  gitDiffContent: (workspaceId: string, opts: { file: string; staged?: boolean }) => {
    const params = new URLSearchParams({ file: opts.file });
    if (opts.staged) params.set('staged', 'true');
    return api.get<GitDiffContent>(`/workspaces/${workspaceId}/git/diff-content?${params.toString()}`);
  },
};
