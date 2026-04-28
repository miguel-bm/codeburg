import { createContext, useContext, useMemo } from 'react';
import type { Project, Task, Workspace } from '../../api/types';
import type { WorkspaceScopeType } from '../../api/workspace';
import {
  createSessionsApi,
  createGitApi,
  createFilesApi,
  createTunnelsApi,
  createRecipesApi,
} from '../../api/workspace';

export type WorkspaceScope =
  | { type: 'project'; projectId: string; project: Project }
  | { type: 'task'; taskId: string; task: Task; project: Project }
  | { type: 'workspace'; workspaceId: string; workspace: Workspace; project: Project };

export interface WorkspaceContextValue {
  scope: WorkspaceScope;
  projectId: string;
  project: Project;
  taskId: string | null;
  task: Task | null;
  scopeType: WorkspaceScopeType;
  scopeId: string;
  api: {
    sessions: ReturnType<typeof createSessionsApi>;
    git: ReturnType<typeof createGitApi>;
    files: ReturnType<typeof createFilesApi>;
    tunnels: ReturnType<typeof createTunnelsApi>;
    recipes: ReturnType<typeof createRecipesApi>;
  };
  conversationDraft: WorkspaceConversationDraft | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export interface WorkspaceConversationDraft {
  enabled: boolean;
  insertReference: (path: string) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}

interface WorkspaceProviderProps {
  scope: WorkspaceScope;
  conversationDraft?: WorkspaceConversationDraft | null;
  children: React.ReactNode;
}

export function WorkspaceProvider({ scope, conversationDraft = null, children }: WorkspaceProviderProps) {
  const scopeType: WorkspaceScopeType =
    scope.type === 'project' ? 'project' : scope.type === 'task' ? 'task' : 'workspace';
  const scopeId =
    scope.type === 'project' ? scope.projectId : scope.type === 'task' ? scope.taskId : scope.workspaceId;
  const project = scope.project;
  const projectId =
    scope.type === 'project' ? scope.projectId : scope.type === 'task' ? scope.task.projectId : scope.workspace.projectId;
  const taskId = scope.type === 'task' ? scope.taskId : null;
  const task = scope.type === 'task' ? scope.task : null;
  const workspace = scope.type === 'workspace' ? scope.workspace : null;
  const stableScope = useMemo<WorkspaceScope>(() => {
    if (scopeType === 'project') return { type: 'project', projectId: scopeId, project };
    if (scopeType === 'task') return { type: 'task', taskId: scopeId, task: task!, project };
    return { type: 'workspace', workspaceId: scopeId, workspace: workspace!, project };
  }, [project, scopeId, scopeType, task, workspace]);
  const api = useMemo(() => ({
    sessions: createSessionsApi(scopeType, scopeId),
    git: createGitApi(scopeType, scopeId),
    files: createFilesApi(scopeType, scopeId),
    tunnels: createTunnelsApi(scopeType, scopeId),
    recipes: createRecipesApi(scopeType, scopeId),
  }), [scopeId, scopeType]);

  const value = useMemo<WorkspaceContextValue>(() => {
    return {
      scope: stableScope,
      projectId,
      project,
      taskId,
      task,
      scopeType,
      scopeId,
      api,
      conversationDraft,
    };
  }, [api, conversationDraft, project, projectId, scopeId, scopeType, stableScope, task, taskId]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
