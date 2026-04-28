import type { SessionProvider, SessionStatus } from './sessions';

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
  pushAfterMerge?: boolean;
}

export interface ProjectWorkflow {
  backlogToProgress?: BacklogToProgressConfig;
  progressToReview?: ProgressToReviewConfig;
  reviewToDone?: ReviewToDoneConfig;
}

export interface ProjectSecretFile {
  path: string;
  mode: 'copy' | 'symlink';
  sourcePath?: string;
  enabled: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  gitOrigin?: string;
  defaultBranch: string;
  symlinkPaths?: string[];
  secretFiles?: ProjectSecretFile[];
  setupScript?: string;
  teardownScript?: string;
  workflow?: ProjectWorkflow;
  hidden: boolean;
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
  secretFiles?: ProjectSecretFile[];
  setupScript?: string;
  teardownScript?: string;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  gitOrigin?: string;
  defaultBranch?: string;
  symlinkPaths?: string[];
  secretFiles?: ProjectSecretFile[];
  setupScript?: string;
  teardownScript?: string;
  workflow?: ProjectWorkflow;
  hidden?: boolean;
}

export interface WorktreeResponse {
  worktreePath: string;
  branchName: string;
}

export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done';
export type TaskBranchMode = 'create_from_default' | 'adopt_existing';

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
  archivedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  taskType?: string;
  priority?: string;
  branch?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  taskType?: string;
  priority?: string;
  branch?: string;
  branchMode?: TaskBranchMode;
  worktreePath?: string;
  prUrl?: string;
  pinned?: boolean;
  position?: number;
  archived?: boolean;
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
  hidden: boolean;
  sessions: SidebarSession[];
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
  provider: SessionProvider;
  displayName?: string;
  status: SessionStatus;
  number: number;
}

export interface V2SidebarData {
  projects: V2SidebarProject[];
}

export interface V2SidebarProject {
  project: Project;
  pinned: boolean;
  workspaces: Workspace[];
  conversations: Conversation[];
  states: PiConversationSnapshot[];
}

