import type { FileEntry } from '../../api/workspace';
import type { FileTreeNodeData } from './editorUtils';

export function buildFileTree(entries: FileEntry[]): FileTreeNodeData[] {
  const root: FileTreeNodeData[] = [];
  const byPath = new Map<string, FileTreeNodeData>();

  for (const entry of entries) {
    const node: FileTreeNodeData = {
      id: entry.path,
      name: entry.name,
      path: entry.path,
      type: entry.type,
      children: entry.type === 'dir' ? [] : undefined,
    };
    byPath.set(entry.path, node);
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    if (!parent) {
      root.push(node);
      continue;
    }
    const parentNode = byPath.get(parent);
    if (parentNode?.children) {
      parentNode.children.push(node);
    } else {
      root.push(node);
    }
  }

  const sortNodes = (nodes: FileTreeNodeData[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children?.length) sortNodes(node.children);
    }
  };

  sortNodes(root);
  return root;
}

export function filterFileTree(nodes: FileTreeNodeData[], query: string): FileTreeNodeData[] {
  if (!query) return nodes;

  const lowerQuery = query.toLowerCase();
  const visit = (node: FileTreeNodeData): FileTreeNodeData | null => {
    const matches = node.name.toLowerCase().includes(lowerQuery) || node.path.toLowerCase().includes(lowerQuery);
    if (node.type === 'file') {
      return matches ? node : null;
    }
    const filteredChildren = (node.children ?? [])
      .map(visit)
      .filter((child): child is FileTreeNodeData => child !== null);

    if (matches || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };

  return nodes.map(visit).filter((node): node is FileTreeNodeData => node !== null);
}
