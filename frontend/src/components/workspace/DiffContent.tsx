import { useEffect, useRef, useMemo, useState } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { getLanguageExtension, darkEditorTheme, lightEditorTheme } from './editorUtils';
import { getResolvedTheme, subscribeToThemeChange } from '../../lib/theme';
import { useMobile } from '../../hooks/useMobile';

// GitHub-style diff colors — background highlights instead of underlines
const githubDiffDark = EditorView.theme({
  // Deleted lines (side a): red background
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'rgba(248, 81, 73, 0.10)',
  },
  // Added lines (side b): green background
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(63, 185, 80, 0.10)',
  },
  // Changed text within deleted lines: stronger red bg
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'rgba(248, 81, 73, 0.30)',
    borderRadius: '2px',
  },
  // Changed text within added lines: stronger green bg
  '&.cm-merge-b .cm-changedText': {
    background: 'rgba(63, 185, 80, 0.30)',
    borderRadius: '2px',
  },
  // Inline deleted text on added side
  '&.cm-merge-b .cm-deletedText': {
    background: 'rgba(248, 81, 73, 0.25)',
    borderRadius: '2px',
  },
  // Gutter colors
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'rgba(248, 81, 73, 0.40)',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    background: 'rgba(63, 185, 80, 0.40)',
  },
}, { dark: true });

const githubDiffLight = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'rgba(255, 129, 130, 0.12)',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(46, 160, 67, 0.10)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'rgba(255, 129, 130, 0.35)',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'rgba(46, 160, 67, 0.30)',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-deletedText': {
    background: 'rgba(255, 129, 130, 0.30)',
    borderRadius: '2px',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'rgba(255, 129, 130, 0.45)',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    background: 'rgba(46, 160, 67, 0.40)',
  },
}, { dark: false });

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
    const diffTheme = theme === 'dark' ? githubDiffDark : githubDiffLight;
    return [
      ...langExts,
      themeExt,
      baseTheme,
      diffTheme,
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
