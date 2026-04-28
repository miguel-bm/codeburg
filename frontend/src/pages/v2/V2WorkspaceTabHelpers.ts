import { fileName } from '../../components/workspace/editorUtils';
import type { WorkspaceTab } from '../../stores/workspace';

export type PreviewWorkspaceTab = Extract<WorkspaceTab, { type: 'editor' | 'diff' }>;

export function workspacePreviewTabKey(tab: PreviewWorkspaceTab, index: number) {
  if (tab.type === 'editor') return `editor:${tab.path}:${index}`;
  return `diff:${tab.file ?? 'all'}:${tab.staged}:${tab.base}:${tab.commit ?? 'none'}:${index}`;
}

export function workspacePreviewTabLabel(tab: PreviewWorkspaceTab) {
  if (tab.type === 'editor') return fileName(tab.path);
  if (tab.file) return fileName(tab.file);
  if (tab.commit) return tab.commit.slice(0, 7);
  return 'All changes';
}
