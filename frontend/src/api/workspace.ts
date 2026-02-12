import { api } from './client';
import type { AgentSession, StartSessionInput } from './sessions';
import type { GitStatus, GitDiff, GitDiffContent, GitCommitResult, GitStashResponse, GitLogResponse } from './git';
import type { TunnelInfo } from './tunnels';

// --- Scoped API factories ---
// These create API functions scoped to either a project or task prefix.

export type WorkspaceScopeType = 'project' | 'task';

/** Build a scoped API prefix: /projects/{id} or /tasks/{id} */
function scopePrefix(type: WorkspaceScopeType, id: string): string {
  return type === 'project' ? `/projects/${id}` : `/tasks/${id}`;
}

// --- Sessions ---

export function createSessionsApi(type: WorkspaceScopeType, id: string) {
  const prefix = scopePrefix(type, id);
  return {
    list: () => api.get<AgentSession[]>(`${prefix}/sessions`),
    start: (input: StartSessionInput) => api.post<AgentSession>(`${prefix}/sessions`, input),
  };
}

// --- Git ---

export function createGitApi(type: WorkspaceScopeType, id: string) {
  const prefix = scopePrefix(type, id);
  return {
    status: () => api.get<GitStatus>(`${prefix}/git/status`),

    diff: (opts?: { file?: string; staged?: boolean; base?: boolean; commit?: string }) => {
      const params = new URLSearchParams();
      if (opts?.file) params.set('file', opts.file);
      if (opts?.staged) params.set('staged', 'true');
      if (opts?.base) params.set('base', 'true');
      if (opts?.commit) params.set('commit', opts.commit);
      const qs = params.toString();
      return api.get<GitDiff>(`${prefix}/git/diff${qs ? `?${qs}` : ''}`);
    },

    diffContent: (opts: { file: string; staged?: boolean; base?: boolean; commit?: string }) => {
      const params = new URLSearchParams({ file: opts.file });
      if (opts.staged) params.set('staged', 'true');
      if (opts.base) params.set('base', 'true');
      if (opts.commit) params.set('commit', opts.commit);
      return api.get<GitDiffContent>(`${prefix}/git/diff-content?${params}`);
    },

    stage: (files: string[]) => api.post<void>(`${prefix}/git/stage`, { files }),
    unstage: (files: string[]) => api.post<void>(`${prefix}/git/unstage`, { files }),
    revert: (payload: { tracked?: string[]; untracked?: string[] }) =>
      api.post<void>(`${prefix}/git/revert`, payload),
    commit: (message: string, amend?: boolean) =>
      api.post<GitCommitResult>(`${prefix}/git/commit`, { message, amend }),
    pull: () => api.post<void>(`${prefix}/git/pull`),
    push: (opts?: { force?: boolean }) => api.post<void>(`${prefix}/git/push`, opts),
    stash: (action: 'push' | 'pop' | 'list') =>
      api.post<GitStashResponse>(`${prefix}/git/stash`, { action }),
    log: (limit?: number) => {
      const params = limit ? `?limit=${limit}` : '';
      return api.get<GitLogResponse>(`${prefix}/git/log${params}`);
    },
  };
}

// --- Files ---

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modTime: string;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

export interface FileReadResponse {
  path: string;
  size: number;
  modTime: string;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export interface FileSearchMatch {
  line: number;
  content: string;
}

export interface FileSearchResult {
  file: string;
  matches: FileSearchMatch[];
}

export function createFilesApi(type: WorkspaceScopeType, id: string) {
  const prefix = scopePrefix(type, id);
  return {
    list: (path?: string, depth?: number) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (depth) params.set('depth', String(depth));
      const qs = params.toString();
      return api.get<FileListResponse>(`${prefix}/files${qs ? `?${qs}` : ''}`);
    },

    read: (path: string) => {
      const params = new URLSearchParams({ path });
      return api.get<FileReadResponse>(`${prefix}/file?${params}`);
    },

    write: (path: string, content: string) =>
      api.put<FileReadResponse>(`${prefix}/file`, { path, content }),

    create: (path: string, type: 'file' | 'dir') =>
      api.post(`${prefix}/files`, { path, type }),

    delete: (path: string) => {
      const params = new URLSearchParams({ path });
      return api.delete(`${prefix}/file?${params}`);
    },

    rename: (from: string, to: string) =>
      api.post<FileEntry>(`${prefix}/file/rename`, { from, to }),

    duplicate: (path: string) =>
      api.post<FileEntry>(`${prefix}/file/duplicate`, { path }),

    search: (query: string, opts?: { regex?: boolean; caseSensitive?: boolean; maxResults?: number }) =>
      api.post<{ results: FileSearchResult[] }>(`${prefix}/files/search`, { query, ...opts }),
  };
}

// --- Tunnels ---

export function createTunnelsApi(type: WorkspaceScopeType, id: string) {
  const prefix = scopePrefix(type, id);
  return {
    list: () => api.get<TunnelInfo[]>(`${prefix}/tunnels`),
    create: (port: number) => api.post<TunnelInfo>(`${prefix}/tunnels`, { port }),
  };
}

// --- Recipes ---

export interface Recipe {
  name: string;
  command: string;
  source: string;
  description?: string;
}

interface RecipesResponse {
  recipes: Recipe[];
  sources: string[];
}

export function createRecipesApi(type: WorkspaceScopeType, id: string) {
  const prefix = scopePrefix(type, id);
  return {
    list: async (): Promise<{ recipes: Recipe[]; sources: string[] }> => {
      const resp = await api.get<RecipesResponse>(`${prefix}/recipes`);
      return { recipes: resp.recipes ?? [], sources: resp.sources ?? [] };
    },
    run: (recipe: string) => api.post(`${prefix}/just/${recipe}`),
  };
}
