import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tree, type MoveHandler, type NodeApi, type TreeApi } from 'react-arborist';
import {
  AtSign,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  FolderInput,
  FileInput,
  Clipboard,
  Plus,
  FolderSearch,
} from 'lucide-react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useMobile } from '../../hooks/useMobile';
import type { GitStatus } from '../../api/git';
import { buildFileTree, filterFileTree } from './fileTreeUtils';
import { getFileIcon } from './fileIcons';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import type { FileTreeNodeData } from './editorUtils';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspace } from './WorkspaceContext';
import {
  WorkbenchEmpty,
  WorkbenchFrame,
  WorkbenchIconButton,
  WorkbenchSearchInput,
  WorkbenchToolbar,
} from './WorkspaceWorkbench';

interface ContextMenuState {
  position: { x: number; y: number };
  node: FileTreeNodeData | null; // null = empty space
}

// Temporary node used for inline file/folder creation
const CREATING_NODE_ID = '__creating__';
const FILE_TREE_ROW_HEIGHT = 26;

type DiffTone = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

const diffTonePriority: Record<DiffTone, number> = {
  added: 1,
  copied: 2,
  renamed: 3,
  modified: 4,
  deleted: 5,
};

const diffToneClassName: Record<DiffTone, string> = {
  added: 'text-green-500',
  copied: 'text-purple-400',
  renamed: 'text-blue-400',
  modified: 'text-yellow-500',
  deleted: 'text-red-500',
};

