import { api } from './client';

export interface GitFileStatus {
  path: string;
  status: string; // M, A, D, R, C, etc.
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

export interface GitDiff {
  diff: string;
}

export interface GitCommitResult {
  hash: string;
  message: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export interface GitStashResponse {
  entries?: GitStashEntry[];
}

export const gitApi = {
  status: (taskId: string) =>
    api.get<GitStatus>(`/tasks/${taskId}/git/status`),

  diff: (taskId: string, opts?: { file?: string; staged?: boolean; base?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.file) params.set('file', opts.file);
    if (opts?.staged) params.set('staged', 'true');
    if (opts?.base) params.set('base', 'true');
    const qs = params.toString();
    return api.get<GitDiff>(`/tasks/${taskId}/git/diff${qs ? `?${qs}` : ''}`);
  },

  stage: (taskId: string, files: string[]) =>
    api.post<void>(`/tasks/${taskId}/git/stage`, { files }),

  unstage: (taskId: string, files: string[]) =>
    api.post<void>(`/tasks/${taskId}/git/unstage`, { files }),

  revert: (taskId: string, payload: { tracked?: string[]; untracked?: string[] }) =>
    api.post<void>(`/tasks/${taskId}/git/revert`, payload),

  commit: (taskId: string, message: string, amend?: boolean) =>
    api.post<GitCommitResult>(`/tasks/${taskId}/git/commit`, { message, amend }),

  pull: (taskId: string) =>
    api.post<void>(`/tasks/${taskId}/git/pull`),

  push: (taskId: string) =>
    api.post<void>(`/tasks/${taskId}/git/push`),

  stash: (taskId: string, action: 'push' | 'pop' | 'list') =>
    api.post<GitStashResponse>(`/tasks/${taskId}/git/stash`, { action }),
};
