import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { langs } from '@uiw/codemirror-extensions-langs';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  FileText,
  FilePlus2,
  Folder,
  FolderPlus,
  Funnel,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Settings,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { OpenInEditorButton } from '../components/common/OpenInEditorButton';
import { projectsApi } from '../api';
import type {
  ProjectFileContentResponse,
  ProjectFileEntry,
  ProjectSecretFile,
  ProjectSecretResolveResult,
  ProjectSecretFileStatus,
} from '../api';
import { useMobile } from '../hooks/useMobile';

type MobilePanel = 'files' | 'preview' | 'secrets';

function normalizeSecretRows(rows: ProjectSecretFile[]): ProjectSecretFile[] {
  return rows.map((row) => ({
    path: row.path,
    mode: row.mode || 'copy',
    sourcePath: row.sourcePath || undefined,
    enabled: row.enabled ?? true,
  }));
}

type FileTreeNodeData = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNodeData[];
};

const languageByExt: Record<string, () => Extension> = {
  c: () => langs.c(),
  cpp: () => langs.cpp(),
  css: () => langs.css(),
  go: () => langs.go(),
  h: () => langs.cpp(),
  html: () => langs.html(),
  java: () => langs.java(),
  js: () => langs.js(),
  jsx: () => langs.jsx(),
  json: () => langs.json(),
  md: () => langs.markdown(),
  py: () => langs.py(),
  rs: () => langs.rs(),
  sh: () => langs.sh(),
  sql: () => langs.sql(),
  ts: () => langs.ts(),
  tsx: () => langs.tsx(),
  xml: () => langs.xml(),
  yaml: () => langs.yaml(),
  yml: () => langs.yaml(),
};

function buildFileTree(entries: ProjectFileEntry[]): FileTreeNodeData[] {
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

function fileExt(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0 || idx === path.length - 1) return '';
  return path.slice(idx + 1).toLowerCase();
}

