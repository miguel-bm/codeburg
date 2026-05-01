import { forwardRef, startTransition, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import CodeMirror, { EditorView, type ReactCodeMirrorRef, type ViewUpdate } from '@uiw/react-codemirror';
import { Decoration, keymap, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, Prec, type Extension } from '@codemirror/state';
import { WidgetType, ViewPlugin } from '@codemirror/view';
import type { CodeburgReference, CodeburgReferenceRange } from './referenceTokens';
import type { InputSelection } from './chatAutocomplete';

export interface TokenAwareComposerHandle {
  focus: () => void;
  blur: () => void;
  setSelection: (selection: InputSelection) => void;
  getSelection: () => InputSelection;
}

export interface ComposerKeyCommand {
  key: string;
  shiftKey: boolean;
  value: string;
  preventDefault: () => void;
}

interface TokenAwareComposerProps {
  value: string;
  disabled?: boolean;
  placeholder: string;
  minHeight: number;
  maxHeight: number;
  referenceRanges: CodeburgReferenceRange[];
  activeTokenRange?: { from: number; to: number } | null;
  onChange: (value: string, selection: InputSelection) => void;
  onSelectionChange: (selection: InputSelection) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPasteFiles: (clipboardData: DataTransfer) => boolean;
  onKeyCommand: (event: ComposerKeyCommand, selection: InputSelection) => boolean;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
}

const composerBasicSetup = {
  lineNumbers: false,
  highlightActiveLineGutter: false,
  foldGutter: false,
  dropCursor: true,
  allowMultipleSelections: false,
  indentOnInput: false,
  bracketMatching: false,
  closeBrackets: false,
  autocompletion: false,
  rectangularSelection: false,
  crosshairCursor: false,
  highlightActiveLine: false,
  highlightSelectionMatches: false,
  closeBracketsKeymap: false,
  searchKeymap: false,
  foldKeymap: false,
  completionKeymap: false,
  lintKeymap: false,
  tabSize: 2,
};

export const TokenAwareComposer = forwardRef<TokenAwareComposerHandle, TokenAwareComposerProps>(function TokenAwareComposer({
  value,
  disabled = false,
  placeholder,
  minHeight,
  maxHeight,
  referenceRanges,
  activeTokenRange,
  onChange,
  onSelectionChange,
  onFocus,
  onBlur,
  onPasteFiles,
  onKeyCommand,
  onOpenWorkspaceFile,
}, ref) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [localValue, setLocalValue] = useState(value);
  const pendingEchoValuesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pendingEchoValuesRef.current.delete(value)) return;
    setLocalValue(value);
  }, [value]);

  const editorTheme = useMemo(
    () => EditorView.theme({
      '&': {
        minHeight: `${minHeight}px`,
        backgroundColor: 'transparent',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
        fontSize: '14px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-scroller': {
        maxHeight: `${maxHeight}px`,
        minHeight: `${minHeight}px`,
        overflow: 'auto',
        fontFamily: 'inherit',
        lineHeight: '1.5rem',
      },
      '.cm-content': {
        minHeight: `calc(${minHeight}px - 1.3rem)`,
        padding: '0.75rem 0.75rem 0.55rem',
        caretColor: 'var(--color-accent)',
      },
      '.cm-line': {
        padding: 0,
      },
      '.cm-placeholder': {
        color: 'var(--color-text-dim)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-accent)',
      },
      '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--color-accent-glow)',
      },
      '.cm-codeburg-token': {
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '100%',
        borderRadius: '0.55rem',
        padding: '0 0.38rem',
        margin: '0 0.08rem',
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
        fontSize: '0.92em',
        fontWeight: 500,
        lineHeight: '1.35rem',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        cursor: 'default',
      },
      '.cm-codeburg-token-skill': {
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        color: 'var(--color-accent)',
        cursor: 'pointer',
      },
      '.cm-codeburg-token-skill:hover': {
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
      },
      '.cm-codeburg-token-file': {
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
        color: 'var(--color-warning)',
      },
      '.cm-codeburg-token-file[data-clickable="true"]': {
        cursor: 'pointer',
      },
      '.cm-codeburg-token-file[data-clickable="true"]:hover': {
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
        color: 'var(--color-warning)',
      },
    }),
    [maxHeight, minHeight],
  );

  const extensions = useMemo<Extension[]>(() => [
    EditorView.lineWrapping,
    editorTheme,
    Prec.highest(keymap.of([
      { key: 'ArrowDown', run: (view) => onKeyCommand(codeMirrorKeyCommand('ArrowDown', view), editorSelection(view)) },
      { key: 'ArrowUp', run: (view) => onKeyCommand(codeMirrorKeyCommand('ArrowUp', view), editorSelection(view)) },
      { key: 'Enter', run: (view) => onKeyCommand(codeMirrorKeyCommand('Enter', view), editorSelection(view)) },
      { key: 'Tab', run: (view) => onKeyCommand(codeMirrorKeyCommand('Tab', view), editorSelection(view)) },
      { key: 'Escape', run: (view) => onKeyCommand(codeMirrorKeyCommand('Escape', view), editorSelection(view)) },
    ])),
    codeburgReferenceDecorations(referenceRanges, activeTokenRange, onOpenWorkspaceFile),
    EditorView.domEventHandlers({
      focus: () => {
        onFocus();
        return false;
      },
      blur: () => {
        onBlur();
        return false;
      },
      paste: (event) => {
        if (!event.clipboardData || !onPasteFiles(event.clipboardData)) return false;
        event.preventDefault();
        return true;
      },
    }),
    Prec.high(EditorView.editable.of(!disabled)),
  ], [activeTokenRange, disabled, editorTheme, onBlur, onFocus, onKeyCommand, onOpenWorkspaceFile, onPasteFiles, referenceRanges]);

  useImperativeHandle(ref, () => ({
    focus: () => cmRef.current?.view?.focus(),
    blur: () => cmRef.current?.view?.contentDOM.blur(),
    setSelection: (selection: InputSelection) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const docLength = view.state.doc.length;
      const anchor = clampOffset(selection.start, docLength);
      const head = clampOffset(selection.end, docLength);
      view.dispatch({ selection: { anchor, head } });
      view.focus();
    },
    getSelection: () => {
      const view = cmRef.current?.view;
      return view ? editorSelection(view) : { start: 0, end: 0 };
    },
  }), []);

  const handleUpdate = useCallback((update: ViewUpdate) => {
    // onChange already reports the selection for document edits. Reporting it again
    // from onUpdate turns every keystroke into two React state updates, which is
    // noticeable in long conversations.
    if (!update.selectionSet || update.docChanged) return;
    onSelectionChange(editorSelection(update.view));
  }, [onSelectionChange]);

  return (
    <CodeMirror
      ref={cmRef}
      value={localValue}
      editable={!disabled}
      readOnly={disabled}
      placeholder={placeholder}
      basicSetup={composerBasicSetup}
      indentWithTab={false}
      theme="none"
      extensions={extensions}
      onChange={(nextValue, update) => {
        const nextSelection = editorSelection(update.view);
        pendingEchoValuesRef.current.add(nextValue);
        setLocalValue(nextValue);
        startTransition(() => {
          onChange(nextValue, nextSelection);
        });
      }}
      onUpdate={handleUpdate}
      className="codeburg-token-composer"
    />
  );
});

