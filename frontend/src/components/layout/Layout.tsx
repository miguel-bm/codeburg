import type { ReactNode } from 'react';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { useMobile } from '../../hooks/useMobile';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-primary">
      {/* Mobile hamburger button */}
      {isMobile && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-40 p-2 border border-subtle bg-secondary hover:border-accent transition-colors"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 4h16v2H2V4zm0 5h16v2H2V9zm0 5h16v2H2v-2z" />
          </svg>
        </button>
      )}

      {/* Sidebar - always visible on desktop, overlay on mobile */}
      {isMobile ? (
        <>
          {/* Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-[var(--color-bg-primary)]/80 z-40"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* Sliding sidebar */}
          <div
            className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </>
      ) : (
        <Sidebar />
      )}

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