function getLanguageExtension(path: string): Extension[] {
  const ext = fileExt(path);
  const factory = languageByExt[ext];
  return factory ? [factory()] : [];
}

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function filterFileTree(nodes: FileTreeNodeData[], query: string): FileTreeNodeData[] {
  if (!query) return nodes;

  const visit = (node: FileTreeNodeData): FileTreeNodeData | null => {
    const matches = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);
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

export function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('files');
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [draftByPath, setDraftByPath] = useState<Record<string, string>>({});
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(420);

  const [secretRows, setSecretRows] = useState<ProjectSecretFile[]>([]);
  const [secretsDirty, setSecretsDirty] = useState(false);
  const [selectedSecretIndex, setSelectedSecretIndex] = useState(0);
  const [resolveOverrides, setResolveOverrides] = useState<Record<string, ProjectSecretResolveResult>>({});
  const [secretEditorPath, setSecretEditorPath] = useState<string | null>(null);
  const [secretEditorContent, setSecretEditorContent] = useState('');
  const [secretEditorLoading, setSecretEditorLoading] = useState(false);
  const [secretEditorSaving, setSecretEditorSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [leftPanelPct, setLeftPanelPct] = useState(30);
  const [previewPanelPct, setPreviewPanelPct] = useState(58);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: fileTree, isLoading: filesLoading } = useQuery({
    queryKey: ['project-files', id],
    queryFn: () => projectsApi.listFiles(id!, { depth: 32 }),
    enabled: !!id,
  });

  const { data: activeFileResponse, isLoading: fileLoading } = useQuery({
    queryKey: ['project-file', id, activeTab],
    queryFn: () => projectsApi.readFile(id!, activeTab!),
    enabled: !!id && !!activeTab,
  });

  const { data: secretsData, isLoading: secretsLoading } = useQuery({
    queryKey: ['project-secrets', id],
    queryFn: () => projectsApi.getSecrets(id!),
    enabled: !!id,
  });

  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const measure = () => {
      setTreeHeight(Math.max(220, Math.floor(el.clientHeight)));
    };
    const obs = new ResizeObserver(() => measure());
    measure();
    const frame = requestAnimationFrame(measure);
    obs.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeTab || !activeFileResponse || activeFileResponse.binary) return;
    setDraftByPath((prev) => (
      prev[activeTab] === undefined
        ? { ...prev, [activeTab]: activeFileResponse.content }
        : prev
    ));
  }, [activeTab, activeFileResponse]);

  const fileEntries = fileTree?.entries ?? [];
  const fileEntryByPath = useMemo(
    () => new Map(fileEntries.map((entry) => [entry.path, entry])),
    [fileEntries],
  );
  const normalizedFileSearch = fileSearch.trim().toLowerCase();
  const treeData = useMemo(() => buildFileTree(fileEntries), [fileEntries]);
  const filteredTreeData = useMemo(
    () => filterFileTree(treeData, normalizedFileSearch),
    [treeData, normalizedFileSearch],
  );
  const activeFileData = activeTab
    ? queryClient.getQueryData<ProjectFileContentResponse>(['project-file', id, activeTab]) ?? activeFileResponse
    : undefined;
  const activeDraft = activeTab
    ? (draftByPath[activeTab] ?? activeFileData?.content ?? '')
    : '';
  const activeDirty = !!(activeTab && dirtyByPath[activeTab]);
  const selectedEntry = treeSelection ? fileEntryByPath.get(treeSelection) : undefined;

  useEffect(() => {
    const available = new Set(fileEntries.filter((entry) => entry.type === 'file').map((entry) => entry.path));
    setOpenTabs((prev) => {
      const next = prev.filter((path) => available.has(path));
      if (next.length === prev.length) return prev;
      if (activeTab && !available.has(activeTab)) {
        setActiveTab(next[0] ?? null);
      }
      return next;
    });
  }, [activeTab, fileEntries]);

  const openFileTab = useCallback((path: string) => {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setTreeSelection(path);
    setActiveTab(path);
    if (isMobile) setMobilePanel('preview');
  }, [isMobile]);

  const closeFileTab = useCallback((path: string) => {
    if (dirtyByPath[path]) {
      const keep = window.confirm(`Discard unsaved changes in "${path}"?`);
      if (!keep) return;
    }
    setOpenTabs((prev) => {
      const idx = prev.indexOf(path);
      const next = prev.filter((item) => item !== path);
      if (activeTab === path) {
        setActiveTab(next[idx] ?? next[idx - 1] ?? null);
      }
      return next;
    });
    setDraftByPath((prev) => {
      const { [path]: _removed, ...rest } = prev;
      return rest;
    });
    setDirtyByPath((prev) => {
      const { [path]: _removed, ...rest } = prev;
      return rest;
    });
  }, [activeTab, dirtyByPath]);

  const createEntryMutation = useMutation({
    mutationFn: (input: { path: string; type: 'file' | 'dir' }) => projectsApi.createFileEntry(id!, input),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ['project-files', id] });
      if (entry.type === 'file') openFileTab(entry.path);
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveFileMutation = useMutation({
    mutationFn: (payload: { path: string; content: string }) => projectsApi.writeFile(id!, payload),
    onSuccess: (saved, payload) => {
      queryClient.setQueryData(['project-file', id, payload.path], saved);
      setDirtyByPath((prev) => ({ ...prev, [payload.path]: false }));
      queryClient.invalidateQueries({ queryKey: ['project-files', id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (path: string) => projectsApi.deleteFile(id!, path),
    onSuccess: (_ignored, deletedPath) => {
      queryClient.invalidateQueries({ queryKey: ['project-files', id] });
      setOpenTabs((prev) => prev.filter((path) => path !== deletedPath && !path.startsWith(`${deletedPath}/`)));
      setDraftByPath((prev) => Object.fromEntries(
        Object.entries(prev).filter(([path]) => path !== deletedPath && !path.startsWith(`${deletedPath}/`)),
      ));
      setDirtyByPath((prev) => Object.fromEntries(
        Object.entries(prev).filter(([path]) => path !== deletedPath && !path.startsWith(`${deletedPath}/`)),
      ));
      if (activeTab && (activeTab === deletedPath || activeTab.startsWith(`${deletedPath}/`))) {
        setActiveTab(null);
      }
      if (treeSelection && (treeSelection === deletedPath || treeSelection.startsWith(`${deletedPath}/`))) {
        setTreeSelection(null);
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const syncDefaultBranchMutation = useMutation({
    mutationFn: () => projectsApi.syncDefaultBranch(id!),
    onSuccess: (result) => {
      setError(null);
      setSyncNotice(
        result.updated
          ? `${result.branch} updated from ${result.remote}`
          : `${result.branch} is already up to date with ${result.remote}`,
      );
      queryClient.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (err: Error) => {
      setSyncNotice(null);
      setError(err.message);
    },
  });

  const saveActiveTab = useCallback(() => {
    if (!activeTab || !activeFileData || activeFileData.binary || activeFileData.truncated) return;
    const next = draftByPath[activeTab] ?? activeFileData.content;
    saveFileMutation.mutate({ path: activeTab, content: next });
  }, [activeFileData, activeTab, draftByPath, saveFileMutation]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveActiveTab]);

  useEffect(() => {
    if (!secretsData || secretsDirty) return;
    setSecretRows(normalizeSecretRows(secretsData.secretFiles));
    setSelectedSecretIndex(0);
    setResolveOverrides({});
  }, [secretsData, secretsDirty]);

  useEffect(() => {
    if (secretRows.length === 0) {
      if (selectedSecretIndex !== 0) setSelectedSecretIndex(0);
      return;
    }
    if (selectedSecretIndex > secretRows.length - 1) {
      setSelectedSecretIndex(secretRows.length - 1);
    }
  }, [secretRows, selectedSecretIndex]);

  const saveSecretsMutation = useMutation({
    mutationFn: (rows: ProjectSecretFile[]) => {
      const compact = rows
        .map((row) => ({
          path: row.path.trim(),
          mode: row.mode || 'copy',
          sourcePath: row.sourcePath?.trim() || undefined,
          enabled: row.enabled,
        }))
        .filter((row) => row.path.length > 0);
      return projectsApi.updateSecrets(id!, compact);
    },
    onSuccess: () => {
      setSecretsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['project-secrets', id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const onMainDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPanelPct(Math.max(18, Math.min(60, pct)));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const onRightDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!rightRef.current) return;
      const rect = rightRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setPreviewPanelPct(Math.max(25, Math.min(75, pct)));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const openSecretEditor = async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || !id) return;
    setSecretEditorPath(trimmed);
    setSecretEditorLoading(true);
    setSecretEditorContent('');
    try {
      const res = await projectsApi.getSecretContent(id, trimmed);
      setSecretEditorContent(res.content);
    } catch {
      setSecretEditorContent('');
    } finally {
      setSecretEditorLoading(false);
    }
  };

  const saveSecretContent = async () => {
    if (!id || !secretEditorPath) return;
    setSecretEditorSaving(true);
    setError(null);
    try {
      await projectsApi.putSecretContent(id, secretEditorPath, secretEditorContent);
      queryClient.invalidateQueries({ queryKey: ['project-secrets', id] });
      setSecretEditorPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret content');
    } finally {
      setSecretEditorSaving(false);
    }
  };

  const resolveOneSecret = async (path: string) => {
    if (!id || !path.trim()) return;
    try {
      const res = await projectsApi.resolveSecrets(id, [path.trim()]);
      if (res.results[0]) {
        setResolveOverrides((prev) => ({ ...prev, [path.trim()]: res.results[0] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve secret');
    }
  };

  const secretStatusByPath = useMemo(() => {
    const map = new Map<string, ProjectSecretFileStatus>();
    for (const row of secretsData?.secretFiles ?? []) {
      map.set(row.path, row);
    }
    return map;
  }, [secretsData]);

  const secretDiagnostics = useMemo(() => {
    return secretRows.map((row) => {
      const key = row.path.trim();
      const status = key ? secretStatusByPath.get(key) : undefined;
      const override = key ? resolveOverrides[key] : undefined;
      const resolvedSource = override?.resolvedSource ?? status?.resolvedSource;
      const resolvedKind = override?.resolvedKind ?? status?.resolvedKind;
      const managedExists = status?.managedExists ?? false;
      const state: 'ready' | 'missing' | 'disabled' = !row.enabled
        ? 'disabled'
        : resolvedSource
          ? 'ready'
          : 'missing';

      return {
        key,
        status,
        resolvedSource,
        resolvedKind,
        managedExists,
        state,
      };
    });
  }, [secretRows, secretStatusByPath, resolveOverrides]);

  const enabledSecrets = secretRows.filter((row) => row.enabled).length;
  const readySecrets = secretDiagnostics.filter((d) => d.state === 'ready').length;
  const missingSecrets = secretDiagnostics.filter((d) => d.state === 'missing').length;
  const quickSecretPaths = ['.env', '.env.local', '.dev.vars', '.env.development.local'];
  const configuredSecretPaths = useMemo(
    () => new Set(secretRows.map((row) => row.path.trim()).filter(Boolean)),
    [secretRows],
  );
  const selectedSecret = secretRows[selectedSecretIndex];
  const selectedSecretDiag = secretDiagnostics[selectedSecretIndex];

  const addSecretRow = (path = '') => {
    let nextIndex = 0;
    setSecretRows((prev) => {
      nextIndex = prev.length;
      return [...prev, { path, mode: 'copy', enabled: true }];
    });
    setSelectedSecretIndex(nextIndex);
    setSecretsDirty(true);
  };

  const updateSecretAt = (idx: number, patch: Partial<ProjectSecretFile>) => {
    setSecretRows((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setSecretsDirty(true);
  };

  if (projectLoading) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center text-dim">Loading...</div>
      </Layout>
    );
  }

  if (!project || !id) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center text-dim">Project not found</div>
      </Layout>
    );
  }

  const createEntryPrompt = (type: 'file' | 'dir') => {
    const basePath = selectedEntry
      ? selectedEntry.type === 'dir'
        ? `${selectedEntry.path}/`
        : `${selectedEntry.path.split('/').slice(0, -1).join('/')}${selectedEntry.path.includes('/') ? '/' : ''}`
      : '';
    const raw = window.prompt(
      type === 'file'
        ? 'New file path (relative to project root):'
        : 'New folder path (relative to project root):',
      basePath,
    );
    if (!raw) return;
    const path = raw.trim().replace(/^\/+/, '');
    if (!path) return;
    createEntryMutation.mutate({ path, type });
  };

  const deleteSelectedEntry = () => {
    if (!selectedEntry) return;
    const noun = selectedEntry.type === 'dir' ? 'folder' : 'file';
    const confirmed = window.confirm(`Delete ${noun} "${selectedEntry.path}"? This cannot be undone.`);
    if (!confirmed) return;
    deleteEntryMutation.mutate(selectedEntry.path);
  };

  const renderTreeNode = ({ node, style }: NodeRendererProps<FileTreeNodeData>) => (
    <div style={style} className="px-1">
      <button
        onClick={() => {
          const path = node.data.path;
          setTreeSelection(path);
          if (node.data.type === 'dir') {
            node.toggle();
            return;
          }
          openFileTab(path);
        }}
        className={`w-full px-2 py-1 rounded-md text-xs flex items-center gap-2 text-left transition-colors ${
          treeSelection === node.data.path
            ? 'bg-accent/12 text-accent'
            : 'hover:bg-tertiary'
        }`}
        title={node.data.path}
      >
        {node.data.type === 'dir' ? (
          <Folder size={14} className="shrink-0 text-dim" />
        ) : (
          <FileText size={14} className="shrink-0 text-dim" />
        )}
        <span className="truncate">{node.data.name}</span>
      </button>
    </div>
  );

  const filesPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-dim">Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['project-files', id] })}
            className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
            title="Refresh files"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => createEntryPrompt('file')}
            disabled={createEntryMutation.isPending}
            className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
            title="Create file"
          >
            <FilePlus2 size={12} />
          </button>
          <button
            onClick={() => createEntryPrompt('dir')}
            disabled={createEntryMutation.isPending}
            className="px-2 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
            title="Create folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={deleteSelectedEntry}
            disabled={!selectedEntry || deleteEntryMutation.isPending}
            className="px-2 py-1 text-xs bg-tertiary text-[var(--color-error)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
            title="Delete selected"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="px-3 py-1 text-[11px] text-dim border-b border-subtle font-mono truncate">/</div>
      <div className="px-3 py-2 border-b border-subtle bg-secondary/40">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-primary border border-subtle rounded-md pl-7 pr-8 py-1.5 text-xs focus:outline-none focus:border-[var(--color-text-secondary)]"
          />
          {fileSearch && (
            <button
              onClick={() => setFileSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary transition-colors"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div ref={treeContainerRef} className="flex-1 min-h-0 overflow-hidden">
        {filesLoading ? (
          <div className="p-3 text-xs text-dim">Loading files...</div>
        ) : treeData.length === 0 ? (
          <div className="p-3 text-xs text-dim">No files yet</div>
        ) : filteredTreeData.length === 0 ? (
          <div className="p-3 text-xs text-dim">No files match "{fileSearch.trim()}".</div>
        ) : (
          <Tree<FileTreeNodeData>
            data={filteredTreeData}
            width="100%"
            height={treeHeight}
            rowHeight={28}
            indent={18}
            selection={treeSelection ?? undefined}
            openByDefault={normalizedFileSearch.length > 0}
            onSelect={(nodes: NodeApi<FileTreeNodeData>[]) => {
              const node = nodes[0];
              if (!node) return;
              setTreeSelection(node.data.path);
            }}
          >
            {renderTreeNode}
          </Tree>
        )}
      </div>
    </div>
  );

  const previewPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="h-10 border-b border-subtle bg-secondary flex items-center">
        <div className="h-full min-w-0 flex-1 flex items-center overflow-x-auto">
          {openTabs.length === 0 ? (
            <span className="px-3 text-xs text-dim uppercase tracking-wider">Editor</span>
          ) : (
            openTabs.map((path) => (
              <button
                key={path}
                onClick={() => {
                  setActiveTab(path);
                  setTreeSelection(path);
                }}
                className={`h-full shrink-0 max-w-[280px] flex items-center gap-2 px-3 text-xs transition-colors whitespace-nowrap border-b-2 ${
                  activeTab === path
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-transparent text-dim hover:text-[var(--color-text-primary)]'
                }`}
                title={path}
              >
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{fileName(path)}</span>
                {dirtyByPath[path] && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] shrink-0" />}
                <span
                  onClick={(ev) => {
                    ev.stopPropagation();
                    closeFileTab(path);
                  }}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-dim hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors ml-0.5"
                  title="Close tab"
                >
                  <X size={12} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="h-full px-3 border-l border-subtle flex items-center gap-2 shrink-0 bg-secondary/80">
          {activeTab && <span className="text-[11px] font-mono text-dim truncate max-w-[220px]">{activeTab}</span>}
          <button
            onClick={saveActiveTab}
            disabled={!activeTab || !activeDirty || saveFileMutation.isPending || activeFileData?.binary || activeFileData?.truncated}
            className="px-2 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Save size={12} />
            {saveFileMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {!activeTab ? (
          <div className="h-full flex items-center justify-center text-dim text-sm">Select a file to edit</div>
        ) : fileLoading && !activeFileData ? (
          <div className="p-3 text-xs text-dim">Loading file...</div>
        ) : !activeFileData ? (
          <div className="p-3 text-xs text-dim">File not found</div>
        ) : activeFileData.binary ? (
          <div className="p-3 text-xs text-dim">Binary files cannot be edited in the workspace editor.</div>
        ) : activeFileData.truncated ? (
          <div className="p-3 text-xs text-dim">File is too large for in-app editing (preview limit: 256 KiB).</div>
        ) : (
          <div className="h-full min-h-0 [&_.cm-editor]:h-full [&_.cm-editor]:max-h-full [&_.cm-editor]:overflow-hidden [&_.cm-editor]:bg-primary [&_.cm-editor]:text-[var(--color-text-primary)] [&_.cm-editor.cm-focused]:outline-none [&_.cm-scroller]:max-h-full [&_.cm-scroller]:overflow-auto [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs [&_.cm-content]:min-h-full [&_.cm-content]:py-2 [&_.cm-gutters]:bg-secondary [&_.cm-gutters]:text-dim [&_.cm-gutters]:border-r [&_.cm-gutters]:border-subtle [&_.cm-activeLine]:bg-accent/10 [&_.cm-activeLineGutter]:bg-transparent [&_.cm-activeLineGutter]:text-[var(--color-text-secondary)] [&_.cm-cursor]:border-l-[var(--color-accent)] [&_.cm-selectionBackground]:bg-accent/20">
            <CodeMirror
              value={activeDraft}
              height="100%"
              extensions={activeTab ? getLanguageExtension(activeTab) : []}
              onChange={(value: string) => {
                if (!activeTab || !activeFileData) return;
                setDraftByPath((prev) => ({ ...prev, [activeTab]: value }));
                setDirtyByPath((prev) => ({ ...prev, [activeTab]: value !== activeFileData.content }));
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  const secretsPanel = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-subtle bg-secondary/60 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-dim">Secrets</div>
            <p className="mt-1 text-xs text-dim">
              Map project secret files, choose how they materialize in task worktrees, and manage a safe source copy.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="px-2 py-0.5 rounded-full bg-tertiary text-dim border border-subtle">{enabledSecrets} enabled</span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/25">{readySecrets} ready</span>
              {missingSecrets > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/25">{missingSecrets} missing</span>
              )}
              {secretsDirty && (
                <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">unsaved changes</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => addSecretRow('')}
              className="px-2.5 py-1.5 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
            >
              <Plus size={12} />
              Add Mapping
            </button>
            <button
              onClick={() => saveSecretsMutation.mutate(secretRows)}
              disabled={saveSecretsMutation.isPending || !secretsDirty}
              className="px-2.5 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-dim transition-colors disabled:opacity-40"
            >
              {saveSecretsMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div>
          <p className="text-[11px] text-dim uppercase tracking-wider mb-1.5">Quick Add</p>
          <div className="flex flex-wrap gap-1.5">
            {quickSecretPaths.map((path) => {
              const exists = configuredSecretPaths.has(path);
              return (
                <button
                  key={path}
                  onClick={() => addSecretRow(path)}
                  disabled={exists}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                    exists
                      ? 'border-subtle bg-primary text-dim opacity-50 cursor-not-allowed'
                      : 'border-subtle bg-primary hover:bg-tertiary text-[var(--color-text-secondary)]'
                  }`}
                >
                  {path}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {secretsLoading ? (
          <div className="p-3 text-xs text-dim">Loading secrets...</div>
        ) : secretRows.length === 0 ? (
          <div className="h-full flex items-center justify-center p-4 bg-secondary/30">
            <div className="max-w-sm text-center border border-dashed border-subtle rounded-xl p-5 bg-primary">
              <p className="text-sm">No secret mappings configured yet</p>
              <p className="text-xs text-dim mt-1">
                Start with `.env`, `.env.local`, or `.dev.vars`. Missing sources are auto-created as empty files in new worktrees.
              </p>
              <button
                onClick={() => addSecretRow('.env')}
                className="mt-4 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-dim transition-colors inline-flex items-center gap-1"
              >
                <Plus size={12} />
                Add First Secret
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
            <div className="border-b md:border-b-0 md:border-r border-subtle overflow-y-auto p-2 space-y-2 bg-secondary/40">
              <div className="px-1 text-[11px] uppercase tracking-wider text-dim">Mappings</div>
              {secretRows.map((row, idx) => {
                const diag = secretDiagnostics[idx];
                const isSelected = idx === selectedSecretIndex;
                const modeIcon = row.mode === 'symlink' ? <Link2 size={12} /> : <Copy size={12} />;
                const statusIcon = diag?.state === 'ready'
                  ? <CheckCircle2 size={12} />
                  : diag?.state === 'disabled'
                    ? <Ban size={12} />
                    : <AlertTriangle size={12} />;
                const statusText = diag?.state === 'ready'
                  ? 'ready'
                  : diag?.state === 'disabled'
                    ? 'disabled'
                    : 'missing source';
                const statusClass = diag?.state === 'ready'
                  ? 'text-[var(--color-success)]'
                  : diag?.state === 'disabled'
                    ? 'text-dim'
                    : 'text-[var(--color-warning)]';

                return (
                  <button
                    key={`${idx}-${row.path}`}
                    onClick={() => setSelectedSecretIndex(idx)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-[inset_0_0_0_1px_var(--color-accent)]'
                        : 'border-subtle bg-primary hover:bg-tertiary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate">{row.path || '(new mapping)'}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] ${statusClass} shrink-0`}>
                        {statusIcon}
                        {statusText}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-dim">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary border border-subtle">
                        {modeIcon}
                        {row.mode}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-secondary border border-subtle">
                        {row.enabled ? 'enabled' : 'off'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 overflow-y-auto p-3 space-y-3">
              {selectedSecret ? (() => {
                const row = selectedSecret;
                const diag = selectedSecretDiag;
                const resolvedSource = diag?.resolvedSource;
                const resolvedKind = diag?.resolvedKind;
                const canResolve = row.path.trim().length > 0;

                return (
                  <>
                    <div className="rounded-xl border border-subtle bg-secondary/60 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">Mapping Details</p>
                          <p className="text-[11px] text-dim mt-0.5">
                            Destination path is where the file appears inside each worktree.
                          </p>
                        </div>
                        <span className="text-[11px] text-dim">#{selectedSecretIndex + 1}</span>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-[11px] text-dim uppercase tracking-wider">Destination Path</span>
                          <input
                            value={row.path}
                            onChange={(e) => updateSecretAt(selectedSecretIndex, { path: e.target.value })}
                            placeholder=".env"
                            className="w-full bg-primary border border-subtle rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                          />
                          <p className="text-[10px] text-dim">Example: `.env`, `.dev.vars`, `config/.secrets.local`</p>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-dim uppercase tracking-wider">Source Override (Optional)</span>
                          <input
                            value={row.sourcePath || ''}
                            onChange={(e) => updateSecretAt(selectedSecretIndex, { sourcePath: e.target.value || undefined })}
                            placeholder="config/.env.local"
                            className="w-full bg-primary border border-subtle rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                          />
                          <p className="text-[10px] text-dim">Leave empty to let Codeburg auto-resolve a source.</p>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-dim uppercase tracking-wider mr-1">Materialize As</span>
                        <button
                          onClick={() => updateSecretAt(selectedSecretIndex, { mode: 'copy' })}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors inline-flex items-center gap-1 ${
                            row.mode === 'copy'
                              ? 'bg-accent/15 border-accent text-accent'
                              : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          <Copy size={12} />
                          copy
                        </button>
                        <button
                          onClick={() => updateSecretAt(selectedSecretIndex, { mode: 'symlink' })}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors inline-flex items-center gap-1 ${
                            row.mode === 'symlink'
                              ? 'bg-accent/15 border-accent text-accent'
                              : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          <Link2 size={12} />
                          symlink
                        </button>
                        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-dim">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => updateSecretAt(selectedSecretIndex, { enabled: e.target.checked })}
                          />
                          enabled
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-subtle bg-primary p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-dim uppercase tracking-wider">Resolution Status</span>
                        <button
                          onClick={() => resolveOneSecret(row.path)}
                          disabled={!canResolve}
                          className="px-2.5 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          <Wand2 size={12} />
                          Resolve
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="rounded-md border border-subtle bg-secondary px-2.5 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-dim">Managed Source File</p>
                          <p className={`text-xs mt-1 ${diag?.managedExists ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
                            {diag?.managedExists ? 'Present' : 'Missing'}
                          </p>
                        </div>
                        <div className="rounded-md border border-subtle bg-secondary px-2.5 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-dim">Resolved Input Source</p>
                          {resolvedSource ? (
                            <p className="text-xs font-mono mt-1 truncate" title={resolvedSource}>
                              {resolvedKind ? `[${resolvedKind}] ` : ''}{resolvedSource}
                            </p>
                          ) : (
                            <p className="text-xs mt-1 text-[var(--color-warning)]">Not found</p>
                          )}
                        </div>
                      </div>

                      {!resolvedSource && (
                        <p className="text-[11px] text-[var(--color-warning)]">
                          No source was found. New worktrees will still get an empty file so setup can continue.
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl border border-subtle bg-secondary/40 p-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => openSecretEditor(row.path)}
                        disabled={!canResolve}
                        className="px-2.5 py-1 text-xs bg-tertiary text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        <Pencil size={12} />
                        {diag?.managedExists ? 'Edit Managed Source' : 'Create Managed Source'}
                      </button>
                      <button
                        onClick={() => {
                          setSecretRows((prev) => prev.filter((_, i) => i !== selectedSecretIndex));
                          setSecretsDirty(true);
                        }}
                        className="ml-auto px-2 py-1 text-xs text-[var(--color-error)] hover:underline inline-flex items-center gap-1"
                      >
                        <Trash2 size={12} />
                        Remove Mapping
                      </button>
                    </div>
                  </>
                );
              })() : (
                <div className="h-full flex items-center justify-center text-xs text-dim">
                  Select a mapping to edit details.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <header className="px-4 py-3 border-b border-subtle bg-secondary flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{project.name}</h1>
            <p className="text-[11px] text-dim font-mono truncate">{project.path}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <OpenInEditorButton worktreePath={project.path} />
            <button
              onClick={() => syncDefaultBranchMutation.mutate()}
              disabled={syncDefaultBranchMutation.isPending}
              className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 inline-flex items-center gap-1"
              title={`Fetch and fast-forward ${project.defaultBranch || 'main'} from remote`}
            >
              <RefreshCw size={13} className={syncDefaultBranchMutation.isPending ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{syncDefaultBranchMutation.isPending ? 'Syncing...' : `Sync ${project.defaultBranch || 'main'}`}</span>
            </button>
            <button
              onClick={() => navigate(`/?project=${project.id}`)}
              className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
              title="Filter dashboard by this project"
            >
              <Funnel size={13} />
              <span className="hidden sm:inline">Filter</span>
            </button>
            <button
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors inline-flex items-center gap-1"
            >
              <Settings size={13} />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="px-4 py-2 text-xs text-[var(--color-error)] border-b border-subtle">
            {error}
          </div>
        )}
        {syncNotice && !error && (
          <div className="px-4 py-2 text-xs text-[var(--color-success)] border-b border-subtle">
            {syncNotice}
          </div>
        )}

        {isMobile ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b border-subtle bg-secondary">
              <select
                value={mobilePanel}
                onChange={(e) => setMobilePanel(e.target.value as MobilePanel)}
                className="bg-primary border border-subtle rounded-md text-sm px-2 py-1 focus:outline-none focus:border-[var(--color-text-secondary)]"
              >
                <option value="files">Files</option>
                <option value="preview">Preview</option>
                <option value="secrets">Secrets</option>
              </select>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mobilePanel === 'files' ? filesPanel : mobilePanel === 'preview' ? previewPanel : secretsPanel}
            </div>
          </div>
        ) : (
          <div ref={bodyRef} className="flex-1 min-h-0 flex overflow-hidden">
            <div style={{ width: `${leftPanelPct}%` }} className="shrink-0 border-r border-subtle overflow-hidden">
              {filesPanel}
            </div>
            <div
              onMouseDown={onMainDividerMouseDown}
              className="w-1 shrink-0 cursor-col-resize border-x border-subtle hover:bg-accent/40 transition-colors"
            />
            <div ref={rightRef} className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div style={{ height: `${previewPanelPct}%` }} className="overflow-hidden min-h-0">
                {previewPanel}
              </div>
              <div
                onMouseDown={onRightDividerMouseDown}
                className="h-1 shrink-0 cursor-row-resize border-y border-subtle hover:bg-accent/40 transition-colors"
              />
              <div className="flex-1 min-h-0 overflow-hidden border-t border-subtle">
                {secretsPanel}
              </div>
            </div>
          </div>
        )}
      </div>

      {secretEditorPath && (
        <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b border-subtle">
              <h3 className="text-sm font-medium">Managed Secret Source</h3>
              <p className="text-[11px] text-dim font-mono mt-1">{secretEditorPath}</p>
            </div>
            <div className="p-4 flex-1 min-h-0 overflow-auto">
              {secretEditorLoading ? (
                <div className="text-xs text-dim">Loading...</div>
              ) : (
                <textarea
                  value={secretEditorContent}
                  onChange={(e) => setSecretEditorContent(e.target.value)}
                  rows={18}
                  className="w-full bg-primary border border-subtle rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--color-text-secondary)]"
                />
              )}
            </div>
            <div className="px-4 py-3 border-t border-subtle flex justify-end gap-2">
              <button
                onClick={() => setSecretEditorPath(null)}
                className="px-3 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSecretContent}
                disabled={secretEditorSaving || secretEditorLoading}
                className="px-3 py-1.5 bg-accent text-white rounded-md text-xs hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {secretEditorSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