export interface ArchiveInfo {
  filename: string;
  projectName: string;
  projectId: string;
  archivedAt: string;
  size: number;
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

export type WorkspaceKind = 'main' | 'worktree';
export type WorkspaceStatus = 'active' | 'merged' | 'abandoned' | 'archived';

export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  branchName: string;
  baseBranch?: string;
  worktreePath?: string;
  parentWorkspaceId?: string;
  origin: 'direct' | 'promoted' | 'forked';
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export type TerminalSessionStatus = 'starting' | 'running' | 'waiting_input' | 'stopped' | 'failed';

export interface TerminalSession {
  id: string;
  workspaceId: string;
  title?: string;
  status: TerminalSessionStatus;
  shell?: string;
  cwd?: string;
  providerHint?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt: string;
}

export type ConversationStatus = 'active' | 'paused' | 'completed' | 'archived';
export type ConversationSurface = 'chat' | 'terminal';

export interface Conversation {
  id: string;
  projectId: string;
  currentWorkspaceId?: string;
  parentConversationId?: string;
  provider: string;
  title: string;
  status: ConversationStatus;
  preferredSurface: ConversationSurface;
  summary?: string;
  providerSessionId?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  unreadAt?: string;
}

export interface ConversationWorkspaceLink {
  id: string;
  conversationId: string;
  workspaceId?: string;
  reason: string;
  active: boolean;
  createdAt: string;
  detachedAt?: string;
}

export interface ManagedSkill {
  name: string;
  title: string;
  description?: string;
  path: string;
  scope: string;
  target: string;
  sourcePath?: string;
  symlinked: boolean;
}

export interface SkillCatalogEntry {
  sourceId: string;
  sourceName: string;
  repoUrl: string;
  repoRef: string;
  skillPath: string;
  name: string;
  title: string;
  description?: string;
}

export interface SkillCatalogSource {
  id: string;
  name: string;
  repoUrl: string;
  repoRef: string;
  skillPrefixes: string[];
  builtIn: boolean;
}

export interface ProjectSkillsResponse {
  installed: ManagedSkill[];
  available: ManagedSkill[];
}

export interface PiAuthProvider {
  provider: string;
  type: string;
}

export interface PiCustomProviderInfo {
  id: string;
  modelCount: number;
}

export interface PiStatus {
  installed: boolean;
  version?: string;
  agentDir: string;
  authPath: string;
  modelsPath: string;
  settingsPath: string;
  authConfigured: boolean;
  authProviders?: PiAuthProvider[];
  customProviders?: PiCustomProviderInfo[];
  loadWarnings?: string[];
}

export interface PiConfigDocument {
  path: string;
  exists: boolean;
  valid: boolean;
  content: string;
  updatedAt?: string;
  parseError?: string;
}

export interface PiConfigResponse {
  status: PiStatus;
  globalSettings: PiConfigDocument;
  models: PiConfigDocument;
  projectSettings?: PiConfigDocument;
  globalPackages?: PiPackageEntry[];
  projectPackages?: PiPackageEntry[];
  globalExtensions?: PiExtensionEntry[];
  projectExtensions?: PiExtensionEntry[];
}

export interface PiPackageEntry {
  source: string;
  scope: string;
  sourceType: string;
  pinned: boolean;
  filtered: boolean;
  extensionCount: number;
  skillCount: number;
  promptCount: number;
  themeCount: number;
}

export interface PiExtensionEntry {
  path: string;
  scope: string;
}

export type HarnessToolId = 'pi' | 'codex' | 'claude';

export interface HarnessToolStatus {
  id: HarnessToolId;
  name: string;
  packageName: string;
  installed: boolean;
  binaryPath?: string;
  version?: string;
  latestVersion?: string;
  updateCommand: string;
  changelogUrl: string;
  installUrl: string;
  loadWarnings?: string[];
}

export interface HarnessAuthStatus {
  id: string;
  name: string;
  loggedIn: boolean;
  method?: string;
  detail?: string;
  providers?: string[];
  loadWarnings?: string[];
}

export interface HarnessUpdateInfo {
  running: boolean;
  tool?: HarnessToolId;
  startedAt?: string;
}

export interface HarnessStatus {
  tools: HarnessToolStatus[];
  auth: HarnessAuthStatus[];
  update?: HarnessUpdateInfo;
  checkedLatest: boolean;
  generatedAt: string;
}

export interface PiConversationModel {
  provider: string;
  id: string;
}

export interface PiConversationToolCall {
  id: string;
  name: string;
  arguments?: string;
}

export interface PiConversationImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface PiConversationMessage {
  id: string;
  entryId?: string;
  role: string;
  text?: string;
  thinking?: string;
  images?: PiConversationImageAttachment[];
  toolName?: string;
  toolCalls?: PiConversationToolCall[];
  isError?: boolean;
  timestamp?: string;
}

export interface PiStreamingAssistant {
  text?: string;
  thinking?: string;
  toolCalls?: PiConversationToolCall[];
}

export interface PiToolExecution {
  toolCallId: string;
  toolName: string;
  status: string;
  output?: string;
  isError?: boolean;
}

export interface PiConversationSnapshot {
  conversationId: string;
  runtimeActive: boolean;
  streaming: boolean;
  compacting?: boolean;
  workDir: string;
  model?: PiConversationModel;
  thinkingLevel?: PiThinkingLevel;
  steeringMode?: string;
  followUpMode?: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
  sessionFile?: string;
  sessionName?: string;
  messages: PiConversationMessage[];
  pending?: PiStreamingAssistant;
  tools?: PiToolExecution[];
  lastError?: string;
  updatedAt: string;
}

export interface PiAvailableModel {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
}

export interface PiSlashCommand {
  name: string;
  description?: string;
  source?: string;
}

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface PiConversationSessionStats {
  state: PiConversationSnapshot;
  stats: Record<string, unknown>;
}

export interface ForkConversationFromMessageResponse {
  conversation: Conversation;
  selectedText: string;
  snapshot?: PiConversationSnapshot;
}
