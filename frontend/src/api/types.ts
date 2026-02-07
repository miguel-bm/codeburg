export interface Project {
  id: string;
  name: string;
  path: string;
  gitOrigin?: string;
  defaultBranch: string;
  symlinkPaths?: string[];
  setupScript?: string;
  teardownScript?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path?: string;
  githubUrl?: string;
  gitOrigin?: string;
  defaultBranch?: string;
  symlinkPaths?: string[];
  setupScript?: string;
  teardownScript?: string;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  gitOrigin?: string;
  defaultBranch?: string;
  symlinkPaths?: string[];
  setupScript?: string;
  teardownScript?: string;
}

export interface WorktreeResponse {
  worktreePath: string;
  branchName: string;
}

export type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'done';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  branch?: string;
  worktreePath?: string;
  pinned: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  branch?: string;
  worktreePath?: string;
  pinned?: boolean;
}

export interface AuthStatus {
  setup: boolean;
}

export interface AuthToken {
  token: string;
}
