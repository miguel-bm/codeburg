import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import { useMobile } from '../../hooks/useMobile';

interface HeaderContextValue {
  headerContent: ReactNode;
  setHeaderContent: (node: ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue>({
  headerContent: null,
  setHeaderContent: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContent] = useState<ReactNode>(null);
  return (
    <HeaderContext.Provider value={{ headerContent, setHeaderContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useSetHeader(content: ReactNode, key?: string) {
  const { setHeaderContent } = useContext(HeaderContext);
  const resolvedKey = key ?? '';

  useEffect(() => {
    setHeaderContent(content);
    return () => setHeaderContent(null);
    // Re-run only when the serializable key changes, not the ReactNode reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey, setHeaderContent]);
}

export function Header() {
  const { headerContent } = useContext(HeaderContext);
  const isMobile = useMobile();

  return (
    <div className={`flex items-center h-12 px-4 gap-3 bg-canvas transition-opacity duration-150 ${isMobile ? 'pl-14' : ''}`}>
      {headerContent}
    </div>
  );
}
