import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
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
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className={`relative w-full ${sizeMap[size]} mx-4 bg-card rounded-xl border border-subtle overflow-hidden`}
            style={{ boxShadow: 'var(--shadow-card-hover)' }}
          >
            {title && (
              <div className="px-5 py-3 border-b border-subtle flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center h-6 w-6 rounded text-dim hover:text-[var(--color-text-primary)] hover:bg-[var(--color-card-hover)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div>{children}</div>
            {footer && (
              <div className="px-5 py-3 border-t border-subtle">
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
