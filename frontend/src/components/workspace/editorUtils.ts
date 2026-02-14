import type { Extension } from '@codemirror/state';
import { EditorView } from '@uiw/react-codemirror';
import { langs } from '@uiw/codemirror-extensions-langs';

export type FileTreeNodeData = {
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

export function fileExt(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0 || idx === path.length - 1) return '';
  return path.slice(idx + 1).toLowerCase();
}

export function getLanguageExtension(path: string): Extension[] {
  const ext = fileExt(path);
  const factory = languageByExt[ext];
  return factory ? [factory()] : [];
}

export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

const sharedEditorStyles = {
  '&': { backgroundColor: 'var(--color-inset)', color: 'var(--color-text-primary)', fontSize: '12px' },
  '.cm-scroller': { backgroundColor: 'var(--color-inset)' },
  '.cm-content': { fontSize: '12px' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-inset)',
    color: 'var(--color-text-dim)',
    borderRight: '1px solid var(--color-border)',
    fontSize: '12px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-accent-glow)' },
  '.cm-activeLineGutter': { color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-accent-glow)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--color-accent-glow)' },
};

export const darkEditorTheme = EditorView.theme({
  ...sharedEditorStyles,
}, { dark: true });

export const lightEditorTheme = EditorView.theme({
  ...sharedEditorStyles,
}, { dark: false });
