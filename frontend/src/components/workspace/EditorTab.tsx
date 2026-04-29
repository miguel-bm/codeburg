import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { FileCode2, Loader2, RotateCcw, Save, Shapes, SquareArrowOutUpRight, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useSharedWebSocket } from '../../hooks/useSharedWebSocket';
import { useWorkspaceStore } from '../../stores/workspace';
import { getLanguageExtension, fileName, darkEditorTheme, lightEditorTheme } from './editorUtils';
import { getResolvedTheme, subscribeToThemeChange } from '../../lib/theme';
import { StyledPath } from './StyledPath';
import { preferencesApi } from '../../api';
import { useWorkspace } from './WorkspaceContext';
import { parseExcalidrawFileContent, shouldOpenExcalidrawVisually } from './excalidrawFile';

const ExcalidrawFileEditor = lazy(() =>
  import('./ExcalidrawFileEditor').then((module) => ({
    default: module.ExcalidrawFileEditor,
  })),
);

type EditorMode = 'source' | 'diagram';

interface EditorTabProps {
  path: string;
  line?: number;
  onClose?: () => void;
}

export function EditorTab({ path, line, onClose }: EditorTabProps) {
  const { readFile, writeFile } = useWorkspaceFiles();
  const { scope, project } = useWorkspace();
  const { markDirty } = useWorkspaceStore();
  const [loadedPath, setLoadedPath] = useState(path);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('source');
  const [visualEditorRevision, setVisualEditorRevision] = useState(0);
  const [editorTheme, setEditorTheme] = useState<'dark' | 'light'>(() => getResolvedTheme());
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const lastScrolledLine = useRef<number | undefined>(undefined);
  const isDirtyRef = useRef(false);
  const loadingRef = useRef(true);
  const savingRef = useRef(false);

  const { data: editorConfig } = useQuery({
    queryKey: ['preferences', 'editor-config'],
    queryFn: () => preferencesApi.getEditorConfig(),
    staleTime: 30_000,
  });

  useEffect(() => {
    setEditorTheme(getResolvedTheme());
    return subscribeToThemeChange(({ resolvedTheme }) => {
      setEditorTheme(resolvedTheme);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    readFile(path)
      .then((res) => {
        if (cancelled) return;
        setLoadedPath(path);
        setBinary(res.binary);
        setTruncated(res.truncated);
        if (!res.binary) {
          setContent(res.content);
          setOriginalContent(res.content);
          setEditorMode(shouldOpenExcalidrawVisually(path, res.content) ? 'diagram' : 'source');
          setVisualEditorRevision((revision) => revision + 1);
        } else {
          setContent(null);
          setOriginalContent(null);
          setEditorMode('source');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadedPath(path);
        setBinary(false);
        setTruncated(false);
        setContent(null);
        setOriginalContent(null);
        setEditorMode('source');
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, readFile]);

  useEffect(() => {
    lastScrolledLine.current = undefined;
  }, [path]);

  // Go-to-line when `line` prop changes
  useEffect(() => {
    if (loadedPath !== path) return;
    if (!line || line === lastScrolledLine.current) return;
    const view = cmRef.current?.view;
    if (!view) return;
    try {
      const lineInfo = view.state.doc.line(line);
      view.dispatch({
        selection: { anchor: lineInfo.from },
        effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
      });
      lastScrolledLine.current = line;
    } catch {
      // line out of range
    }
  }, [line, loadedPath, loading, path]);

  const isDirty = content !== null && originalContent !== null && content !== originalContent;
  isDirtyRef.current = isDirty;
  loadingRef.current = loading;
  savingRef.current = saving;

  useEffect(() => {
    markDirty(loadedPath, isDirty);
  }, [isDirty, loadedPath, markDirty]);

  const refreshFromDisk = useCallback(async () => {
    if (isDirtyRef.current || loadingRef.current || savingRef.current) return;
    const activeElement = document.activeElement;
    if (activeElement && editorRootRef.current?.contains(activeElement)) return;
    try {
      const res = await readFile(loadedPath);
      if (isDirtyRef.current) return;
      setBinary(res.binary);
      setTruncated(res.truncated);
      if (!res.binary) {
        setContent(res.content);
        setOriginalContent(res.content);
        setEditorMode(shouldOpenExcalidrawVisually(loadedPath, res.content) ? 'diagram' : 'source');
        setVisualEditorRevision((revision) => revision + 1);
      }
    } catch {
      // Background refresh is best-effort.
    }
  }, [loadedPath, readFile]);

  useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type !== 'sidebar_update') return;
      void refreshFromDisk();
    }, [refreshFromDisk]),
  });

  useEffect(() => {
    const onWorkspaceRefresh = () => {
      void refreshFromDisk();
    };
    window.addEventListener('codeburg:workspace-refresh', onWorkspaceRefresh);
    return () => window.removeEventListener('codeburg:workspace-refresh', onWorkspaceRefresh);
  }, [refreshFromDisk]);

  const extensions = useMemo(() => {
    const langExts = getLanguageExtension(loadedPath);
    return [
      ...langExts,
      EditorView.lineWrapping,
      ...(editorTheme === 'dark' ? [oneDark] : []),
      editorTheme === 'dark' ? darkEditorTheme : lightEditorTheme,
    ];
  }, [loadedPath, editorTheme]);

  const handleSave = useCallback(async () => {
    if (content === null || binary || truncated) return;
    setSaving(true);
    try {
      await writeFile({ path: loadedPath, content });
      setOriginalContent(content);
      markDirty(loadedPath, false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [content, binary, truncated, writeFile, loadedPath, markDirty]);

  const handleReset = useCallback(() => {
    if (originalContent === null || saving) return;
    setContent(originalContent);
    setEditorMode(shouldOpenExcalidrawVisually(loadedPath, originalContent) ? 'diagram' : 'source');
    setVisualEditorRevision((revision) => revision + 1);
    markDirty(loadedPath, false);
  }, [loadedPath, markDirty, originalContent, saving]);

  const openInCursor = useCallback(() => {
    const rootPath = scope.type === 'workspace'
      ? scope.workspace.worktreePath ?? project.path
      : scope.type === 'task'
        ? scope.task.worktreePath ?? project.path
        : project.path;
    const absolutePath = `${rootPath.replace(/\/$/, '')}/${loadedPath}`;
    const encodedPath = encodeUriPath(absolutePath);
    const sshHost = editorConfig?.sshHost;
    const targetLine = line ?? 1;
    const uri = sshHost
      ? `cursor://vscode-remote/ssh-remote+${sshHost}${encodedPath}:${targetLine}:1`
      : `cursor://file${encodedPath}:${targetLine}:1`;
    window.open(uri, '_self');
  }, [editorConfig?.sshHost, line, loadedPath, project.path, scope]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        handleSave();
      }
      // Forward Ctrl+F / Cmd+F to CodeMirror search panel
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') {
        if (editorMode !== 'source') return;
        const view = cmRef.current?.view;
        if (view) {
          ev.preventDefault();
          view.focus();
          openSearchPanel(view);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorMode, handleSave]);

  const switchingFiles = loading && loadedPath !== path && content !== null && !binary && !error;
  const excalidrawData = useMemo(() => parseExcalidrawFileContent(content), [content]);
  const canUseDiagramMode = excalidrawData !== null;
  const showDiagramMode = canUseDiagramMode && editorMode === 'diagram';

  if (loading && !switchingFiles) {
    return <div className="flex items-center justify-center h-full text-xs text-dim">Loading {fileName(path)}...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-xs text-[var(--color-error)]">{error}</div>;
  }

  if (binary) {
    return <div className="flex items-center justify-center h-full text-xs text-dim">Binary file cannot be displayed</div>;
  }

  return (
    <div ref={editorRootRef} className="flex h-full flex-col">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-subtle bg-canvas">
        <div className="flex min-w-0 items-center gap-1.5">
          <StyledPath path={loadedPath} />
          <button
            type="button"
            onClick={openInCursor}
            disabled={switchingFiles}
            className="shrink-0 rounded p-1 text-dim hover:bg-tertiary hover:text-accent disabled:opacity-30"
            title="Open this file in Cursor"
            aria-label="Open in Cursor"
          >
            <SquareArrowOutUpRight size={12} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {truncated && (
            <span className="text-[10px] text-yellow-500">truncated</span>
          )}
          {isDirty && (
            <span className="text-[10px] text-accent">modified</span>
          )}
          {canUseDiagramMode && (
            <div className="mr-1 inline-flex h-6 items-center rounded-md bg-primary p-0.5 text-[10px] text-dim ring-1 ring-[var(--color-card-border)]">
              <button
                type="button"
                onClick={() => setEditorMode('diagram')}
                disabled={switchingFiles}
                className={`inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors disabled:opacity-40 ${
                  editorMode === 'diagram'
                    ? 'bg-card text-[var(--color-text-primary)] shadow-sm'
                    : 'hover:bg-secondary hover:text-[var(--color-text-primary)]'
                }`}
                title="Diagram view"
                aria-pressed={editorMode === 'diagram'}
              >
                <Shapes size={11} />
                Diagram
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('source')}
                disabled={switchingFiles}
                className={`inline-flex h-5 items-center gap-1 rounded px-1.5 transition-colors disabled:opacity-40 ${
                  editorMode === 'source'
                    ? 'bg-card text-[var(--color-text-primary)] shadow-sm'
                    : 'hover:bg-secondary hover:text-[var(--color-text-primary)]'
                }`}
                title="JSON source"
                aria-pressed={editorMode === 'source'}
              >
                <FileCode2 size={11} />
                JSON
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || saving || switchingFiles}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary disabled:opacity-30 transition-colors"
            title="Reset changes"
          >
            <RotateCcw size={11} />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving || switchingFiles}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors"
            title="Save (Cmd+S)"
          >
            <Save size={11} />
            {saving ? 'Saving...' : 'Save'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-dim hover:bg-tertiary hover:text-[var(--color-text-primary)]"
              title="Close file"
              aria-label="Close file"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* CodeMirror */}
      <div className="relative flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-inset)' }}>
        {switchingFiles && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-card px-2.5 py-1 text-[11px] text-dim shadow-[var(--shadow-card)]">
            Loading {fileName(path)}
          </div>
        )}
        {showDiagramMode ? (
          <Suspense fallback={<VisualEditorLoading />}>
            <ExcalidrawFileEditor
              key={`${loadedPath}:${visualEditorRevision}`}
              content={content ?? ''}
              readOnly={truncated || switchingFiles}
              onChange={setContent}
            />
          </Suspense>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={content ?? ''}
            onChange={(val) => setContent(val)}
            extensions={extensions}
            height="100%"
            style={{ height: '100%' }}
            readOnly={truncated || switchingFiles}
          />
        )}
      </div>
    </div>
  );
}

function VisualEditorLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-inset)] text-xs text-dim">
      <span className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-2 shadow-card">
        <Loader2 size={13} className="animate-spin text-accent" />
        Loading diagram editor
      </span>
    </div>
  );
}

function encodeUriPath(path: string): string {
  return path.split('/').map((part, index) => {
    if (index === 0 && part === '') return '';
    return encodeURIComponent(part);
  }).join('/');
}
