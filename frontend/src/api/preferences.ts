import { api } from './client';

export type EditorType = 'vscode' | 'cursor';

export interface EditorConfig {
  editor: EditorType;
  sshHost: string | null;
}

export const preferencesApi = {
  get: <T>(key: string) => api.get<T>(`/preferences/${key}`),
  getConfigured: async (key: string): Promise<boolean> =>
    api.get<{ configured: boolean }>(`/preferences/${key}/configured`).then((v) => Boolean(v?.configured)),
  set: <T>(key: string, value: T) => api.put<T>(`/preferences/${key}`, value),
  delete: (key: string) => api.delete(`/preferences/${key}`),

  // Convenience helpers
  getPinnedProjects: () =>
    api.get<string[]>('/preferences/pinned_projects').catch(() => []),
  setPinnedProjects: (ids: string[]) =>
    api.put<string[]>('/preferences/pinned_projects', ids),

  getEditorConfig: async (): Promise<EditorConfig> => {
    const [editor, sshHost] = await Promise.all([
      api.get<EditorType>('/preferences/editor').catch(() => null),
      api.get<string>('/preferences/editor_ssh_host').catch(() => null),
    ]);
    return {
      editor: editor ?? 'vscode',
      sshHost: sshHost ?? null,
    };
  },
  setEditorConfig: async (config: EditorConfig): Promise<void> => {
    await api.put('/preferences/editor', config.editor);
    if (config.sshHost) {
      await api.put('/preferences/editor_ssh_host', config.sshHost);
    } else {
      await api.delete('/preferences/editor_ssh_host').catch(() => {});
    }
  },
};
