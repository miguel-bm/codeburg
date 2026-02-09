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
  createRepo?: boolean;
  description?: string;
  private?: boolean;
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

export const TASK_STATUS = {
  BACKLOG: 'backlog',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
} as const satisfies Record<string, TaskStatus>;

export const ALL_TASK_STATUSES: TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.IN_REVIEW,
  TASK_STATUS.DONE,
];

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  taskType: string;
  priority?: string;
  branch?: string;
  worktreePath?: string;
  prUrl?: string;
  pinned: boolean;
  position: number;
  labels: Label[];
  diffStats?: DiffStats;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  taskType?: string;
  priority?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  taskType?: string;
  priority?: string;
  branch?: string;
  worktreePath?: string;
  prUrl?: string;
  pinned?: boolean;
  position?: number;
}

export interface UpdateTaskResponse extends Task {
  workflowAction?: string;
  sessionStarted?: string;
  prCreated?: string;
  workflowError?: string;
  worktreeWarning?: string[];
}

// Sidebar types

export interface SidebarData {
  projects: SidebarProject[];
}

export interface SidebarProject {
  id: string;
  name: string;
  pinned: boolean;
  tasks: SidebarTask[];
}

export interface SidebarTask {
  id: string;
  title: string;
  status: TaskStatus;
  branch?: string;
  prUrl?: string;
  diffStats?: DiffStats;
  sessions: SidebarSession[];
}

export interface SidebarSession {
  id: string;
  provider: string;
  status: string;
  number: number;
}

export interface AuthStatus {
  setup: boolean;
  hasPasskeys: boolean;
  hasTelegram: boolean;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AuthToken {
  token: string;
}
