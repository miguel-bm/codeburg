import type { ImportedDataState } from '@excalidraw/excalidraw/data/types';

export function parseExcalidrawFileContent(content: string | null): ImportedDataState | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isExcalidrawData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isLikelyExcalidrawPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.json');
}

export function shouldOpenExcalidrawVisually(path: string, content: string | null): boolean {
  return isLikelyExcalidrawPath(path) && parseExcalidrawFileContent(content) !== null;
}

function isExcalidrawData(value: unknown): value is ImportedDataState {
  if (!value || typeof value !== 'object') return false;
  const data = value as {
    type?: unknown;
    elements?: unknown;
    appState?: unknown;
    files?: unknown;
  };
  if (data.type !== 'excalidraw') return false;
  if (data.elements !== undefined && data.elements !== null && !Array.isArray(data.elements)) return false;
  if (data.appState !== undefined && data.appState !== null && typeof data.appState !== 'object') return false;
  if (data.files !== undefined && data.files !== null && typeof data.files !== 'object') return false;
  return true;
}
