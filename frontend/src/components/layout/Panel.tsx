import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanelStore } from '../../stores/panel';
import { useMobile } from '../../hooks/useMobile';

interface PanelProps {
  children: ReactNode;
}

export function Panel({ children }: PanelProps) {
  const { size } = usePanelStore();
  const isMobile = useMobile();
  const navigate = useNavigate();
  const effectiveSize = isMobile ? 'full' : size;
  const [mounted, setMounted] = useState(false);

  // Trigger slide-in animation on mount
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
      // Don't close if focus is in an input-like element (let the element handle it)
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  return (
    <div className="absolute inset-0 z-10 flex">
      {/* Left overlay (half mode only) — click to close */}
      {effectiveSize === 'half' && (
        <div
          className="flex-shrink-0 bg-black/20 cursor-pointer animate-fadeIn"
          style={{ width: '45%' }}
          onClick={handleClose}
        />
      )}
      {/* Panel content */}
      <div
        className={[
          'flex-1 bg-canvas overflow-auto flex flex-col',
          'transform transition-transform duration-200 ease-out',
          mounted ? 'translate-x-0' : 'translate-x-full',
          effectiveSize === 'half' ? 'shadow-panel' : '',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
