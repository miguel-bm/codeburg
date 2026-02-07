export interface BacklogToProgressConfig {
  action: 'auto_claude' | 'auto_codex' | 'ask' | 'nothing';
  defaultModel?: string;
  promptTemplate?: string;
}

export interface ProgressToReviewConfig {
  action: 'pr_manual' | 'pr_auto' | 'nothing';
  prBaseBranch?: string;
}

export interface ReviewToDoneConfig {
  action: 'merge_pr' | 'merge_branch' | 'nothing';
  mergeStrategy?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
  cleanupWorktree?: boolean;
}

export interface ProjectWorkflow {
  backlogToProgress?: BacklogToProgressConfig;
  progressToReview?: ProgressToReviewConfig;
  reviewToDone?: ReviewToDoneConfig;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  gitOrigin?: string;
  defaultBranch: string;
  symlinkPaths?: string[];
  setupScript?: string;
  teardownScript?: string;
  workflow?: ProjectWorkflow;
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
  workflow?: ProjectWorkflow;
}

export interface WorktreeResponse {
  worktreePath: string;
  branchName: string;
}

export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done';

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

export interface UpdateTaskResponse extends Task {
  workflowAction?: string;
  sessionStarted?: string;
}

export interface AuthStatus {
  setup: boolean;
}

export interface AuthToken {
  token: string;
}
