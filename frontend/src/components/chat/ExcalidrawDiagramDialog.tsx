import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types';
import type { PiConversationImageAttachment } from '../../api/types';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import '@excalidraw/excalidraw/index.css';

const EXPORT_BACKGROUND = '#f8fafc';

export interface ExcalidrawDiagramSource {
  type: 'excalidraw';
  data: string;
}

export interface DiagramAttachmentResult {
  name: string;
  previewUrl: string;
  image: PiConversationImageAttachment;
  source: ExcalidrawDiagramSource;
}

interface ExcalidrawDiagramDialogProps {
  initialSource?: ExcalidrawDiagramSource;
  onAttach: (result: DiagramAttachmentResult) => void;
  onClose: () => void;
}

export function ExcalidrawDiagramDialog({
  initialSource,
  onAttach,
  onClose,
}: ExcalidrawDiagramDialogProps) {
  const theme = useResolvedTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialData = useMemo(() => {
    const base: ImportedDataState = {
      appState: {
        currentItemStrokeColor: '#1f2937',
        viewBackgroundColor: EXPORT_BACKGROUND,
        exportBackground: true,
        exportWithDarkMode: false,
      },
      scrollToContent: true,
    };
    if (!initialSource?.data) return base;

    try {
      const parsed = JSON.parse(initialSource.data) as ImportedDataState;
      return {
        ...parsed,
        appState: {
          ...parsed.appState,
          viewBackgroundColor: EXPORT_BACKGROUND,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        scrollToContent: true,
      };
    } catch {
      return base;
    }
  }, [initialSource?.data]);

  const attachDiagram = async () => {
    const api = apiRef.current;
    if (!api || exporting) return;

    setError(null);
    setExporting(true);

    try {
      const elements = api.getSceneElements();
      if (elements.length === 0) {
        setError('Draw something before attaching the diagram.');
        return;
      }

      const appState = api.getAppState();
      const files = api.getFiles();
      const exportAppState: Partial<AppState> = {
        ...appState,
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: EXPORT_BACKGROUND,
      };
      const blob = await exportToBlob({
        elements,
        appState: exportAppState,
        files,
        maxWidthOrHeight: 1600,
        mimeType: 'image/png',
        exportPadding: 18,
      });
      const previewUrl = await blobToDataUrl(blob);
      const [, data = ''] = previewUrl.split(',', 2);
      const source = serializeAsJSON(
        api.getSceneElementsIncludingDeleted(),
        exportAppState,
        files,
        'local',
      );

      onAttach({
        name: diagramFileName(),
        previewUrl,
        image: {
          type: 'image',
          data,
          mimeType: 'image/png',
        },
        source: {
          type: 'excalidraw',
          data: source,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach diagram.');
    } finally {
      setExporting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-primary text-[var(--color-text-primary)]" role="dialog" aria-modal="true" aria-label="Sketch diagram">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-subtle bg-card px-3 shadow-card">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Sketch diagram</div>
          <div className="hidden text-[11px] text-dim sm:block">Attach exports a PNG into the composer.</div>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <div className="hidden max-w-[22rem] items-center gap-1.5 truncate rounded-md bg-[var(--color-error)]/10 px-2 py-1 text-xs text-[var(--color-error)] md:inline-flex">
              <AlertCircle size={13} />
              <span className="truncate">{error}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void attachDiagram(); }}
            disabled={exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-[oklch(0.98_0.004_265)] hover:bg-accent-dim disabled:opacity-60"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : null}
            Attach
          </button>
        </div>
      </header>
      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)] md:hidden">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 bg-[var(--color-canvas)] p-2 sm:p-3">
        <div className="h-full overflow-hidden rounded-xl border border-subtle bg-card shadow-card">
          <Excalidraw
            excalidrawAPI={(api) => { apiRef.current = api; }}
            initialData={initialData}
            theme={theme}
            autoFocus
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
      </div>
    </div>,
    document.body,
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read diagram image'));
    reader.readAsDataURL(blob);
  });
}

function diagramFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `diagram-${stamp}.png`;
}