function codeburgReferenceDecorations(
  referenceRanges: CodeburgReferenceRange[],
  activeTokenRange: { from: number; to: number } | null | undefined,
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void,
): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildReferenceDecorations(view, referenceRanges, activeTokenRange, onOpenWorkspaceFile);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildReferenceDecorations(update.view, referenceRanges, activeTokenRange, onOpenWorkspaceFile);
      }
    }
  }, {
    decorations: (value) => value.decorations,
    provide: (pluginInstance) => EditorView.atomicRanges.of((view) => view.plugin(pluginInstance)?.decorations ?? Decoration.none),
  });

  return plugin;
}

function buildReferenceDecorations(
  view: EditorView,
  referenceRanges: CodeburgReferenceRange[],
  activeTokenRange: { from: number; to: number } | null | undefined,
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const docLength = view.state.doc.length;
  for (const range of referenceRanges) {
    if (range.from < 0 || range.to > docLength || range.from >= range.to) continue;
    if (activeTokenRange && rangesOverlap(range.from, range.to, activeTokenRange.from, activeTokenRange.to)) continue;
    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new CodeburgReferenceWidget(range.reference, onOpenWorkspaceFile),
        inclusive: false,
      }),
    );
  }
  return builder.finish();
}

class CodeburgReferenceWidget extends WidgetType {
  private readonly reference: CodeburgReference;
  private readonly onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;

  constructor(reference: CodeburgReference, onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void) {
    super();
    this.reference = reference;
    this.onOpenWorkspaceFile = onOpenWorkspaceFile;
  }

  eq(other: CodeburgReferenceWidget) {
    return referenceKey(this.reference) === referenceKey(other.reference);
  }

  toDOM() {
    const reference = this.reference;
    const node = document.createElement('span');
    node.className = reference.kind === 'skill'
      ? 'cm-codeburg-token cm-codeburg-token-skill'
      : 'cm-codeburg-token cm-codeburg-token-file';
    node.textContent = referenceLabel(reference);
    node.title = reference.raw;

    if (reference.kind === 'file' && this.onOpenWorkspaceFile) {
      node.dataset.clickable = 'true';
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', reference.isDirectory ? `Reveal ${reference.path} in Files` : `Open ${reference.path}`);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', (event) => {
        event.preventDefault();
        this.onOpenWorkspaceFile?.(reference.path, reference.line, reference.isDirectory);
      });
    }
    if (reference.kind === 'skill') {
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Skill ${reference.name}`);
    }

    return node;
  }

  ignoreEvent() {
    return true;
  }
}

function editorSelection(view: EditorView): InputSelection {
  const range = view.state.selection.main;
  return {
    start: Math.min(range.from, range.to),
    end: Math.max(range.from, range.to),
  };
}

function codeMirrorKeyCommand(key: string, view: EditorView, shiftKey = false): ComposerKeyCommand {
  return {
    key,
    shiftKey,
    value: view.state.doc.toString(),
    preventDefault: () => undefined,
  };
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function referenceLabel(reference: CodeburgReference): string {
  if (reference.kind === 'skill') return reference.name;
  if (reference.line) return `@${reference.path}:${reference.line}`;
  return `@${reference.path}${reference.isDirectory ? '/' : ''}`;
}

function referenceKey(reference: CodeburgReference): string {
  if (reference.kind === 'skill') return `skill:${reference.name}`;
  return `file:${reference.path}:${reference.line ?? ''}:${reference.isDirectory ? 'dir' : 'file'}`;
}
