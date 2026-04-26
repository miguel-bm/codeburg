import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { RotateCcw, Save, SquareArrowOutUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useSharedWebSocket } from '../../hooks/useSharedWebSocket';
import { useWorkspaceStore } from '../../stores/workspace';
import { getLanguageExtension, fileName, darkEditorTheme, lightEditorTheme } from './editorUtils';
import { getResolvedTheme, subscribeToThemeChange } from '../../lib/theme';
import { StyledPath } from './StyledPath';
import { preferencesApi } from '../../api';
import { useWorkspace } from './WorkspaceContext';

interface EditorTabProps {
  path: string;
  line?: number;
}

export function EditorTab({ path, line }: EditorTabProps) {
  const { readFile, writeFile } = useWorkspaceFiles();
  const { scope, project } = useWorkspace();
  const { markDirty } = useWorkspaceStore();
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
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
        setBinary(res.binary);
        setTruncated(res.truncated);
        if (!res.binary) {
          setContent(res.content);
          setOriginalContent(res.content);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, readFile]);

  // Go-to-line when `line` prop changes
  useEffect(() => {
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
  }, [line, loading]);

  const isDirty = content !== null && originalContent !== null && content !== originalContent;
  isDirtyRef.current = isDirty;
  loadingRef.current = loading;
  savingRef.current = saving;

  useEffect(() => {
    markDirty(path, isDirty);
  }, [isDirty, markDirty, path]);

  const refreshFromDisk = useCallback(async () => {
    if (isDirtyRef.current || loadingRef.current || savingRef.current) return;
    const activeElement = document.activeElement;
    if (activeElement && editorRootRef.current?.contains(activeElement)) return;
    try {
      const res = await readFile(path);
      if (isDirtyRef.current) return;
      setBinary(res.binary);
      setTruncated(res.truncated);
      if (!res.binary) {
        setContent(res.content);
        setOriginalContent(res.content);
      }
    } catch {
      // Background refresh is best-effort.
    }
  }, [path, readFile]);

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
    const langExts = getLanguageExtension(path);
    return [
      ...langExts,
      EditorView.lineWrapping,
      ...(editorTheme === 'dark' ? [oneDark] : []),
      editorTheme === 'dark' ? darkEditorTheme : lightEditorTheme,
    ];
  }, [path, editorTheme]);

  const handleSave = useCallback(async () => {
    if (content === null || binary || truncated) return;
    setSaving(true);
    try {
      await writeFile({ path, content });
      setOriginalContent(content);
      markDirty(path, false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [content, binary, truncated, writeFile, path, markDirty]);

  const handleReset = useCallback(() => {
    if (originalContent === null || saving) return;
    setContent(originalContent);
    markDirty(path, false);
  }, [markDirty, originalContent, path, saving]);

  const openInCursor = useCallback(() => {
    const rootPath = scope.type === 'workspace'
      ? scope.workspace.worktreePath ?? project.path
      : scope.type === 'task'
        ? scope.task.worktreePath ?? project.path
        : project.path;
    const absolutePath = `${rootPath.replace(/\/$/, '')}/${path}`;
    const encodedPath = encodeURI(absolutePath);
    const sshHost = editorConfig?.sshHost;
    const uri = sshHost
      ? `cursor://vscode-remote/ssh-remote+${sshHost}${encodedPath}`
      : `cursor://file${encodedPath}`;
    window.open(uri, '_self');
  }, [editorConfig?.sshHost, path, project.path, scope]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        handleSave();
      }
      // Forward Ctrl+F / Cmd+F to CodeMirror search panel
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') {
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
  }, [handleSave]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-xs text-dim">Loading {fileName(path)}...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-xs text-[var(--color-error)]">{error}</div>;
  }

  if (binary) {
    return <div className="flex items-center justify-center h-full text-xs text-dim">Binary file cannot be displayed</div>;
  }

  return (
    <div ref={editorRootRef} className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-subtle bg-canvas">
        <div className="flex min-w-0 items-center gap-1.5">
          <StyledPath path={path} />
          <button
            type="button"
            onClick={openInCursor}
            className="shrink-0 rounded p-1 text-dim hover:bg-tertiary hover:text-accent"
            title="Open in Cursor"
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
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || saving}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary disabled:opacity-30 transition-colors"
            title="Reset changes"
          >
            <RotateCcw size={11} />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors"
            title="Save (Cmd+S)"
          >
            <Save size={11} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* CodeMirror */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-inset)' }}>
        <CodeMirror
          ref={cmRef}
          value={content ?? ''}
          onChange={(val) => setContent(val)}
          extensions={extensions}
          height="100%"
          style={{ height: '100%' }}
          readOnly={truncated}
        />
      </div>
    </div>
  );
}
