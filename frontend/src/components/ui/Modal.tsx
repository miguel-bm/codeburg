import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-[oklch(18%_0.01_250)]/55 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className={`relative flex w-full flex-col ${sizeMap[size]} border border-subtle bg-card overflow-hidden ${
              size === 'xl'
                ? 'h-[100dvh] rounded-none sm:mx-4 sm:h-auto sm:rounded-xl'
                : 'mx-4 rounded-xl'
            }`}
            style={{ boxShadow: 'var(--shadow-card-hover)' }}
          >
            {title && (
              <div className="px-4 py-3 border-b border-subtle flex items-center justify-between sm:px-5">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center h-6 w-6 rounded text-dim hover:text-[var(--color-text-primary)] hover:bg-[var(--color-card-hover)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className={size === 'xl' ? 'min-h-0 flex-1' : undefined}>{children}</div>
            {footer && (
              <div className="px-4 py-3 border-t border-subtle sm:px-5">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
