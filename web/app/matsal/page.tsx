'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CameraFeed, DiningTable, Task } from '@/lib/types';
import { monitoringProblem, useEngineStatus } from '@/lib/useEngineStatus';
import { useFloorPlan } from '@/lib/useFloorPlan';
import { useStaffAlerts } from '@/lib/useStaffAlerts';
import { useOrders } from '@/lib/useOrders';
import DashboardView from '../components/DashboardView';
import OfflineNotice from '../components/OfflineNotice';
import ShiftSummary from '../components/ShiftSummary';
import InstallCard from '../components/InstallCard';
import { useKeepAwake } from '@/lib/useDevice';
import { useFeatures } from '@/lib/useFeatures';
import { useOfflineQueue } from '@/lib/useOfflineQueue';
import { translate, useT } from '@/lib/i18n';
import { getSettings } from '@/lib/settings';

// Lägger till eller ersätter en rad med samma id
function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  return list.some((r) => r.id === row.id)
    ? list.map((r) => (r.id === row.id ? row : r))
    : [...list, row];
}

const byTableNumber = (a: DiningTable, b: DiningTable) => a.table_number - b.table_number;

export default function Dashboard() {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cameras, setCameras] = useState<CameraFeed[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState<'lunch' | 'evening' | null>(null);
  const t = useT();
  const { plan } = useFloorPlan();
  const alerts = useStaffAlerts();
  const queue = useOfflineQueue(isConnected);
  const features = useFeatures();
  useKeepAwake();

  // Realtidslyssnaren skapas en gång, så den läser senaste borden och larmfunktionen via refs
  const tablesRef = useRef(tables);
  const notifyRef = useRef(alerts.notify);
  const blindNotifyRef = useRef(alerts.notifyCameraBlind);
  const dismissRef = useRef(alerts.dismiss);
  useEffect(() => {
    tablesRef.current = tables;
    notifyRef.current = alerts.notify;
    dismissRef.current = alerts.dismiss;
    blindNotifyRef.current = alerts.notifyCameraBlind;
  });

  const orders = useOrders(
    (order) => {
      const table = tablesRef.current.find((t) => t.id === order.table_id);
      alerts.notifyOrderReady(order, table?.table_number ?? null);
    },
    (order) => {
      const table = tablesRef.current.find((t) => t.id === order.table_id);
      alerts.notifyGuestOrder(order, table?.table_number ?? null);
    },
    (orderId) => queue.push({ kind: 'serve', id: orderId })
  );

  // Klockan får bara läsas i webbläsaren, inte när sidan renderas
  useEffect(() => {
    const update = () => setShift(new Date().getHours() < 15 ? 'lunch' : 'evening');
    const timer = setInterval(update, 60_000);
    const first = setTimeout(update, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);

  useEffect(() => {
    async function load() {
      const [tablesRes, tasksRes, camerasRes] = await Promise.all([
        supabase.from('tables').select('*').order('table_number'),
        supabase.from('tasks').select('*').eq('status', 'PENDING'),
        supabase.from('camera_feeds').select('*').order('created_at'),
      ]);
      const failed = tablesRes.error ?? tasksRes.error ?? camerasRes.error;
      if (failed) {
        setError(
          failed.code === 'PGRST205'
            ? 'Databastabellerna saknas. Kör filerna i mappen supabase/ i Supabase → SQL Editor och ladda om sidan.'
            : translate(getSettings().language, 'dash.loadError', { msg: failed.message })
        );
        return;
      }
      setTables(tablesRes.data as DiningTable[]);
      setTasks(tasksRes.data as Task[]);
      setCameras(camerasRes.data as CameraFeed[]);
      setLoaded(true);
    }

    const channel = supabase
      .channel('bordvakt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setTables((prev) => prev.filter((t) => t.id !== payload.old.id));
        } else {
          const row = payload.new as DiningTable;
          const before = tablesRef.current.find((t) => t.id === row.id);
          if (row.status === 'CAMERA_BLIND' && before && before.status !== 'CAMERA_BLIND') {
            blindNotifyRef.current(row.id, row.table_number, row.camera_issue);
          }
          setTables((prev) => upsert(prev, row).sort(byTableNumber));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        const row = payload.new as Task;
        if (payload.eventType === 'DELETE') {
          setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
        } else if (row.status === 'PENDING') {
          setTasks((prev) => upsert(prev, row));
          if (payload.eventType === 'INSERT') {
            const table = tablesRef.current.find((t) => t.id === row.table_id);
            notifyRef.current(row, table?.table_number ?? null);
          }
        } else {
          setTasks((prev) => prev.filter((t) => t.id !== row.id));
          dismissRef.current(row.id); // klar på en annan enhet: stäng larmrutan här också
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'camera_feeds' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCameras((prev) => prev.filter((c) => c.id !== payload.old.id));
        } else {
          setCameras((prev) => upsert(prev, payload.new as CameraFeed));
        }
      })
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        // Hämta allt på nytt vid återanslutning så att inget missas
        if (status === 'SUBSCRIBED') load();
      });

    // Visa borden direkt, utan att vänta på realtidsanslutningen
    load();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Ett bords status visas bara om dess kamera ger bild och AI-analysen är igång
  const engine = useEngineStatus();
  const liveTableIds = new Set(
    tables.filter((row) => monitoringProblem(engine, row.camera_id) === null).map((row) => row.id)
  );
  const problem = monitoringProblem(engine, tables[0]?.camera_id ?? cameras[0]?.id ?? null, t);
  const alertCount = tasks.filter((x) => x.type !== 'DESSERT').length;
  const readyCount = orders.orders.filter((o) => o.status === 'READY').length;

  // Antal larm syns i flikens titel, t.ex. "(3) Bordvakt"
  useEffect(() => {
    const n = alertCount + readyCount;
    document.title = n > 0 ? `(${n}) Bordvakt` : 'Bordvakt';
  }, [alertCount, readyCount]);

  async function completeTask(id: string, falseAlarm = false) {
    const task = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    alerts.dismiss(id);

    // Utan uppkoppling: köa trycket, det skickas när nätet är tillbaka
    const later = () => queue.push({ kind: 'task', id, falseAlarm });
    if (!navigator.onLine) return later();
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(falseAlarm ? { false_alarm: true } : {}),
      });
    } catch {
      return later();
    }
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      setError(`Kunde inte klarmarkera uppgiften: ${body.error ?? res.statusText}`);
      if (task) setTasks((prev) => upsert(prev, task));
    }
  }

  return (
    <DashboardView
      tables={tables}
      tasks={tasks.filter((x) => !queue.queued.has(`task:${x.id}`))}
      cameras={cameras}
      plan={plan}
      engine={engine}
      loaded={loaded}
      isConnected={isConnected}
      shift={shift ? t(`shift.${shift}`) : ''}
      liveTableIds={liveTableIds}
      problem={problem}
      error={error ?? orders.error}
      onDismissError={() => {
        setError(null);
        orders.clearError();
      }}
      selectedTableId={selectedTableId}
      onSelectTable={setSelectedTableId}
      onCompleteTask={completeTask}
      orders={{ ...orders, orders: orders.orders.filter((o) => !queue.queued.has(`serve:${o.id}`)) }}
      alerts={alerts}
      extraActions={features.on('stats') && <ShiftSummary />}
      notice={
        <>
          <OfflineNotice down={queue.down} downSince={queue.downSince} pending={queue.pending} />
          <InstallCard inline />
        </>
      }
    />
  );
}
