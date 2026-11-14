'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { Task } from './types';

/**
 * SOS där en tallrik med mat har tappats och köket inte har svarat än.
 * onNew anropas när ett nytt sådant SOS kommer in (för ljud).
 * Tomt om supabase/008_sos_details.sql inte är körd.
 */
export function useKitchenSos(onNew?: (task: Task) => void) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  });

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('type', 'EMERGENCY')
        .eq('kitchen_status', 'PENDING')
        .order('created_at');
      if (error) {
        if (error.code !== '42703' && error.code !== 'PGRST204') setError(error.message); // 008 saknas: inget att visa
        return;
      }
      setTasks(data as Task[]);
    }

    const channel = supabase
      .channel('bordvakt-kitchen-sos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
          return;
        }
        const row = payload.new as Task;
        const waiting = row.type === 'EMERGENCY' && row.kitchen_status === 'PENDING';
        setTasks((prev) => {
          const rest = prev.filter((t) => t.id !== row.id);
          return waiting ? [...rest, row] : rest;
        });
        if (waiting && payload.eventType === 'INSERT') onNewRef.current?.(row);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load();
      });
    load();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /** Köket svarar: laga en ny portion eller behövs inte. */
  const answer = useCallback(async (task: Task, action: 'REMAKE' | 'NOT_NEEDED') => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const res = await fetch(`/api/tasks/${task.id}/kitchen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok && res.status !== 409) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? res.statusText);
      setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
    }
  }, []);

  return { tasks, answer, error, clearError: () => setError(null) };
}
