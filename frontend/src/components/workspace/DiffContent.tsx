import { useEffect, useRef, useMemo, useState } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { getLanguageExtension, darkEditorTheme, lightEditorTheme } from './editorUtils';
import { getResolvedTheme, subscribeToThemeChange } from '../../lib/theme';
import { useMobile } from '../../hooks/useMobile';

interface DiffContentProps {
  original: string;
  modified: string;
  path: string;
}

export function DiffContent({ original, modified, path }: DiffContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const isMobile = useMobile();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getResolvedTheme());

  useEffect(() => {
    setTheme(getResolvedTheme());
    return subscribeToThemeChange(({ resolvedTheme }) => {
      setTheme(resolvedTheme);
    });
  }, []);

  const extensions = useMemo(() => {
    const langExts = getLanguageExtension(path);
    const themeExt = theme === 'dark' ? darkEditorTheme : lightEditorTheme;
    const baseTheme = theme === 'dark' ? oneDark : [];
    return [
      ...langExts,
      themeExt,
      baseTheme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ].flat();
  }, [path, theme]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clean up previous view
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const mergeView = new MergeView({
      a: {
        doc: original,
        extensions,
      },
      b: {
        doc: modified,
        extensions,
      },
      parent: el,
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      gutter: true,
    });

    viewRef.current = mergeView;

    return () => {
      mergeView.destroy();
      viewRef.current = null;
    };
  }, [original, modified, extensions, isMobile]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto"
      style={{ backgroundColor: theme === 'dark' ? '#0a0a0b' : '#fafafa' }}
    />
  );
}
