import { api } from './client';

export interface Recipe {
  name: string;
  description?: string;
  args?: string;
}

export interface JustfileInfo {
  hasJustfile: boolean;
  recipes: Recipe[];
}

export interface RunResult {
  exitCode: number;
  output: string;
}

export const justfileApi = {
  // List recipes for a project
  listProjectRecipes: (projectId: string) =>
    api.get<JustfileInfo>(`/projects/${projectId}/justfile`),

  // List recipes for a task (uses worktree if available)
  listTaskRecipes: (taskId: string) =>
    api.get<JustfileInfo>(`/tasks/${taskId}/justfile`),

  // Run a recipe for a project
  runProjectRecipe: (projectId: string, recipe: string, args?: string[]) =>
    api.post<RunResult>(`/projects/${projectId}/just/${recipe}`, { args }),

  // Run a recipe for a task
  runTaskRecipe: (taskId: string, recipe: string, args?: string[]) =>
    api.post<RunResult>(`/tasks/${taskId}/just/${recipe}`, { args }),

  // Get streaming URL for a recipe (SSE)
  getStreamUrl: (taskId: string, recipe: string, args?: string[]) => {
    const params = new URLSearchParams();
    args?.forEach((arg) => params.append('arg', arg));
    const queryString = params.toString();
    return `/api/tasks/${taskId}/just/${recipe}/stream${queryString ? '?' + queryString : ''}`;
  },
};
