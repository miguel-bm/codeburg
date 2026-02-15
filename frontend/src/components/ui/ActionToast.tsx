import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type ActionToastType = 'success' | 'error' | 'warning';

interface ActionToastProps {
  toast: { type: ActionToastType; message: string } | null;
  title?: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ActionToast({ toast, title, onDismiss, autoDismissMs = 4200 }: ActionToastProps) {
  useEffect(() => {
    if (!toast || autoDismissMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [toast, autoDismissMs, onDismiss]);

  const tone = toast?.type ?? 'error';
  const isSuccess = tone === 'success';
  const isWarning = tone === 'warning';
  const resolvedTitle = title ?? (isSuccess ? 'Updated' : isWarning ? 'Warning' : 'Action Failed');

  return createPortal(
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className={`pointer-events-auto fixed top-3 right-3 z-[220] max-w-[460px] rounded-xl border backdrop-blur px-3 py-2.5 shadow-lg ${
            isSuccess
              ? 'bg-[var(--color-success)]/12 border-[var(--color-success)]/30 text-[var(--color-success)]'
              : isWarning
                ? 'bg-[var(--color-warning,#b8860b)]/10 border-[var(--color-warning,#b8860b)]/30 text-[var(--color-warning,#b8860b)]'
                : 'bg-[var(--color-error)]/12 border-[var(--color-error)]/35 text-[var(--color-error)]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div className="pt-0.5">
              {isSuccess ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide opacity-80 mb-0.5">{resolvedTitle}</div>
              <div className="text-xs leading-snug break-words text-[var(--color-text-primary)]">{toast.message}</div>
            </div>
            <button
              onClick={onDismiss}
              className="shrink-0 mt-0.5 rounded p-0.5 text-dim hover:text-[var(--color-text-primary)] hover:bg-[var(--color-card)] transition-colors"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
