import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { isDesktopShell } from '../../platform/runtimeConfig';
import type { ExcalidrawDiagramSource } from './ExcalidrawDiagramDialog';
import '@excalidraw/excalidraw/index.css';

const VIEWER_BACKGROUND = '#f8fafc';

interface ExcalidrawDiagramViewerDialogProps {
  source: ExcalidrawDiagramSource;
  onClose: () => void;
}

export function ExcalidrawDiagramViewerDialog({ source, onClose }: ExcalidrawDiagramViewerDialogProps) {
  const theme = useResolvedTheme();
  const desktopShell = isDesktopShell();
  const headerClassName = [
    'flex h-12 shrink-0 items-center justify-between border-b border-subtle bg-card shadow-card',
    desktopShell ? 'desktop-drag-region pl-[72px] pr-3' : 'px-3',
  ].join(' ');

  const initialData = useMemo((): ImportedDataState => {
    try {
      const parsed = JSON.parse(source.data) as ImportedDataState;
      return {
        ...parsed,
        appState: {
          ...parsed.appState,
          viewBackgroundColor: VIEWER_BACKGROUND,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        scrollToContent: true,
      };
    } catch {
      return {
        appState: {
          viewBackgroundColor: VIEWER_BACKGROUND,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        scrollToContent: true,
      };
    }
  }, [source.data]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col bg-primary text-[var(--color-text-primary)]" role="dialog" aria-modal="true" aria-label="Diagram preview">
      <header className={headerClassName}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Diagram preview</div>
          <div className="hidden text-[11px] text-dim sm:block">Read-only Excalidraw scene.</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
          title="Close preview"
          aria-label="Close preview"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1" style={{ backgroundColor: VIEWER_BACKGROUND }}>
        <Excalidraw
          initialData={initialData}
          theme={theme}
          viewModeEnabled
          zenModeEnabled
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
    </div>,
    document.body,
  );
}
