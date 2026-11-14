'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { isActiveOrder, Order, OrderItem, OrderStatus } from './types';

/**
 * Pågående beställningar i realtid.
 * onReady anropas när köket markerar en beställning som klar.
 * available = false betyder att databasen saknar orders-tabellen (003 inte körd).
 */
export function useOrders(onReady?: (order: Order) => void, onGuestOrder?: (order: Order) => void) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onReadyRef = useRef(onReady);
  const onGuestRef = useRef(onGuestOrder);
  const ordersRef = useRef(orders);
  useEffect(() => {
    onReadyRef.current = onReady;
    onGuestRef.current = onGuestOrder;
    ordersRef.current = orders;
  });

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .not('status', 'in', '(COMPLETED,CANCELLED)')
        .order('created_at');
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') setAvailable(false);
        else setError(`Kunde inte hämta beställningar: ${error.message}`);
        return;
      }
      setAvailable(true);
      setOrders(data as Order[]);
    }

    const channel = supabase
      .channel('bordvakt-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
          return;
        }
        const row = payload.new as Order;
        const before = ordersRef.current.find((o) => o.id === row.id);
        if (row.status === 'READY' && before?.status !== 'READY') onReadyRef.current?.(row);
        if (payload.eventType === 'INSERT' && row.source === 'qr') onGuestRef.current?.(row);
        setOrders((prev) => {
          const rest = prev.filter((o) => o.id !== row.id);
          return isActiveOrder(row) ? [...rest, row].sort((a, b) => a.created_at.localeCompare(b.created_at)) : rest;
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load();
      });
    load();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /** Flyttar en beställning. Visas direkt, och backas om servern säger nej. */
  const setStatus = useCallback(async (order: Order, status: OrderStatus) => {
    const optimistic = { ...order, status };
    setOrders((prev) =>
      isActiveOrder(optimistic) ? prev.map((o) => (o.id === order.id ? optimistic : o)) : prev.filter((o) => o.id !== order.id)
    );
    const res = await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Kunde inte uppdatera beställningen');
      setOrders((prev) => [...prev.filter((o) => o.id !== order.id), order].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      return false;
    }
    return true;
  }, []);

  const create = useCallback(async (tableId: string, items: OrderItem[], note: string) => {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_id: tableId, items, note }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Kunde inte spara beställningen');
      return false;
    }
    setOrders((prev) => (prev.some((o) => o.id === body.id) ? prev : [...prev, body as Order]));
    return true;
  }, []);

  return { orders, available, error, clearError: () => setError(null), setStatus, create };
}
