'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import DashboardView from '../../components/DashboardView';
import { DEMO_PLAN, DEMO_TICK_MS, demoOrders, demoTables, demoTasks } from '@/lib/demo';
import { EngineStatus } from '@/lib/useEngineStatus';
import { useT } from '@/lib/i18n';

const ENGINE: EngineStatus = {
  reachable: true,
  paired: true,
  aiEnabled: true,
  aiDisabledReason: null,
  setupComplete: true,
  cameras: { 'demo-camera': { online: true } },
  base: null,
  token: null,
};

/** Matsalen med låtsasdata: visar hur appen ser ut innan restaurangen är kopplad. Inget sparas. */
export default function DemoDashboard() {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set()); // uppgifter och beställningar man tryckt bort
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    const first = setTimeout(() => setNow(new Date().toISOString()), 0);
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      setNow(new Date().toISOString());
    }, DEMO_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const tables = useMemo(() => (now ? demoTables(tick, now) : []), [tick, now]);
  const tasks = demoTasks(tables, now).filter((x) => !done.has(x.id));
  const orders = demoOrders(tables, now).filter((x) => !done.has(x.id));
  const hide = (id: string) => setDone((s) => new Set(s).add(id));

  return (
    <DashboardView
      tables={tables}
      tasks={tasks}
      cameras={[]}
      plan={DEMO_PLAN}
      engine={ENGINE}
      loaded={Boolean(now)}
      isConnected
      shift=""
      liveTableIds={new Set(tables.map((x) => x.id))}
      problem={null}
      error={null}
      onDismissError={() => {}}
      selectedTableId={selectedTableId}
      onSelectTable={setSelectedTableId}
      onCompleteTask={hide}
      orders={{
        orders,
        available: true,
        create: async () => true,
        setStatus: (order) => hide(order.id),
      }}
      alerts={{
        toasts: [],
        dismiss: () => {},
        soundOn: false,
        toggleSound: () => {},
        permission: 'unsupported',
        enableNotifications: () => {},
      }}
      notice={
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-accent-light bg-dessert-light/60 p-3 text-sm">
          <Sparkles className="h-5 w-5 flex-none text-accent-dark" />
          <p className="min-w-0 flex-1 font-semibold">{t('demo.notice')}</p>
          <Link href="/setup" className="btn btn-secondary btn-sm">
            {t('demo.back')}
          </Link>
        </div>
      }
    />
  );
}
