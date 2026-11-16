'use client';

import { useState } from 'react';
import { AnimatePresence, m as motion } from 'framer-motion';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import {
  DiningTable,
  Order,
  ORDER_FLOW,
  ORDER_STYLE,
  OrderItem,
  OrderStatus,
  orderSummary,
  STATUS_STYLE,
} from '@/lib/types';
import { translateIssue, useT } from '@/lib/i18n';
import { useMenu } from '@/lib/useMenu';
import { minutesLeft, usePrepTimes } from '@/lib/usePrepTimes';
import RedeemCode from './RedeemCode';
import { useFeatures } from '@/lib/useFeatures';

interface Props {
  table: DiningTable;
  live: boolean;
  orders: Order[];
  ordersAvailable: boolean;
  onClose: () => void;
  onCreate: (tableId: string, items: OrderItem[], note: string) => Promise<boolean>;
  onSetStatus: (order: Order, status: OrderStatus) => void;
}

const nextStatus = (s: OrderStatus): OrderStatus | null => {
  const i = ORDER_FLOW.indexOf(s);
  return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null;
};

/** Valt bord: status, pågående beställningar och ny beställning. */
export default function TablePanel({ table, live, orders, ordersAvailable, onClose, onCreate, onSetStatus }: Props) {
  const t = useT();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const status = STATUS_STYLE[table.status];
  // Finns en meny föreslås rätterna när personalen skriver (fritext går fortfarande)
  const menu = useMenu();
  const dishes = menu.items.filter((i) => i.available);
  const { prep, now } = usePrepTimes();
  const { on } = useFeatures();

  function addItem() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const dish = dishes.find((d) => d.name.toLowerCase() === trimmed.toLowerCase());
    setItems((prev) => {
      const same = prev.find((i) => i.name.toLowerCase() === trimmed.toLowerCase());
      return same
        ? prev.map((i) => (i === same ? { ...i, qty: Math.min(99, i.qty + 1) } : i))
        : [...prev, dish ? { name: dish.name, qty: 1, price: dish.price, menu_item_id: dish.id } : { name: trimmed, qty: 1 }];
    });
    setName('');
  }

  async function submit() {
    if (items.length === 0 || saving) return;
    setSaving(true);
    const ok = await onCreate(table.id, items, note);
    setSaving(false);
    if (ok) {
      setItems([]);
      setNote('');
    }
  }

  return (
    <section className="card overflow-hidden" aria-label={t('common.table', { n: table.table_number })}>
      <div className="flex items-start justify-between gap-3 border-b border-line-soft bg-paper-soft px-4 py-3.5">
        <div>
          <h2 className="font-display text-[22px] font-bold leading-tight">{t('common.table', { n: table.table_number })}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-body">
            {live ? (
              <>
                <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                {t(`status.${table.status}`)}
              </>
            ) : (
              <span className="text-muted">{t('panel.noMonitoring')}</span>
            )}
            {table.seats ? <span className="text-muted"> · {t('panel.seats', { n: table.seats })}</span> : null}
          </p>
          {live && table.status === 'CAMERA_BLIND' && table.camera_issue && (
            <p className="mt-1 text-xs text-gray-600">{translateIssue(t, table.camera_issue)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('panel.closeTable')}
          className="btn btn-ghost btn-icon -mr-2 -mt-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {!ordersAvailable ? (
          <p className="rounded-lg bg-paper p-3 text-sm text-body">
            {t('panel.ordersOff')}{' '}
            <code className="font-semibold">supabase/003_orders_and_decor.sql</code> i Supabase SQL Editor.
          </p>
        ) : (
          <>
            {/* Pågående beställningar */}
            <div className="flex flex-col gap-2">
              <p className="eyebrow">{t('panel.orders')}</p>
              {orders.length === 0 && <p className="text-sm text-muted">{t('panel.noOrders')}</p>}
              <AnimatePresence initial={false}>
                {orders.map((order) => {
                  const next = nextStatus(order.status);
                  const style = ORDER_STYLE[order.status];
                  const ready = order.status === 'READY';
                  return (
                    <motion.div
                      key={order.id}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 40 }}
                      className={`flex flex-col gap-2.5 rounded-lg border p-3 ${ready ? 'border-[#1D5A55] bg-teal-light' : 'border-line'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{orderSummary(order, t('order.empty'))}</p>
                        <span className="flex flex-none items-center gap-1">
                          {order.source === 'qr' && (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                              {t('panel.viaQr')}
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
                            {t(`order.${order.status}`)}
                          </span>
                        </span>
                      </div>
                      {order.note && <p className="text-xs text-body">{t('panel.note', { note: order.note })}</p>}
                      {on('prep_times') && <Eta left={minutesLeft(order, prep, now)} />}
                      {/* Steg: Mottagen → Tillagas → Klar → Serverad → Avslutad */}
                      <ol className="flex gap-1" aria-label={t('panel.progress')}>
                        {ORDER_FLOW.map((s) => (
                          <li
                            key={s}
                            title={t(`order.${s}`)}
                            className={`h-1.5 flex-1 rounded-full ${
                              ORDER_FLOW.indexOf(s) <= ORDER_FLOW.indexOf(order.status) ? 'bg-teal' : 'bg-line'
                            }`}
                          />
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-2">
                        {order.status === 'PENDING_APPROVAL' && (
                          <>
                            <button type="button" onClick={() => onSetStatus(order, 'RECEIVED')} className="btn btn-success">
                              {t('order.next.PENDING_APPROVAL')}
                            </button>
                            <button type="button" onClick={() => onSetStatus(order, 'CANCELLED')} className="btn btn-ghost">
                              {t('panel.reject')}
                            </button>
                          </>
                        )}
                        {next && (
                          <button
                            type="button"
                            onClick={() => onSetStatus(order, next)}
                            className={`btn ${ready ? 'btn-success' : 'btn-secondary'}`}
                          >
                            {t(`order.next.${order.status as 'RECEIVED' | 'PREPARING' | 'READY' | 'SERVED'}`)}
                          </button>
                        )}
                        {order.status === 'RECEIVED' && (
                          <button
                            type="button"
                            onClick={() => onSetStatus(order, 'CANCELLED')}
                            className="btn btn-ghost"
                          >
                            {t('panel.cancelOrder')}
                          </button>
                        )}
                        {order.status === 'SERVED' && on('waste') && <ReturnedButton orderId={order.id} />}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Ny beställning */}
            <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
              <p className="eyebrow">{t('panel.newOrder')}</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addItem();
                }}
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('panel.dishPlaceholder')}
                  maxLength={80}
                  aria-label={t('panel.dish')}
                  list={dishes.length ? `menu-${table.id}` : undefined}
                  className="field min-w-0 flex-1"
                />
                {dishes.length > 0 && (
                  <datalist id={`menu-${table.id}`}>
                    {dishes.map((d) => (
                      <option key={d.id} value={d.name} />
                    ))}
                  </datalist>
                )}
                <button type="submit" disabled={!name.trim()} className="btn btn-secondary min-h-11">
                  <Plus className="h-4 w-4" /> {t('panel.add')}
                </button>
              </form>

              {items.length > 0 && (
                <ul className="flex flex-col divide-y divide-line-soft rounded-lg border border-line">
                  {items.map((item, idx) => (
                    <li key={item.name} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <button
                        type="button"
                        aria-label={t('panel.fewer', { name: item.name })}
                        onClick={() =>
                          setItems((prev) =>
                            prev.flatMap((i, j) => (j !== idx ? [i] : i.qty > 1 ? [{ ...i, qty: i.qty - 1 }] : [])),
                          )
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-paper"
                      >
                        {item.qty > 1 ? <Minus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                      <span className="w-5 text-center font-semibold">{item.qty}</span>
                      <button
                        type="button"
                        aria-label={t('panel.more', { name: item.name })}
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((i, j) => (j === idx ? { ...i, qty: Math.min(99, i.qty + 1) } : i)),
                          )
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-paper"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('panel.notePlaceholder')}
                maxLength={300}
                aria-label={t('panel.notePlaceholder')}
                className="field"
              />
              <button
                type="button"
                onClick={submit}
                disabled={items.length === 0 || saving}
                className="btn btn-accent min-h-11"
              >
                {saving
                  ? t('panel.sending')
                  : items.length
                    ? t('panel.sendCount', { n: items.reduce((n, i) => n + i.qty, 0) })
                    : t('panel.send')}
              </button>
            </div>
          </>
        )}
      </div>
      {menu.items.length > 0 && on('loyalty') && <RedeemCode />}
    </section>
  );
}

/** "Klar om ca 8 min" eller "4 min sen", utifrån hur länge rätterna brukar ta. */
export function Eta({ left }: { left: number | null }) {
  const t = useT();
  if (left === null) return null;
  return left >= 0 ? (
    <p className="text-xs text-muted">{t('panel.eta', { n: Math.max(1, left) })}</p>
  ) : (
    <p className="text-xs font-semibold text-red-700">{t('panel.late', { n: -left })}</p>
  );
}

/** Maten kom tillbaka från bordet: räknas som svinn, och köket kan laga en ny portion. */
function ReturnedButton({ orderId }: { orderId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function send(remake: boolean) {
    const res = await fetch(`/api/orders/${orderId}/returned`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remake }) });
    const body = await res.json().catch(() => ({}));
    setDone(res.ok ? t(remake ? 'panel.returnedRemake' : 'panel.returnedSaved') : (body.error ?? t('panel.returnedFail')));
    setOpen(false);
  }

  if (done) return <span className="self-center text-xs font-semibold text-muted">{done}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost">
        {t('panel.returned')}
      </button>
    );
  }
  return (
    <>
      <button type="button" onClick={() => send(true)} className="btn btn-secondary">
        {t('panel.returnedNew')}
      </button>
      <button type="button" onClick={() => send(false)} className="btn btn-ghost">
        {t('panel.returnedOnly')}
      </button>
    </>
  );
}
