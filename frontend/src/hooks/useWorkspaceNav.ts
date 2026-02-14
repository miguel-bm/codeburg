import { useCallback } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useMobile } from './useMobile';

/**
 * Wraps openFile/openDiff from the workspace store.
 * On mobile, auto-switches to the Sessions view (activePanel=null) after opening.
 */
export function useWorkspaceNav() {
  const { openFile: storeOpenFile, openDiff: storeOpenDiff, setActivePanel } = useWorkspaceStore();
  const isMobile = useMobile();

  const openFile = useCallback(
    (path: string, line?: number) => {
      storeOpenFile(path, line);
      if (isMobile) setActivePanel(null);
    },
    [storeOpenFile, setActivePanel, isMobile],
  );

  const openDiff = useCallback(
    (file?: string, staged?: boolean, base?: boolean, commit?: string) => {
      storeOpenDiff(file, staged, base, commit);
      if (isMobile) setActivePanel(null);
    },
    [storeOpenDiff, setActivePanel, isMobile],
  );

  return { openFile, openDiff };
}
