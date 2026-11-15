'use client';

import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { STATUS_STYLE } from '@/lib/types';
import { Key, useT } from '@/lib/i18n';

/** Färgerna på kartan, viktigast först, med vad personalen ska göra. */
export const LEGEND: { label: Key; action: Key; className: string }[] = [
  { label: 'status.EMERGENCY', action: 'guide.EMERGENCY', className: 'bg-red-800 ring-2 ring-red-400' },
  { label: 'map.legendAlert', action: 'guide.alert', className: 'bg-red-500' },
  { label: 'status.WANTS_BILL', action: 'guide.WANTS_BILL', className: 'bg-violet-600' },
  { label: 'status.DESSERT_OPPORTUNITY', action: 'guide.DESSERT', className: 'bg-dessert' },
  { label: 'map.legendFoodReady', action: 'guide.food', className: 'bg-teal' },
  { label: 'status.OCCUPIED', action: 'guide.OCCUPIED', className: 'bg-blue-100 border border-blue-300' },
  { label: 'status.AVAILABLE', action: 'guide.AVAILABLE', className: 'bg-teal-light border border-[#7DBDB4]' },
  { label: 'status.CAMERA_BLIND', action: 'guide.BLIND', className: STATUS_STYLE.CAMERA_BLIND.table },
];

const SEEN = 'bordvakt.colorGuideSeen';

function seen() {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true; // utan lagring: visa den inte varje gång
  }
}

/** Legenden under kartan, med en "?"-knapp. Första gången på en enhet öppnas förklaringen av sig själv. */
export default function ColorGuide() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!seen()) setOpen(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    ok.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, '1');
    } catch {}
  }

  return (
    <>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-soft pt-3">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-3 w-3 rounded-[4px] ${item.className}`} />
            {t(item.label)}
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-body hover:bg-paper"
          >
            <HelpCircle className="h-4 w-4" /> {t('guide.open')}
          </button>
        </li>
      </ul>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-3 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="color-guide-title"
            className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="color-guide-title" className="font-display text-xl font-bold">
                {t('guide.title')}
              </h2>
              <button type="button" onClick={close} aria-label={t('guide.ok')} className="btn btn-ghost btn-icon -me-2 -mt-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-body">{t('guide.intro')}</p>
            <ul className="flex flex-col gap-2.5">
              {LEGEND.map((item) => (
                <li key={item.label} className="flex items-start gap-3">
                  <span className={`mt-0.5 h-6 w-6 flex-none rounded-md ${item.className}`} />
                  <span className="text-sm">
                    <strong className="block">{t(item.label)}</strong>
                    <span className="text-body">{t(item.action)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button ref={ok} type="button" onClick={close} className="btn btn-primary btn-lg mt-1">
              {t('guide.ok')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