export function FileExplorer() {
  const isMobile = useMobile();
  const {
    files,
    createEntry,
    deleteEntry,
    renameEntry,
    duplicateEntry,
    downloadFile,
    isLoading,
  } = useWorkspaceFiles(undefined, 20);
  const { api, scopeType, scopeId, conversationDraft } = useWorkspace();
  const { openFile } = useWorkspaceNav();
  const activeEditorPath = useWorkspaceStore((state) => {
    const activeTab = state.tabs[state.activeTabIndex];
    return activeTab?.type === 'editor' ? activeTab.path : null;
  });
  const activeEditorTabIndex = useWorkspaceStore((state) => {
    const activeTab = state.tabs[state.activeTabIndex];
    return activeTab?.type === 'editor' ? state.activeTabIndex : -1;
  });
  const revealFileRequest = useWorkspaceStore((state) => state.revealFileRequest);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const { data: gitStatus } = useQuery({
    queryKey: ['workspace-git-status', scopeType, scopeId],
    queryFn: () => api.git.status(),
    refetchInterval: 5000,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [createMenuPosition, setCreateMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(400);
  const treeRef = useRef<TreeApi<FileTreeNodeData> | null>(null);
  const suppressSelectRef = useRef(false);

  // Inline creation state
  const [creating, setCreating] = useState<{ type: 'file' | 'dir'; parentPath: string } | null>(null);
  const [createName, setCreateName] = useState('');

  // Measure container height with ResizeObserver so react-arborist gets the right size
  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setTreeHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tree = useMemo(() => buildFileTree(files), [files]);
  const filtered = useMemo(() => filterFileTree(tree, searchQuery), [tree, searchQuery]);
  const diffToneByPath = useMemo(() => buildDiffToneMap(gitStatus), [gitStatus]);

  // Insert a temporary "creating" node into the tree data when creating
  const treeData = useMemo(() => {
    if (!creating) return filtered;

    const tempNode: FileTreeNodeData = {
      id: CREATING_NODE_ID,
      name: '',
      path: CREATING_NODE_ID,
      type: creating.type,
      children: creating.type === 'dir' ? [] : undefined,
    };

    if (!creating.parentPath) {
      // Insert at root
      return [tempNode, ...filtered];
    }

    // Insert as first child of the target folder
    const insertInto = (nodes: FileTreeNodeData[]): FileTreeNodeData[] => {
      return nodes.map((node) => {
        if (node.path === creating.parentPath && node.type === 'dir') {
          return { ...node, children: [tempNode, ...(node.children || [])] };
        }
        if (node.children) {
          return { ...node, children: insertInto(node.children) };
        }
        return node;
      });
    };

    return insertInto(filtered);
  }, [filtered, creating]);

  const handleSelect = useCallback(
    (nodes: NodeApi<FileTreeNodeData>[]) => {
      if (suppressSelectRef.current) return;
      const node = nodes[0];
      if (!node || node.data.type === 'dir') return;
      if (node.data.id === CREATING_NODE_ID) return;
      if (node.data.path === activeEditorPath && activeEditorTabIndex >= 0) {
        closeTab(activeEditorTabIndex);
        return;
      }
      openFile(node.data.path);
    },
    [activeEditorPath, activeEditorTabIndex, closeTab, openFile],
  );

  // Get the target folder for inline creation based on current selection
  const getTargetFolder = useCallback(() => {
    const tree = treeRef.current;
    if (!tree) return '';
    const selected = tree.selectedNodes?.[0];
    if (!selected) return '';
    if (selected.data.type === 'dir') return selected.data.path;
    // Parent of file
    const path = selected.data.path;
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(0, lastSlash) : '';
  }, []);

  const startCreating = useCallback(
    (type: 'file' | 'dir', parentPath?: string) => {
      const target = parentPath ?? getTargetFolder();
      setCreating({ type, parentPath: target });
      setCreateName('');
      // Expand the target folder in the tree
      if (target && treeRef.current) {
        const node = treeRef.current.get(target);
        if (node && !node.isOpen) node.open();
      }
    },
    [getTargetFolder],
  );

  const handleCreateSubmit = useCallback(async () => {
    if (!creating || !createName.trim()) {
      setCreating(null);
      return;
    }
    const path = creating.parentPath
      ? `${creating.parentPath}/${createName.trim()}`
      : createName.trim();
    await createEntry({ path, type: creating.type });
    setCreating(null);
    setCreateName('');
  }, [creating, createName, createEntry]);

  const handleDelete = useCallback(
    async (path: string) => {
      if (!confirm(`Delete "${path}"?`)) return;
      await deleteEntry(path);
    },
    [deleteEntry],
  );

  const handleRenameSubmit = useCallback(
    async (oldPath: string) => {
      const newName = renameValue.trim();
      if (!newName || !renamingPath) {
        setRenamingPath(null);
        return;
      }
      const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
      const newPath = dir ? `${dir}/${newName}` : newName;
      if (newPath === oldPath) {
        setRenamingPath(null);
        return;
      }
      try {
        await renameEntry({ from: oldPath, to: newPath });
      } catch {
        // silently ignore — API already surfaces errors
      }
      setRenamingPath(null);
    },
    [renameValue, renamingPath, renameEntry],
  );

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);
  const canMentionInConversation = conversationDraft?.enabled === true;
  const handleMentionReference = useCallback((node: FileTreeNodeData) => {
    const referencePath = node.type === 'dir' ? `${node.path}/` : node.path;
    conversationDraft?.insertReference(referencePath);
  }, [conversationDraft]);

  // Drag-and-drop: move files/folders between directories
  const handleMove = useCallback<MoveHandler<FileTreeNodeData>>(
    async ({ dragIds, parentId }) => {
      for (const dragId of dragIds) {
        if (dragId === CREATING_NODE_ID) continue;
        const fileName = dragId.includes('/') ? dragId.slice(dragId.lastIndexOf('/') + 1) : dragId;
        const newPath = parentId ? `${parentId}/${fileName}` : fileName;
        if (newPath === dragId) continue;
        try {
          await renameEntry({ from: dragId, to: newPath });
        } catch {
          // silently ignore
        }
      }
    },
    [renameEntry],
  );

  const openContextMenu = useCallback(
    (e: React.MouseEvent, node: FileTreeNodeData | null) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, node });
    },
    [],
  );

  const openCreateMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCreateMenuPosition({ x: rect.right, y: rect.bottom + 6 });
  }, []);

  const getContextMenuItems = useCallback(
    (node: FileTreeNodeData | null): ContextMenuItem[] => {
      // Empty space context menu
      if (!node) {
        return [
          {
            label: 'New File',
            icon: FilePlus2,
            onClick: () => startCreating('file', ''),
          },
          {
            label: 'New Folder',
            icon: FolderPlus,
            onClick: () => startCreating('dir', ''),
          },
        ];
      }

      if (node.type === 'dir') {
        return [
          {
            label: 'New File',
            icon: FileInput,
            onClick: () => startCreating('file', node.path),
          },
          {
            label: 'New Folder',
            icon: FolderInput,
            onClick: () => startCreating('dir', node.path),
          },
          {
            label: 'Rename',
            icon: Pencil,
            onClick: () => {
              setRenamingPath(node.path);
              setRenameValue(node.name);
            },
          },
          {
            label: 'Copy Path',
            icon: Clipboard,
            onClick: () => handleCopyPath(node.path),
          },
          ...(canMentionInConversation ? [{
            label: 'Mention in Chat',
            description: `@${node.path}/`,
            icon: AtSign,
            onClick: () => handleMentionReference(node),
          }] : []),
          { label: '', onClick: () => {}, divider: true },
          {
            label: 'Delete',
            icon: Trash2,
            danger: true,
            onClick: () => handleDelete(node.path),
          },
        ];
      }

      // File context menu
      return [
        {
          label: 'Open',
          icon: FilePlus2,
          onClick: () => openFile(node.path),
        },
        {
          label: 'Rename',
          icon: Pencil,
          onClick: () => {
            setRenamingPath(node.path);
            setRenameValue(node.name);
          },
        },
        {
          label: 'Duplicate',
          icon: Copy,
          onClick: () => duplicateEntry(node.path),
        },
        {
          label: 'Download',
          icon: Download,
          onClick: () => downloadFile(node.path),
        },
        {
          label: 'Copy Path',
          icon: Clipboard,
          onClick: () => handleCopyPath(node.path),
        },
        ...(canMentionInConversation ? [{
          label: 'Mention in Chat',
          description: `@${node.path}`,
          icon: AtSign,
          onClick: () => handleMentionReference(node),
        }] : []),
        { label: '', onClick: () => {}, divider: true },
        {
          label: 'Delete',
          icon: Trash2,
          danger: true,
          onClick: () => handleDelete(node.path),
        },
      ];
    },
    [canMentionInConversation, openFile, handleDelete, duplicateEntry, downloadFile, handleCopyPath, handleMentionReference, startCreating],
  );

  const createMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: 'New File',
        icon: FilePlus2,
        onClick: () => startCreating('file'),
      },
      {
        label: 'New Folder',
        icon: FolderPlus,
        onClick: () => startCreating('dir'),
      },
    ],
    [startCreating],
  );

  // Close context menu on route changes
  useEffect(() => {
    const timer = setTimeout(() => setContextMenu(null), 0);
    return () => clearTimeout(timer);
  }, [files]);

  // Keep tree highlight synced with the active editor tab and auto-expand to it.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;

    suppressSelectRef.current = true;
    if (!activeEditorPath) {
      tree.deselectAll();
      queueMicrotask(() => {
        suppressSelectRef.current = false;
      });
      return;
    }

    tree.select(activeEditorPath, { focus: false });
    queueMicrotask(() => {
      suppressSelectRef.current = false;
    });
  }, [activeEditorPath, treeData]);

  useEffect(() => {
    const requestedPath = revealFileRequest?.path.replace(/\/+$/, '');
    if (!requestedPath) return;
    setSearchQuery('');
    requestAnimationFrame(() => {
      const tree = treeRef.current;
      const node = tree?.get(requestedPath);
      if (!tree || !node) return;

      suppressSelectRef.current = true;
      for (const ancestorPath of ancestorPaths(requestedPath)) {
        const ancestor = tree.get(ancestorPath);
        if (ancestor?.data.type === 'dir' && !ancestor.isOpen) ancestor.open();
      }
      if (node.data.type === 'dir' && !node.isOpen) node.open();
      tree.select(requestedPath, { focus: false });
      requestAnimationFrame(() => {
        void tree.scrollTo(requestedPath, 'center');
        queueMicrotask(() => {
          suppressSelectRef.current = false;
        });
      });
    });
  }, [revealFileRequest, treeData]);

  return (
    <WorkbenchFrame>
      <WorkbenchToolbar className="flex items-center gap-1.5" onSubmit={(event) => event.preventDefault()}>
        <WorkbenchSearchInput
          icon={<Search size={13} />}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter files"
        />
        <WorkbenchIconButton label="Create file or folder" onClick={openCreateMenu}>
          <Plus size={15} />
        </WorkbenchIconButton>
      </WorkbenchToolbar>

      {/* File tree */}
      <div
        ref={treeContainerRef}
        className="min-h-0 flex-1 overflow-auto px-1 pb-2"
        onContextMenu={(e) => openContextMenu(e, null)}
      >
        {isLoading ? (
          <WorkbenchEmpty compact icon={<FolderSearch size={18} />} title="Loading files" />
        ) : treeData.length === 0 ? (
          <WorkbenchEmpty
            compact
            icon={<FolderSearch size={18} />}
            title={searchQuery.trim() ? 'No matching files' : 'No files yet'}
            body={searchQuery.trim() ? 'Try a different filter.' : 'Create a file or folder from the plus menu.'}
          />
        ) : (
          <Tree<FileTreeNodeData>
            ref={treeRef}
            data={treeData}
            openByDefault={false}
            width={undefined as unknown as number}
            height={treeHeight}
	            rowHeight={isMobile ? 38 : FILE_TREE_ROW_HEIGHT}
            indent={16}
            onSelect={handleSelect}
            onMove={handleMove}
            disableDrag={(data) => data.id === CREATING_NODE_ID}
            disableDrop={(args) => {
              // Only allow dropping into folders
              const parent = args.parentNode;
              if (!parent) return false; // root is ok
              return parent.data.type !== 'dir';
            }}
          >
            {({ node, style, dragHandle }) => {
              const isCreatingNode = node.data.id === CREATING_NODE_ID;
              const isDir = node.data.type === 'dir';
              const isRenaming = renamingPath === node.data.path;
              const iconInfo = isDir ? null : getFileIcon(node.data.name);
              const Icon = iconInfo?.icon;
              const diffTone = diffToneByPath.get(node.data.path);
              const diffClassName = diffTone ? diffToneClassName[diffTone] : '';
              const nameClassName = diffClassName || (node.isSelected ? 'text-accent' : 'text-[var(--color-text-primary)]');
              const folderIconClassName = diffClassName || (node.isOpen ? 'text-accent' : 'text-dim');

              // Inline creation node
              if (isCreatingNode) {
                return (
                  <div style={{ ...style, width: 'calc(100% - 8px)' }} className="mx-1 flex h-full items-center gap-1 rounded-md px-1.5 pr-2 text-sm md:text-xs">
                    {isDir ? (
                      <FolderPlus size={14} className="text-accent shrink-0 ml-3.5" />
                    ) : (
                      <FilePlus2 size={14} className="text-accent shrink-0 ml-3.5" />
                    )}
                    <input
                      type="text"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => {
                        // Keep typing isolated from tree-level keyboard shortcuts/typeahead.
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateSubmit();
                        }
                        if (e.key === 'Escape') {
                          setCreating(null);
                        }
                      }}
                      onBlur={() => {
                        if (createName.trim()) {
                          handleCreateSubmit();
                        } else {
                          setCreating(null);
                        }
                      }}
                      ref={(el) => {
                        if (!el) return;
                        el.focus();
                        // Reset horizontal scroll after browser auto-scrolls to input
                        requestAnimationFrame(() => {
                          treeContainerRef.current?.scrollTo({ left: 0 });
                        });
                      }}
                      placeholder={creating?.type === 'dir' ? 'folder name' : 'file name'}
                      className="min-w-0 flex-1 rounded-sm bg-primary px-1 py-0 text-xs shadow-[inset_0_0_0_1px_var(--color-accent)] outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              }

              return (
                <div
                  ref={dragHandle}
                  style={{ ...style, width: 'calc(100% - 8px)' }}
	                  className={`group mx-1 flex h-full cursor-pointer items-center gap-1 rounded-md px-1.5 pr-2 text-sm transition-colors md:text-xs ${
                    node.isSelected
                      ? 'bg-[var(--color-card-hover)]'
                      : 'hover:bg-[var(--color-card)]'
                  }`}
                  onClick={() => (isDir ? node.toggle() : node.select())}
                  onContextMenu={(e) => openContextMenu(e, node.data)}
                  title={diffTone ? `${node.data.path} (${diffTone})` : node.data.path}
                >
                  {/* Chevron for directories, spacer for files */}
                  {isDir ? (
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-dim transition-transform duration-150 ${
                        node.isOpen ? 'rotate-90' : ''
                      }`}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}

                  {/* Icon */}
                  {isDir ? (
                    node.isOpen ? (
                      <FolderOpen size={14} className={`${folderIconClassName} shrink-0`} />
                    ) : (
                      <Folder size={14} className={`${folderIconClassName} shrink-0`} />
                    )
                  ) : (
                    Icon && <Icon size={14} className={`shrink-0 ${iconInfo.className}`} />
                  )}

                  {/* Name or rename input */}
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        // Keep typing isolated from tree-level keyboard shortcuts/typeahead.
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleRenameSubmit(node.data.path);
                        }
                        if (e.key === 'Escape') {
                          setRenamingPath(null);
                        }
                      }}
                      onBlur={() => handleRenameSubmit(node.data.path)}
                      ref={(el) => {
                        if (!el) return;
                        el.focus();
                        requestAnimationFrame(() => {
                          treeContainerRef.current?.scrollTo({ left: 0 });
                        });
                      }}
                      className="min-w-0 flex-1 rounded-sm bg-primary px-1 py-0 text-xs shadow-[inset_0_0_0_1px_var(--color-accent)] outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`truncate flex-1 ${nameClassName}`}>{node.data.name}</span>
                  )}
                </div>
              );
            }}
          </Tree>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems(contextMenu.node)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
      {createMenuPosition && (
        <ContextMenu
          items={createMenuItems}
          position={createMenuPosition}
          onClose={() => setCreateMenuPosition(null)}
        />
      )}
    </WorkbenchFrame>
  );
}

function buildDiffToneMap(status?: GitStatus): Map<string, DiffTone> {
  const tones = new Map<string, DiffTone>();
  if (!status) return tones;

  for (const path of status.untracked) {
    markPathAndAncestors(tones, path, 'added');
  }

  for (const file of [...status.staged, ...status.unstaged]) {
    markPathAndAncestors(tones, file.path, toneForGitStatus(file.status));
  }

  return tones;
}

function toneForGitStatus(status: string): DiffTone {
  if (status.includes('D')) return 'deleted';
  if (status.includes('R')) return 'renamed';
  if (status.includes('C')) return 'copied';
  if (status.includes('A') || status.includes('?')) return 'added';
  return 'modified';
}

function markPathAndAncestors(tones: Map<string, DiffTone>, path: string, tone: DiffTone) {
  let current = path;
  while (current) {
    const existing = tones.get(current);
    if (!existing || diffTonePriority[tone] > diffTonePriority[existing]) {
      tones.set(current, tone);
    }

    const parentSlash = current.lastIndexOf('/');
    if (parentSlash < 0) break;
    current = current.slice(0, parentSlash);
  }
}

function ancestorPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'));
}
