'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, m as motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { DiningTable, Order, ORDER_STYLE, OrderStatus } from '@/lib/types';
import { useOrders } from '@/lib/useOrders';
import { useKitchenSos } from '@/lib/useKitchenSos';
import { useStaffAlerts } from '@/lib/useStaffAlerts';
import { TriangleAlert } from 'lucide-react';
import { Key, useT } from '@/lib/i18n';
import AppShell from '../components/AppShell';
import { Eta } from '../components/TablePanel';
import { minutesLeft, usePrepTimes } from '@/lib/usePrepTimes';
import { useFeatures } from '@/lib/useFeatures';
import Banner from '../components/Banner';

const COLUMNS: { status: OrderStatus; title: Key; empty: Key; dot: string }[] = [
  { status: 'RECEIVED', title: 'kitchen.colNew', empty: 'kitchen.colNewEmpty', dot: 'bg-gray-400' },
  { status: 'PREPARING', title: 'order.PREPARING', empty: 'kitchen.colCookingEmpty', dot: 'bg-[#D97706]' },
  { status: 'READY', title: 'kitchen.colReady', empty: 'kitchen.colReadyEmpty', dot: 'bg-teal' },
];

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

const minutesSince = (iso: string, now: number | null) =>
  now === null ? null : Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

// Köksskärmen: beställningar flyttas från Nya → Tillagas → Klara.
// När köket trycker "Klar" får servitörerna larm och bordet blinkar på kartan.
export default function KitchenPage() {
  const { orders, available, error: ordersError, clearError: clearOrdersError, setStatus } = useOrders();
  const alerts = useStaffAlerts();
  const sos = useKitchenSos(() => alerts.testSound()); // tappad mat: larmljud i köket
  const error = ordersError ?? sos.error;
  const clearError = () => {
    clearOrdersError();
    sos.clearError();
  };
  const [tables, setTables] = useState<Map<string, DiningTable>>(new Map());
  const now = useNow();
  const { prep } = usePrepTimes();
  const { on } = useFeatures();
  const t = useT();

  useEffect(() => {
    supabase
      .from('tables')
      .select('*')
      .then(({ data }) => setTables(new Map(((data as DiningTable[] | null) ?? []).map((row) => [row.id, row]))));
  }, []);

  const tableNumber = (o: Pick<Order, 'table_id'>) => tables.get(o.table_id)?.table_number ?? '?';
  // Bordets senaste beställning: det är den som läggs in igen om köket lagar en ny portion
  const lastOrder = (tableId: string) =>
    orders.filter((o) => o.table_id === tableId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return (
    <AppShell
      title={t('kitchen.title')}
      subtitle={t('kitchen.subtitle')}
      actions={
        available && (
          <span className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-body">
            {t('kitchen.ongoing', { n: orders.filter((o) => o.status === 'RECEIVED' || o.status === 'PREPARING').length })}
          </span>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Banner
            role="alert"
            action={
              <button onClick={clearError} className="btn btn-ghost btn-sm">
                {t('common.close')}
              </button>
            }
          >
            {error}
          </Banner>
        </div>
      )}

      {sos.tasks.length > 0 && (
        <div className="mb-5 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {sos.tasks.map((task) => {
              const order = lastOrder(task.table_id);
              return (
                <motion.article
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  role="alert"
                  className="flex flex-wrap items-center gap-4 rounded-xl border-2 border-red-700 bg-red-50 p-4"
                >
                  <TriangleAlert className="h-8 w-8 flex-none animate-pulse text-red-700" strokeWidth={2.2} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-display text-xl font-bold text-red-900">
                      {t('kitchen.sosTitle', { n: tableNumber(task) })}
                    </span>
                    <span className="text-[15px] text-body">
                      {order
                        ? order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')
                        : t('kitchen.sosNoOrder')}
                    </span>
                  </div>
                  <div className="flex flex-none gap-2">
                    <button onClick={() => sos.answer(task, 'NOT_NEEDED')} className="btn btn-lg btn-secondary">
                      {t('kitchen.notNeeded')}
                    </button>
                    <button onClick={() => sos.answer(task, 'REMAKE')} className="btn btn-lg btn-primary">
                      {t(order ? 'kitchen.remake' : 'kitchen.remakeNoOrder')}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {!available ? (
        <p className="card p-6 text-body">
          {t('panel.ordersOff')} <code className="font-semibold">supabase/003_orders_and_decor.sql</code>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = orders.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className="flex flex-col gap-3 rounded-xl bg-[#EEECE6]/60 p-3">
                <h2 className="flex items-center justify-between px-1 pt-1 text-[15px] font-semibold">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                    {t(col.title)}
                  </span>
                  <span className="min-w-7 rounded-full bg-white px-2 py-0.5 text-center text-[13px] font-bold">
                    {list.length}
                  </span>
                </h2>
                {list.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-muted">
                    {t(col.empty)}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {list.map((order) => {
                    const age = minutesSince(order.created_at, now);
                    // Sen = längre än rätterna brukar ta (eller 20 min om det inte är känt än)
                    const left = now === null || !on('prep_times') ? null : minutesLeft(order, prep, now);
                    const late = order.status !== 'READY' && (left !== null ? left < 0 : age !== null && age >= 20);
                    return (
                      <motion.article
                        key={order.id}
                        layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={`card flex flex-col gap-3 p-4 ${
                          late
                            ? 'border-red-300 ring-1 ring-red-300'
                            : order.status === 'READY'
                              ? 'border-[#9FD0C8]'
                              : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display text-2xl font-bold leading-none">
                            {t('common.table', { n: tableNumber(order) })}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums ${
                              late ? 'bg-red-50 text-red-700' : 'bg-paper text-muted'
                            }`}
                          >
                            {age === null ? '' : age < 1 ? t('kitchen.now') : t('kitchen.min', { n: age })}
                          </span>
                        </div>
                        <ul className="flex flex-col gap-1 text-[15px]">
                          {order.items.map((item, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="w-7 flex-none font-bold">{item.qty}×</span>
                              <span>{item.name}</span>
                            </li>
                          ))}
                        </ul>
                        <Eta left={left} />
                        {order.note && (
                          <p className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-sm text-[#92400E]">{order.note}</p>
                        )}
                        {order.status === 'RECEIVED' && (
                          <button
                            onClick={() => setStatus(order, 'PREPARING')}
                            className="btn btn-lg btn-secondary w-full"
                          >
                            {t('order.next.RECEIVED')}
                          </button>
                        )}
                        {order.status === 'PREPARING' && (
                          <button onClick={() => setStatus(order, 'READY')} className="btn btn-lg btn-success w-full">
                            {t('kitchen.readyCall')}
                          </button>
                        )}
                        {order.status === 'READY' && (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ORDER_STYLE.READY.chip}`}
                            >
                              {t('kitchen.waiterAlerted')}
                            </span>
                            <button onClick={() => setStatus(order, 'PREPARING')} className="btn btn-ghost btn-sm">
                              {t('common.undo')}
                            </button>
                          </div>
                        )}
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
