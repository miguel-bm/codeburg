import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type MoveHandler, type NodeApi, type TreeApi } from 'react-arborist';
import {
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
} from 'lucide-react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { buildFileTree, filterFileTree } from './fileTreeUtils';
import { getFileIcon } from './fileIcons';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import type { FileTreeNodeData } from './editorUtils';

interface ContextMenuState {
  position: { x: number; y: number };
  node: FileTreeNodeData | null; // null = empty space
}

// Temporary node used for inline file/folder creation
const CREATING_NODE_ID = '__creating__';

export function FileExplorer() {
  const {
    files,
    createEntry,
    deleteEntry,
    renameEntry,
    duplicateEntry,
    downloadFile,
    isLoading,
  } = useWorkspaceFiles(undefined, 20);
  const { openFile } = useWorkspaceNav();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(400);
  const treeRef = useRef<TreeApi<FileTreeNodeData> | null>(null);

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
      const node = nodes[0];
      if (!node || node.data.type === 'dir') return;
      if (node.data.id === CREATING_NODE_ID) return;
      openFile(node.data.path);
    },
    [openFile],
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
        { label: '', onClick: () => {}, divider: true },
        {
          label: 'Delete',
          icon: Trash2,
          danger: true,
          onClick: () => handleDelete(node.path),
        },
      ];
    },
    [openFile, handleDelete, duplicateEntry, downloadFile, handleCopyPath, startCreating],
  );

  // Close context menu on route changes
  useEffect(() => {
    const timer = setTimeout(() => setContextMenu(null), 0);
    return () => clearTimeout(timer);
  }, [files]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search + actions */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-subtle">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-primary border border-subtle rounded-md focus:border-accent focus:outline-none"
          />
        </div>
        <button
          onClick={() => startCreating('file')}
          className="p-1 text-dim hover:text-accent transition-colors"
          title="New file"
        >
          <FilePlus2 size={14} />
        </button>
        <button
          onClick={() => startCreating('dir')}
          className="p-1 text-dim hover:text-accent transition-colors"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* File tree */}
      <div
        ref={treeContainerRef}
        className="flex-1 overflow-auto pl-1"
        onContextMenu={(e) => openContextMenu(e, null)}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-20 text-xs text-dim">Loading...</div>
        ) : (
          <Tree<FileTreeNodeData>
            ref={treeRef}
            data={treeData}
            openByDefault={false}
            width={undefined as unknown as number}
            height={treeHeight}
            rowHeight={26}
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

              // Inline creation node
              if (isCreatingNode) {
                return (
                  <div style={style} className="flex items-center gap-1 pr-2 text-xs">
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
                      placeholder={creating?.type === 'dir' ? 'folder name...' : 'file name...'}
                      className="flex-1 min-w-0 px-1 py-0 text-xs bg-primary border border-accent rounded-sm focus:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              }

              return (
                <div
                  ref={dragHandle}
                  style={style}
                  className={`flex items-center gap-1 pr-2 text-xs cursor-pointer group transition-colors rounded-sm ${
                    node.isSelected
                      ? 'bg-accent/10 text-accent'
                      : 'hover:bg-tertiary'
                  }`}
                  onClick={() => (isDir ? node.toggle() : node.select())}
                  onContextMenu={(e) => openContextMenu(e, node.data)}
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
                      <FolderOpen size={14} className="text-accent shrink-0" />
                    ) : (
                      <Folder size={14} className="text-dim shrink-0" />
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
                      className="flex-1 min-w-0 px-1 py-0 text-xs bg-primary border border-accent rounded-sm focus:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate flex-1">{node.data.name}</span>
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
    </div>
  );
}
