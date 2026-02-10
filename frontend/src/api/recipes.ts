import { api } from './client';

export interface TaskRecipe {
  name: string;
  command: string;
  source: string;
  description?: string;
}

export interface TaskRecipesInfo {
  recipes: TaskRecipe[];
  sources: string[];
}

export const recipesApi = {
  listTaskRecipes: (taskId: string) =>
    api.get<TaskRecipesInfo>(`/tasks/${taskId}/recipes`),
};
