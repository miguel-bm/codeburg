import { useCallback, useEffect, useMemo, useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { Save } from 'lucide-react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useWorkspaceStore } from '../../stores/workspace';
import { getLanguageExtension, fileName, darkEditorTheme, lightEditorTheme } from './editorUtils';
import { getResolvedTheme, subscribeToThemeChange } from '../../lib/theme';

interface EditorTabProps {
  path: string;
}

export function EditorTab({ path }: EditorTabProps) {
  const { readFile, writeFile } = useWorkspaceFiles();
  const { markDirty } = useWorkspaceStore();
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [editorTheme, setEditorTheme] = useState<'dark' | 'light'>(() => getResolvedTheme());

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

  const isDirty = content !== null && originalContent !== null && content !== originalContent;

  useEffect(() => {
    markDirty(path, isDirty);
  }, [isDirty, markDirty, path]);

  const extensions = useMemo(() => {
    const langExts = getLanguageExtension(path);
    return [
      ...langExts,
      EditorView.lineWrapping,
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

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        handleSave();
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
    <div className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-subtle bg-secondary">
        <span className="text-xs text-dim font-mono truncate">{path}</span>
        <div className="flex items-center gap-1.5">
          {truncated && (
            <span className="text-[10px] text-yellow-500">truncated</span>
          )}
          {isDirty && (
            <span className="text-[10px] text-accent">modified</span>
          )}
          <button
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
      <div className="flex-1 overflow-auto" style={{ backgroundColor: editorTheme === 'dark' ? '#070707' : '#ffffff' }}>
        <CodeMirror
          value={content ?? ''}
          onChange={(val) => setContent(val)}
          extensions={extensions}
          theme={editorTheme === 'dark' ? oneDark : undefined}
          height="100%"
          style={{ height: '100%' }}
          readOnly={truncated}
        />
      </div>
    </div>
  );
}
