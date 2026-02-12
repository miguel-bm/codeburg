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

export const darkEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#0a0a0b', fontSize: '12px' },
  '.cm-scroller': { backgroundColor: '#0a0a0b' },
  '.cm-content': { fontSize: '12px' },
  '.cm-gutters': { backgroundColor: '#0a0a0b', color: '#84848A', borderRight: '1px solid #141415', fontSize: '12px' },
  '.cm-activeLine': { backgroundColor: '#19283c8c' },
  '.cm-activeLineGutter': { color: '#adadb1', backgroundColor: '#19283c8c' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#009fff4d' },
}, { dark: true });

export const lightEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#fafafa', fontSize: '12px' },
  '.cm-scroller': { backgroundColor: '#fafafa' },
  '.cm-content': { fontSize: '12px' },
  '.cm-gutters': { backgroundColor: '#fafafa', color: '#84848A', borderRight: '1px solid #eeeeef', fontSize: '12px' },
  '.cm-activeLine': { backgroundColor: '#dfebff8c' },
  '.cm-activeLineGutter': { color: '#6C6C71', backgroundColor: '#dfebff8c' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#009fff2e' },
}, { dark: false });
