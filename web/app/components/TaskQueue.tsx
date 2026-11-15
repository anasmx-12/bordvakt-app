'use client';

import { useEffect, useState } from 'react';
import { m as motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { BellRing, CameraOff, CheckCircle2, ChevronRight, PauseCircle } from 'lucide-react';
import { DiningTable, Order, orderSummary, Task, TASK_STYLE } from '@/lib/types';
import { TFunction, translateIssue, useT } from '@/lib/i18n';
import { sosSummary } from '@/lib/sos';

interface Props {
  tasks: Task[];
  tables: DiningTable[];
  selectedTableId: string | null;
  /** false = kameran ger ingen bild eller AI-analysen är avstängd */
  monitoring: boolean;
  /** falseAlarm = personalen säger att SOS eller Vill ha hjälp var ett falsklarm (AI:n lär sig) */
  onComplete: (id: string, falseAlarm?: boolean) => void;
  onSelectTable?: (id: string | null) => void;
  /** Beställningar som köket gjort klara: ska bäras ut */
  readyOrders: Order[];
  onServe: (order: Order) => void;
  /** QR-beställningar som personalen ska godkänna eller neka */
  pendingOrders?: Order[];
  onApprove?: (order: Order, approve: boolean) => void;
  /** Bord som bevakas men som kameran inte ser just nu */
  blindTables?: DiningTable[];
}

// Uppdaterar "för X min sedan" var 30:e sekund
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

function timeAgo(iso: string, now: number | null, t: TFunction) {
  if (now === null) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('common.justNow');
  if (minutes < 60) return t('common.minAgo', { n: minutes });
  return t('common.hAgo', { n: Math.floor(minutes / 60) });
}

const ENTER = {
  layout: true,
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 60 },
  transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as const },
};

