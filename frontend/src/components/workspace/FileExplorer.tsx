import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps } from 'react-arborist';
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
import { useWorkspaceStore } from '../../stores/workspace';
import { buildFileTree, filterFileTree } from './fileTreeUtils';
import { getFileIcon } from './fileIcons';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import type { FileTreeNodeData } from './editorUtils';

interface ContextMenuState {
  position: { x: number; y: number };
  node: FileTreeNodeData | null; // null = empty space
}

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
  const { openFile } = useWorkspaceStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateInput, setShowCreateInput] = useState<'file' | 'dir' | null>(null);
  const [createPath, setCreatePath] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(400);

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

  const handleSelect = useCallback(
    (nodes: NodeRendererProps<FileTreeNodeData>['node'][]) => {
      const node = nodes[0];
      if (!node || node.data.type === 'dir') return;
      openFile(node.data.path);
    },
    [openFile],
  );

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!createPath.trim() || !showCreateInput) return;
      await createEntry({ path: createPath.trim(), type: showCreateInput });
      setCreatePath('');
      setShowCreateInput(null);
    },
    [createPath, showCreateInput, createEntry],
  );

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
            onClick: () => { setShowCreateInput('file'); setCreatePath(''); },
          },
          {
            label: 'New Folder',
            icon: FolderPlus,
            onClick: () => { setShowCreateInput('dir'); setCreatePath(''); },
          },
        ];
      }

      if (node.type === 'dir') {
        return [
          {
            label: 'New File',
            icon: FileInput,
            onClick: () => { setShowCreateInput('file'); setCreatePath(node.path + '/'); },
          },
          {
            label: 'New Folder',
            icon: FolderInput,
            onClick: () => { setShowCreateInput('dir'); setCreatePath(node.path + '/'); },
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
    [openFile, handleDelete, duplicateEntry, downloadFile, handleCopyPath],
  );

  // Close context menu on route changes
  useEffect(() => {
    setContextMenu(null);
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
          onClick={() => { setShowCreateInput('file'); setCreatePath(''); }}
          className="p-1 text-dim hover:text-accent transition-colors"
          title="New file"
        >
          <FilePlus2 size={14} />
        </button>
        <button
          onClick={() => { setShowCreateInput('dir'); setCreatePath(''); }}
          className="p-1 text-dim hover:text-accent transition-colors"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* Create input */}
      {showCreateInput && (
        <form onSubmit={handleCreate} className="flex items-center gap-1 px-2 py-1.5 border-b border-subtle bg-accent/5">
          <input
            type="text"
            value={createPath}
            onChange={(e) => setCreatePath(e.target.value)}
            placeholder={`New ${showCreateInput} path...`}
            autoFocus
            className="flex-1 px-2 py-1 text-xs bg-primary border border-subtle rounded-md focus:border-accent focus:outline-none"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateInput(null); }}
          />
          <button type="submit" className="text-xs text-accent px-2 py-1 hover:bg-accent/10 rounded">
            Create
          </button>
          <button type="button" onClick={() => setShowCreateInput(null)} className="text-xs text-dim px-1 py-1 hover:text-[var(--color-error)]">
            Cancel
          </button>
        </form>
      )}

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
            data={filtered}
            openByDefault={false}
            width={undefined as unknown as number}
            height={treeHeight}
            rowHeight={26}
            indent={16}
            onSelect={(nodes) => handleSelect(nodes as any)}
          >
            {({ node, style }) => {
              const isDir = node.data.type === 'dir';
              const isRenaming = renamingPath === node.data.path;
              const iconInfo = isDir ? null : getFileIcon(node.data.name);
              const Icon = iconInfo?.icon;

              return (
                <div
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
                      autoFocus
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
