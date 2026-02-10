import { api } from './client';
import type { Project, CreateProjectInput, UpdateProjectInput, ProjectSecretFile } from './types';

export interface ProjectFileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modTime: string;
}

export interface ProjectFilesResponse {
  path: string;
  entries: ProjectFileEntry[];
}

export interface ProjectFileContentResponse {
  path: string;
  size: number;
  modTime: string;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export interface ProjectSecretFileStatus extends ProjectSecretFile {
  managedPath: string;
  managedExists: boolean;
  resolvedSource?: string;
  resolvedKind?: string;
}

export interface ProjectSecretsResponse {
  secretFiles: ProjectSecretFileStatus[];
}

export interface ProjectSecretContentResponse {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ProjectSecretResolveResult {
  path: string;
  mode: 'copy' | 'symlink';
  enabled: boolean;
  resolvedSource?: string;
  resolvedKind?: string;
}

export interface ProjectSecretResolveResponse {
  results: ProjectSecretResolveResult[];
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),

  get: (id: string) => api.get<Project>(`/projects/${id}`),

  create: (input: CreateProjectInput) =>
    api.post<Project>('/projects', input),

  update: (id: string, input: UpdateProjectInput) =>
    api.patch<Project>(`/projects/${id}`, input),

  delete: (id: string) => api.delete(`/projects/${id}`),

  listBranches: (id: string) => api.get<string[]>(`/projects/${id}/branches`),

  listFiles: (id: string, params?: { path?: string; depth?: number }) => {
    const search = new URLSearchParams();
    if (params?.path) search.set('path', params.path);
    if (params?.depth) search.set('depth', String(params.depth));
    const query = search.toString();
    return api.get<ProjectFilesResponse>(`/projects/${id}/files${query ? `?${query}` : ''}`);
  },

  readFile: (id: string, path: string) => {
    const search = new URLSearchParams({ path });
    return api.get<ProjectFileContentResponse>(`/projects/${id}/file?${search.toString()}`);
  },

  getSecrets: (id: string) =>
    api.get<ProjectSecretsResponse>(`/projects/${id}/secrets`),

  updateSecrets: (id: string, secretFiles: ProjectSecretFile[]) =>
    api.patch<Project>(`/projects/${id}/secrets`, { secretFiles }),

  getSecretContent: (id: string, path: string) => {
    const search = new URLSearchParams({ path });
    return api.get<ProjectSecretContentResponse>(`/projects/${id}/secrets/content?${search.toString()}`);
  },

  putSecretContent: (id: string, path: string, content: string) =>
    api.put<{ path: string }>(`/projects/${id}/secrets/content`, { path, content }),

  resolveSecrets: (id: string, paths?: string[]) =>
    api.post<ProjectSecretResolveResponse>(`/projects/${id}/secrets/resolve`, { paths }),
};