export default function TaskQueue({
  tasks,
  tables,
  selectedTableId,
  monitoring,
  onComplete,
  onSelectTable,
  readyOrders,
  onServe,
  pendingOrders = [],
  onApprove,
  blindTables = [],
}: Props) {
  const now = useNow();
  const t = useT();
  const tableById = new Map(tables.map((row) => [row.id, row]));

  // Viktigast först (söker kontakt → mat → avdukning → dessert), sedan äldst först
  const sorted = [...tasks].sort((a, b) => {
    const byPriority = TASK_STYLE[a.type].priority - TASK_STYLE[b.type].priority;
    return byPriority || a.created_at.localeCompare(b.created_at);
  });

  // Klar mat först (den ska ut medan den är varm), äldst först
  const ready = [...readyOrders].sort((a, b) =>
    (a.ready_at ?? a.updated_at).localeCompare(b.ready_at ?? b.updated_at)
  );
  const total = sorted.length + ready.length + pendingOrders.length;
  const select = (tableId: string) => onSelectTable?.(tableId === selectedTableId ? null : tableId);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="font-display text-[17px] font-bold">{t('tasks.title')}</h2>
        <span
          className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[13px] font-bold ${
            total > 0 ? 'bg-ink text-white' : 'bg-paper text-muted'
          }`}
        >
          {total}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {blindTables.length > 0 && (
          <Link
            href="/setup?step=calibrate"
            className="group flex items-center gap-3 rounded-lg border border-dashed border-gray-400 bg-gray-50 p-3 hover:border-ink"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gray-700 text-white">
              <CameraOff className="h-[18px] w-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">
                {t('tasks.blind', { list: blindTables.map((row) => row.table_number).join(', ') })}
              </span>
              <span className="truncate text-xs text-muted">{translateIssue(t, blindTables[0].camera_issue) || t('tasks.checkCamera')}</span>
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-muted group-hover:text-ink" />
          </Link>
        )}

        <AnimatePresence initial={false} mode="popLayout">
          {pendingOrders.map((order) => {
            const table = tableById.get(order.table_id);
            return (
              <motion.div
                key={`pending-${order.id}`}
                {...ENTER}
                className={`flex flex-wrap items-center gap-3 rounded-lg border border-violet-300 bg-violet-50 p-3 ${
                  order.table_id === selectedTableId ? 'ring-2 ring-ink' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(order.table_id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-violet-700 font-display text-base font-bold text-white">
                    {table?.table_number ?? '?'}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-ink">
                      {t('alert.qrApprove', { n: table?.table_number ?? '?' })}
                    </span>
                    <span className="truncate text-xs text-body">
                      {orderSummary(order, t('order.empty'))}
                      {order.note && ` · ${order.note}`}
                    </span>
                  </span>
                </button>
                <div className="flex flex-none gap-2">
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => onApprove?.(order, false)} className="btn btn-ghost">
                    {t('panel.reject')}
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => onApprove?.(order, true)} className="btn btn-success">
                    {t('order.next.PENDING_APPROVAL')}
                  </motion.button>
                </div>
              </motion.div>
            );
          })}

          {ready.map((order) => {
            const table = tableById.get(order.table_id);
            const selected = order.table_id === selectedTableId;
            return (
              <motion.div
                key={`order-${order.id}`}
                {...ENTER}
                className={`flex items-center gap-3 rounded-lg border border-[#9FD0C8] bg-teal-light p-3 ${
                  selected ? 'ring-2 ring-ink' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(order.table_id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="relative flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-teal font-display text-base font-bold text-white">
                    {table?.table_number ?? '?'}
                    <BellRing
                      className="absolute -right-1.5 -top-1.5 h-[18px] w-[18px] rounded-full bg-white p-0.5 text-teal"
                      strokeWidth={2.5}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-ink">{t('tasks.foodReady')}</span>
                    <span className="truncate text-xs text-[#1F3B38]">
                      {orderSummary(order, t('order.empty'))}
                      {order.ready_at && ` · ${timeAgo(order.ready_at, now, t)}`}
                    </span>
                  </span>
                </button>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => onServe(order)} className="btn btn-success">
                  {t('order.next.READY')}
                </motion.button>
              </motion.div>
            );
          })}

          {sorted.map((task, index) => {
            const table = tableById.get(task.table_id);
            const style = TASK_STYLE[task.type];
            const first = index === 0 && ready.length === 0;
            const selected = task.table_id === selectedTableId;
            const dessert = task.type === 'DESSERT';
            const sos = task.type === 'EMERGENCY';
            const bill = task.type === 'BILL';
            return (
              <motion.div
                key={task.id}
                {...ENTER}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
                  sos
                    ? 'border-2 border-red-700 bg-red-100'
                    : dessert
                      ? 'border-accent-light/70 bg-dessert-light/60'
                      : bill ? 'border-violet-200 bg-violet-50/70' : 'border-red-200 bg-red-50/60'
                } ${selected ? 'ring-2 ring-ink' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => select(task.table_id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg font-display text-base font-bold ${style.chip} ${
                      sos ? 'animate-pulse' : ''
                    }`}
                  >
                    {table?.table_number ?? '?'}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-ink">
                      {t(`task.${task.type}`, { n: table?.table_number ?? '?' })}
                    </span>
                    {sos && sosSummary(task, t) && (
                      <span className="text-xs font-semibold text-red-800">{sosSummary(task, t)}</span>
                    )}
                    <span className="text-xs text-muted">{timeAgo(task.created_at, now, t)}</span>
                  </span>
                </button>
                <div className="flex flex-none gap-2">
                  {(sos || task.type === 'SERVICE') && (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onComplete(task.id, true)}
                      className="btn btn-ghost btn-sm"
                    >
                      {t('sos.falseAlarm')}
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onComplete(task.id)}
                    className={`btn ${first || sos ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {t('common.done')}
                  </motion.button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {total === 0 &&
          (monitoring ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <CheckCircle2 className="h-9 w-9 text-teal" strokeWidth={1.8} />
              <p className="font-display text-[17px] font-bold">{t('tasks.allGood')}</p>
              <p className="text-sm text-muted">{t('tasks.allGoodText')}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <PauseCircle className="h-9 w-9 text-gray-400" strokeWidth={1.8} />
              <p className="font-display text-[17px] font-bold">{t('tasks.paused')}</p>
              <p className="text-sm text-muted">{t('tasks.pausedText')}</p>
            </div>
          ))}
      </div>
    </section>
  );
}
