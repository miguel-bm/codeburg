import { api } from './client';
import { getAuthToken } from '../platform/authTokenStorage';
import { getApiHttpBase } from '../platform/runtimeConfig';
import type {
  Workspace,
  TerminalSession,
  Conversation,
  PiConversationSnapshot,
  PiConversationImageAttachment,
  PiConversationForkPosition,
  PiConversationTree,
  PiAvailableModel,
  PiSlashCommand,
  PiThinkingLevel,
  PiConversationSessionStats,
  ForkConversationFromMessageResponse,
  PiStatus,
  PiConfigDocument,
  PiConfigResponse,
  PiWebAccessStatus,
  UpdatePiWebAccessConfigInput,
  ConversationWorkspaceLink,
  ManagedSkill,
  SkillCatalogEntry,
  SkillCatalogSource,
  ProjectSkillsResponse,
  HarnessStatus,
  HarnessToolId,
  V2SidebarData,
  Task,
  TaskLink,
  TaskLinkTargetType,
  CreateTaskInput,
  UpdateTaskInput,
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

export interface WorkspaceLifecycleInput {
  cleanupWorktree?: boolean;
}

export interface MergeWorkspaceInput extends WorkspaceLifecycleInput {
  syncFirst?: boolean;
  pushAfterMerge?: boolean;
  deleteBranch?: boolean;
  mergeStrategy?: string;
  targetBranch?: string;
}

export interface WorkspaceConflictContext {
  operation: string;
  branch: string;
  baseBranch: string;
  conflictedFiles: string[];
  status: string;
  unmerged: string;
  prompt: string;
}

export interface WorkspacePullRequest {
  exists: boolean;
  url?: string;
  state?: string;
  title?: string;
  baseBranch?: string;
  headBranch?: string;
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
  excludeStatus?: 'active' | 'paused' | 'completed' | 'archived';
  provider?: string;
  limit?: number;
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

export interface CreateTaskLinkInput {
  targetType: TaskLinkTargetType;
  targetId: string;
  relationType?: string;
}

export const v2Api = {
  getSidebar: (input?: { includeConversations?: boolean; includeStates?: boolean }) => {
    const search = new URLSearchParams();
    if (input?.includeConversations === false) search.set('conversations', '0');
    if (input?.includeStates === false) search.set('states', '0');
    const query = search.toString();
    return api.get<V2SidebarData>(`/sidebar/v2${query ? `?${query}` : ''}`);
  },

  listConversations: (input?: string | ListConversationsInput) => {
    const search = new URLSearchParams();
    const params = typeof input === 'string' ? { projectId: input } : input;
    if (params?.projectId) search.set('projectId', params.projectId);
    if (params?.q) search.set('q', params.q);
    if (params?.status) search.set('status', params.status);
    if (params?.excludeStatus) search.set('excludeStatus', params.excludeStatus);
    if (params?.provider) search.set('provider', params.provider);
    if (params?.limit) search.set('limit', String(params.limit));
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

  mergeWorkspace: (workspaceId: string, input?: MergeWorkspaceInput) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/merge`, input ?? {}),

  abandonWorkspace: (workspaceId: string, input?: WorkspaceLifecycleInput) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/abandon`, input ?? {}),

  archiveWorkspace: (workspaceId: string, input?: WorkspaceLifecycleInput) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/archive`, input ?? {}),

  cleanupWorkspace: (workspaceId: string) =>
    api.post<Workspace>(`/workspaces/${workspaceId}/cleanup`, {}),

  deleteWorkspace: (workspaceId: string) =>
    api.delete(`/workspaces/${workspaceId}`),

  rebaseWorkspace: (workspaceId: string, input: { baseBranch: string; fetch?: boolean }) =>
    api.post<void>(`/workspaces/${workspaceId}/git/rebase`, input),

  continueWorkspaceGitOperation: (workspaceId: string) =>
    api.post<void>(`/workspaces/${workspaceId}/git/operation/continue`, {}),

  abortWorkspaceGitOperation: (workspaceId: string) =>
    api.post<void>(`/workspaces/${workspaceId}/git/operation/abort`, {}),

  getWorkspaceConflictContext: (workspaceId: string) =>
    api.get<WorkspaceConflictContext>(`/workspaces/${workspaceId}/git/conflict-context`),

  getWorkspacePullRequest: (workspaceId: string) =>
    api.get<WorkspacePullRequest>(`/workspaces/${workspaceId}/pull-request`),

  createWorkspacePullRequest: (workspaceId: string, input: { title?: string; body?: string }) =>
    api.post<WorkspacePullRequest>(`/workspaces/${workspaceId}/pull-request`, input),

  listProjectConversations: (projectId: string, input?: Omit<ListConversationsInput, 'projectId'>) => {
    const search = new URLSearchParams();
    if (input?.q) search.set('q', input.q);
    if (input?.status) search.set('status', input.status);
    if (input?.excludeStatus) search.set('excludeStatus', input.excludeStatus);
    if (input?.provider) search.set('provider', input.provider);
    if (input?.limit) search.set('limit', String(input.limit));
    const query = search.toString();
    return api.get<Conversation[]>(`/projects/${projectId}/conversations${query ? `?${query}` : ''}`);
  },

  createConversation: (projectId: string, input: CreateConversationInput) =>
    api.post<Conversation>(`/projects/${projectId}/conversations`, input),

  listProjectTasks: (projectId: string) =>
    api.get<Task[]>(`/tasks?project=${encodeURIComponent(projectId)}`),

  createProjectTask: (projectId: string, input: CreateTaskInput) =>
    api.post<Task>(`/projects/${projectId}/tasks`, input),

  updateTaskTracking: (taskId: string, input: UpdateTaskInput) =>
    api.patch<Task>(`/tasks/${taskId}/tracking`, input),

  deleteProjectTask: (taskId: string) =>
    api.delete(`/tasks/${taskId}`),

  listProjectTaskLinks: (projectId: string, input?: { targetType?: TaskLinkTargetType; targetId?: string }) => {
    const search = new URLSearchParams();
    if (input?.targetType) search.set('targetType', input.targetType);
    if (input?.targetId) search.set('targetId', input.targetId);
    const query = search.toString();
    return api.get<TaskLink[]>(`/projects/${projectId}/task-links${query ? `?${query}` : ''}`);
  },

  listTaskLinks: (taskId: string) =>
    api.get<TaskLink[]>(`/tasks/${taskId}/links`),

  createTaskLink: (taskId: string, input: CreateTaskLinkInput) =>
    api.post<TaskLink>(`/tasks/${taskId}/links`, input),

  deleteTaskLink: (taskId: string, linkId: string) =>
    api.delete(`/tasks/${taskId}/links/${linkId}`),

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

  forkConversationFromMessage: (
    conversationId: string,
    input: { entryId: string; position?: PiConversationForkPosition; title?: string; currentWorkspaceId?: string }
  ) => api.post<ForkConversationFromMessageResponse>(`/conversations/${conversationId}/fork-message`, input),

  getConversationTree: (conversationId: string) =>
    api.get<PiConversationTree>(`/conversations/${conversationId}/tree`),

  selectConversationTreeLeaf: (conversationId: string, input: { leafId: string }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/tree/select`, input),

  editConversationTreeMessage: (
    conversationId: string,
    input: { entryId: string; message: string; images?: PiConversationImageAttachment[] }
  ) => api.post<PiConversationSnapshot>(`/conversations/${conversationId}/tree/edit`, input),

  pauseConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/pause`, {}),

  resumeConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/resume`, {}),

  completeConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/complete`, {}),

  archiveConversation: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/archive`, {}),

  markConversationRead: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/read`, {}),

  markConversationUnread: (conversationId: string) =>
    api.post<Conversation>(`/conversations/${conversationId}/unread`, {}),

  deleteConversation: (conversationId: string) =>
    api.delete(`/conversations/${conversationId}`),

  getConversationState: (conversationId: string) =>
    api.get<PiConversationSnapshot>(`/conversations/${conversationId}/state`),

  promptConversation: (conversationId: string, input: { message: string; images?: PiConversationImageAttachment[]; streamingBehavior?: 'steer' | 'followUp' }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/prompt`, input),

  abortConversation: (conversationId: string) =>
    api.post(`/conversations/${conversationId}/abort`, {}),

  listConversationModels: (conversationId: string) =>
    api.get<{ models: PiAvailableModel[] }>(`/conversations/${conversationId}/models`),

  setConversationModel: (conversationId: string, input: { provider: string; modelId: string }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/model`, input),

  setConversationThinking: (conversationId: string, input: { level: PiThinkingLevel }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/thinking`, input),

  setConversationAutoCompaction: (conversationId: string, input: { enabled: boolean }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/auto-compaction`, input),

  compactConversation: (conversationId: string, input?: { customInstructions?: string }) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/compact`, input ?? {}),

  getConversationSession: (conversationId: string) =>
    api.get<PiConversationSessionStats>(`/conversations/${conversationId}/session`),

  exportConversationHTML: (conversationId: string, input?: { outputPath?: string }) =>
    api.post<{ path: string }>(`/conversations/${conversationId}/export/html`, input ?? {}),

  reloadConversationPi: (conversationId: string) =>
    api.post<PiConversationSnapshot>(`/conversations/${conversationId}/reload`, {}),

  listConversationCommands: (conversationId: string, input?: { activate?: boolean }) =>
    api.get<{ commands: PiSlashCommand[] }>(`/conversations/${conversationId}/commands${input?.activate ? '?activate=1' : ''}`),

  getPiStatus: () =>
    api.get<PiStatus>('/pi/status'),

  getPiConfig: () =>
    api.get<PiConfigResponse>('/pi/config'),

  getProjectPiConfig: (projectId: string) =>
    api.get<PiConfigResponse>(`/projects/${projectId}/pi/config`),

  getHarnessStatus: (checkLatest = false) =>
    api.get<HarnessStatus>(`/harness/status${checkLatest ? '?latest=1' : ''}`),

  streamHarnessUpdate: (tool: HarnessToolId, onEvent: (event: HarnessUpdateEvent) => void) =>
    streamHarnessUpdate(tool, onEvent),

  updatePiSettings: (content: string) =>
    api.put<PiConfigDocument>('/pi/settings', { content }),

  updatePiModels: (content: string) =>
    api.put<PiConfigDocument>('/pi/models', { content }),

  updatePiWebAccessConfig: (input: UpdatePiWebAccessConfigInput) =>
    api.put<PiWebAccessStatus>('/pi/web-access', input),

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

  installGlobalSkill: (input: InstallProjectSkillInput) =>
    api.post<ManagedSkill>('/skills', input),

  installGlobalCatalogSkill: (
    input: { sourceId: string; skillPath: string; target?: string; name?: string }
  ) => api.post<ManagedSkill>('/skills/catalog', input),

  deleteGlobalSkill: (target: string, name: string) =>
    api.delete(`/skills/${encodeURIComponent(target)}/${encodeURIComponent(name)}`),

  listSkillCatalog: () =>
    api.get<SkillCatalogEntry[]>('/skills/catalog'),

  listSkillCatalogSources: () =>
    api.get<SkillCatalogSource[]>('/skills/catalog/sources'),

  refreshSkillCatalog: () =>
    api.post<SkillCatalogSource[]>('/skills/catalog/refresh', {}),

  createSkillCatalogSource: (input: { name: string; repoUrl: string; repoRef?: string; skillPrefixes?: string[] }) =>
    api.post<SkillCatalogSource>('/skills/catalog/sources', input),

  deleteSkillCatalogSource: (sourceId: string) =>
    api.delete(`/skills/catalog/sources/${encodeURIComponent(sourceId)}`),

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

export interface HarnessUpdateEvent {
  event: 'status' | 'stdout' | 'stderr' | 'error' | 'done' | string;
  data: string;
}

async function streamHarnessUpdate(tool: HarnessToolId, onEvent: (event: HarnessUpdateEvent) => void): Promise<number> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${getApiHttpBase()}/harness/tools/${tool}/update/stream`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => 'Update failed') }));
    throw new Error(payload.error || 'Update failed');
  }
  if (!response.body) {
    throw new Error('Streaming is not supported by this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode = 0;

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const event = eventLine ? eventLine.slice(6).trim() : 'message';
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!eventLine && !data) return;
    onEvent({ event, data });
    if (event === 'done') {
      try {
        const parsed = JSON.parse(data) as { exitCode?: number };
        exitCode = parsed.exitCode ?? 0;
      } catch {
        exitCode = 0;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processBlock(block);
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);
  return exitCode;
}
