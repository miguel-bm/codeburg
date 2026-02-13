import { createContext, useContext, useMemo } from 'react';
import type { Project, Task } from '../../api/types';
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
  | { type: 'task'; taskId: string; task: Task; project: Project };

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
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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
  children: React.ReactNode;
}

export function WorkspaceProvider({ scope, children }: WorkspaceProviderProps) {
  const value = useMemo<WorkspaceContextValue>(() => {
    const scopeType: WorkspaceScopeType = scope.type === 'project' ? 'project' : 'task';
    const scopeId = scope.type === 'project' ? scope.projectId : scope.taskId;
    const project = scope.project;
    const projectId = scope.type === 'project' ? scope.projectId : scope.task.projectId;

    return {
      scope,
      projectId,
      project,
      taskId: scope.type === 'task' ? scope.taskId : null,
      task: scope.type === 'task' ? scope.task : null,
      scopeType,
      scopeId,
      api: {
        sessions: createSessionsApi(scopeType, scopeId),
        git: createGitApi(scopeType, scopeId),
        files: createFilesApi(scopeType, scopeId),
        tunnels: createTunnelsApi(scopeType, scopeId),
        recipes: createRecipesApi(scopeType, scopeId),
      },
    };
  }, [scope]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
