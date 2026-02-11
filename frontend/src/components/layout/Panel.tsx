import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanelStore } from '../../stores/panel';
import { useMobile } from '../../hooks/useMobile';
import { HeaderProvider, Header } from './Header';

interface PanelProps {
  children: ReactNode;
}

export function Panel({ children }: PanelProps) {
  const { size } = usePanelStore();
  const isMobile = useMobile();
  const navigate = useNavigate();
  const effectiveSize = isMobile ? 'full' : size;
  const [mounted, setMounted] = useState(false);

  // Trigger slide-in on next frame after mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Escape key handler — close the panel
  const handleClose = useCallback(() => {
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't close if a modal overlay is open (fixed inset-0 elements)
      const modals = document.querySelectorAll('.fixed.inset-0');
      if (modals.length > 0) return;
      // Don't close if focus is in an input-like element
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Don't close if a terminal session has focus
      const target = e.target as HTMLElement;
      if (target.closest('.xterm')) return;
      handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <HeaderProvider>
        <div className={[
          'fixed inset-0 z-10 bg-canvas flex flex-col',
          'transition-transform duration-200 ease-out',
          mounted ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}>
          <Header />
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </div>
      </HeaderProvider>
    );
  }

  // Desktop: flex child alongside dashboard, slides in from the right
  return (
    <HeaderProvider>
      <div
        className={[
          'flex-shrink-0 flex flex-col bg-canvas overflow-hidden',
          'transition-[transform,opacity] duration-200 ease-out',
          mounted ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
          effectiveSize === 'full' ? 'flex-1' : 'w-[55%] max-w-3xl',
        ].join(' ')}
      >
        <Header />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </HeaderProvider>
  );
}
