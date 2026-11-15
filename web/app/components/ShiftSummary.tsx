'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import { formatPrice } from '@/lib/types';
import { useT } from '@/lib/i18n';

// Det som visas av /api/stats (samma beräkning som morgonmejlet)
interface DayStats {
  currency: string;
  guests: number;
  orders: number;
  revenue: number;
  avgFoodWaitMin: number | null;
  avgResponseMin: number | null;
  sos: number;
  reviews: { count: number; avg: number | null };
  topItems: { name: string; qty: number }[];
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());

/** "Avsluta passet": dagens siffror i ett kort. Bara visning, ingenting stängs. */
export default function ShiftSummary() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [error, setError] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  async function show() {
    setOpen(true);
    setStats(null);
    setError(false);
    try {
      const day = today();
      const res = await fetch(`/api/stats?from=${day}&to=${day}`);
      if (!res.ok) throw new Error();
      setStats(await res.json());
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const min = (n: number | null) => (n === null ? '–' : t('sum.min', { n: Math.round(n) }));
  const empty = stats && stats.guests === 0 && stats.orders === 0;

  return (
    <>
      <button type="button" onClick={show} title={t('sum.open')} className="btn btn-secondary">
        <ClipboardCheck className="h-4 w-4" />
        <span className="hidden sm:inline">{t('sum.open')}</span>
        <span className="sr-only sm:hidden">{t('sum.open')}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-3 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shift-summary-title"
            className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="shift-summary-title" className="font-display text-xl font-bold">
                {t('sum.title')}
              </h2>
              <button
                ref={close}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="btn btn-ghost btn-icon -me-2 -mt-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {t('sum.error')}
              </p>
            ) : !stats ? (
              <Loader2 className="h-6 w-6 animate-spin self-center text-muted" />
            ) : empty ? (
              <p className="text-sm text-body">{t('sum.empty')}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2">
                  <Tile label={t('sum.guests')} value={String(stats.guests)} />
                  <Tile label={t('sum.orders')} value={String(stats.orders)} />
                  {stats.revenue > 0 && (
                    <Tile label={t('sum.revenue')} value={formatPrice(stats.revenue, stats.currency)} wide />
                  )}
                  <Tile label={t('sum.foodWait')} value={min(stats.avgFoodWaitMin)} />
                  <Tile label={t('sum.response')} value={min(stats.avgResponseMin)} />
                  <Tile label={t('sum.sos')} value={String(stats.sos)} />
                  <Tile
                    label={t('sum.rating')}
                    value={stats.reviews.avg !== null ? `${stats.reviews.avg} / 5 (${stats.reviews.count})` : '–'}
                  />
                </dl>
                {stats.topItems.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold">{t('sum.top')}</p>
                    <ol className="mt-1 flex flex-col gap-1 text-sm text-body">
                      {stats.topItems.slice(0, 3).map((item) => (
                        <li key={item.name}>
                          {item.qty}× {item.name}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-muted">{t('sum.note')}</p>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-line p-3 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-bold">{value}</dd>
    </div>
  );
}
