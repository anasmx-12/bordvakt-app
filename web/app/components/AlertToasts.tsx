'use client';

import { useT } from '@/lib/i18n';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { AlertToast } from '@/lib/useStaffAlerts';

interface Props {
  toasts: AlertToast[];
  onDismiss: (id: string) => void;
  onSelectTable: (tableId: string) => void;
}

// Nya larm glider in uppe till höger (hela bredden på mobil)
export default function AlertToasts({ toasts, onDismiss, onSelectTable }: Props) {
  const t = useT();
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col gap-2 sm:left-auto sm:right-5 sm:top-5 sm:w-[380px]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60 }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              role={toast.urgent ? 'alert' : undefined}
              className={`pointer-events-auto flex items-center gap-3 rounded-xl p-3 text-white shadow-[0_16px_32px_-12px_rgba(15,20,25,.6)] ${
                toast.urgent ? 'bg-red-700 ring-4 ring-red-400/70 animate-pulse' : 'bg-ink'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectTable(toast.tableId);
                  onDismiss(toast.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] font-display text-[15px] font-bold ${toast.chip}`}
                >
                  {toast.tableNumber ?? '?'}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{toast.text}</span>
                  <span className={`truncate text-xs ${toast.urgent ? 'text-red-100' : 'text-gray-300'}`}>{toast.detail}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label={t('common.close')}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
