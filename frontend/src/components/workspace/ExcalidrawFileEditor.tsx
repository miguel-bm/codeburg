import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { parseExcalidrawFileContent } from './excalidrawFile';
import '@excalidraw/excalidraw/index.css';

const FILE_EDITOR_BACKGROUND = '#f8fafc';

interface ExcalidrawFileEditorProps {
  content: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
}

export function ExcalidrawFileEditor({ content, readOnly = false, onChange }: ExcalidrawFileEditorProps) {
  const theme = useResolvedTheme();
  const initialScene = useMemo(() => createInitialScene(content), [content]);
  const lastSerializedRef = useRef(initialScene.serialized);

  useEffect(() => {
    lastSerializedRef.current = initialScene.serialized;
  }, [initialScene.serialized]);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (readOnly) return;
    const serialized = serializeScene(elements, appState, files);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    onChange(serialized);
  }, [onChange, readOnly]);

  return (
    <div className="h-full min-h-0" style={{ backgroundColor: FILE_EDITOR_BACKGROUND }}>
      <Excalidraw
        initialData={initialScene.data}
        theme={theme}
        onChange={handleChange}
        viewModeEnabled={readOnly}
        zenModeEnabled={readOnly}
        handleKeyboardGlobally={false}
        UIOptions={{
          canvasActions: {
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}

function createInitialScene(content: string): { data: ImportedDataState; serialized: string } {
  const parsed = parseExcalidrawFileContent(content);
  const data = normalizeScene(parsed);
  return {
    data,
    serialized: serializeScene(data.elements ?? [], data.appState ?? {}, data.files ?? {}),
  };
}

function normalizeScene(data: ImportedDataState | null): ImportedDataState {
  return {
    ...data,
    appState: {
      ...data?.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: FILE_EDITOR_BACKGROUND,
    },
    scrollToContent: true,
  };
}

function serializeScene(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): string {
  return serializeAsJSON(
    elements,
    {
      ...appState,
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: FILE_EDITOR_BACKGROUND,
    },
    files,
    'local',
  );
}
