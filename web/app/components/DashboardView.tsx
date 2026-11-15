'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Bell,
  BellOff,
  BellRing,
  CameraOff,
  Hand,
  IceCreamCone,
  Maximize2,
  Minimize2,
  Users,
  Video,
  Volume2,
  VolumeX,
  Map as MapIcon,
} from 'lucide-react';
import { CameraFeed, DiningTable, Order, OrderItem, OrderStatus, Task } from '@/lib/types';
import { EngineStatus } from '@/lib/useEngineStatus';
import { ActiveFloorPlan } from '@/lib/useFloorPlan';
import { AlertToast } from '@/lib/useStaffAlerts';
import { useT } from '@/lib/i18n';
import AppShell from './AppShell';
import AlertToasts from './AlertToasts';
import Banner from './Banner';
import DiningRoomMap from './DiningRoomMap';
import LiveFeed from './LiveFeed';
import TablePanel from './TablePanel';
import TaskQueue from './TaskQueue';
import CountUp from './CountUp';

export interface DashboardViewProps {
  /** Rad överst, t.ex. demoläget eller tappad uppkoppling */
  notice?: React.ReactNode;
  /** Fler knappar i sidhuvudet, t.ex. "Avsluta passet" */
  extraActions?: React.ReactNode;
  tables: DiningTable[];
  tasks: Task[];
  cameras: CameraFeed[];
  plan: ActiveFloorPlan | null | undefined;
  engine: EngineStatus | null;
  loaded: boolean;
  isConnected: boolean;
  shift: string;
  liveTableIds: Set<string>;
  problem: string | null;
  error: string | null;
  onDismissError: () => void;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  onCompleteTask: (id: string, falseAlarm?: boolean) => void;
  orders: {
    orders: Order[];
    available: boolean;
    create: (tableId: string, items: OrderItem[], note: string) => Promise<boolean>;
    setStatus: (order: Order, status: OrderStatus) => void;
  };
  alerts: {
    toasts: AlertToast[];
    dismiss: (id: string) => void;
    soundOn: boolean;
    toggleSound: () => void;
    permission: NotificationPermission | 'unsupported';
    enableNotifications: () => void;
  };
}

function countByTable(list: { table_id: string }[]) {
  const counts = new Map<string, number>();
  for (const item of list) counts.set(item.table_id, (counts.get(item.table_id) ?? 0) + 1);
  return counts;
}

const SEATED = new Set(['OCCUPIED', 'AWAITING_FOOD', 'NEEDS_ATTENTION', 'DESSERT_OPPORTUNITY', 'EMERGENCY', 'WANTS_BILL']);

/** Matsalens översikt. Bara utseende: all data kommer in som props. */
export default function DashboardView(p: DashboardViewProps) {
  const [view, setView] = useState<'map' | 'camera'>('map');
  const [mapFull, setMapFull] = useState(false);
  const closeMap = useCallback(() => setMapFull(false), []);
  const t = useT();
  const { tables, tasks, liveTableIds, orders, alerts } = p;

  const alertCount = tasks.filter((t) => t.type !== 'DESSERT').length;
  const dessertCount = tasks.length - alertCount;
  const readyOrders = orders.orders.filter((o) => o.status === 'READY');
  const readyByTable = countByTable(readyOrders);
  const cookingByTable = countByTable(
    orders.orders.filter((o) => o.status === 'RECEIVED' || o.status === 'PREPARING')
  );
  const onPlan = tables.filter((t) => t.floor_plan_id !== null);
  const blindTables = onPlan.filter((t) => liveTableIds.has(t.id) && t.status === 'CAMERA_BLIND');
  const seated = onPlan.filter((t) => liveTableIds.has(t.id) && SEATED.has(t.status)).length;
  const monitoring = liveTableIds.size > 0;
  const selectedTable = tables.find((t) => t.id === p.selectedTableId) ?? null;

  const subtitle = [p.shift, p.plan?.name].filter(Boolean).join(' · ') || undefined;

  return (
    <AppShell
      title={t('dash.title')}
      subtitle={subtitle}
      actions={
        <>
          {p.extraActions}
          <span
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold ${
              p.isConnected ? 'bg-teal-light text-[#0F5C55]' : 'bg-[#FDF1EA] text-accent-dark'
            }`}
          >
            <span className={`live-dot h-2 w-2 rounded-full ${p.isConnected ? 'bg-teal' : 'bg-accent'}`} />
            {p.isConnected ? t('dash.live') : t('dash.connecting')}
          </span>
          <button
            type="button"
            onClick={alerts.toggleSound}
            aria-pressed={alerts.soundOn}
            aria-label={alerts.soundOn ? t('dash.soundOff') : t('dash.soundOn')}
            title={alerts.soundOn ? t('dash.soundOff') : t('dash.soundOn')}
            className="btn btn-secondary btn-icon"
          >
            {alerts.soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted" />}
          </button>
          {alerts.permission !== 'unsupported' && (
            <button
              type="button"
              onClick={alerts.enableNotifications}
              disabled={alerts.permission !== 'default'}
              title={
                alerts.permission === 'granted'
                  ? t('dash.notifIsOn')
                  : alerts.permission === 'denied'
                    ? t('dash.notifBlockedHelp')
                    : t('dash.notifHelp')
              }
              className="btn btn-secondary disabled:opacity-100"
            >
              {alerts.permission === 'denied' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              <span className="hidden sm:inline">
                {alerts.permission === 'granted'
                  ? t('dash.notifIsOn')
                  : alerts.permission === 'denied'
                    ? t('dash.notifBlocked')
                    : t('dash.notifEnable')}
              </span>
            </button>
          )}
        </>
      }
    >
      <AlertToasts toasts={alerts.toasts} onDismiss={alerts.dismiss} onSelectTable={p.onSelectTable} />
      {p.notice}

      {p.error && (
        <div className="mb-5">
          <Banner
            role="alert"
            action={
              <button onClick={p.onDismissError} className="btn btn-ghost btn-sm">
                {t('common.close')}
              </button>
            }
          >
            {p.error}
          </Banner>
        </div>
      )}

      {/* Översikt */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label={t('dash.needHelp')}
          value={alertCount}
          icon={Hand}
          tone={alertCount > 0 ? 'bg-red-50 border-red-200 text-red-700' : null}
        />
        <Stat
          label={t('dash.foodToServe')}
          value={readyOrders.length}
          icon={BellRing}
          tone={readyOrders.length > 0 ? 'bg-teal-light border-[#B9DAD4] text-teal' : null}
        />
        <Stat
          label={t('dash.dessert')}
          value={dessertCount}
          icon={IceCreamCone}
          tone={dessertCount > 0 ? 'bg-dessert-light border-accent-light text-accent-dark' : null}
        />
        <Stat label={t('dash.seated')} value={seated} total={onPlan.length} icon={Users} tone={null} />
        <Stat
          label={t('dash.blind')}
          value={blindTables.length}
          icon={CameraOff}
          tone={blindTables.length > 0 ? 'bg-gray-100 border-gray-300 text-gray-700' : null}
          href={blindTables.length > 0 ? '/setup?step=calibrate' : undefined}
          className="col-span-2 sm:col-span-1"
          hrefTitle={t('dash.recalibrate')}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Karta och kamera */}
        <section className="card order-2 min-w-0 lg:order-1">
          <div className="card-header">
            <h2 className="font-display text-[17px] font-bold">{view === 'map' ? t('dash.mapTitle') : t('dash.cameraTitle')}</h2>
            <div className="flex items-center gap-2">
            {view === 'map' && p.plan && (
              <button
                type="button"
                onClick={() => setMapFull(true)}
                aria-label={t('map.fullscreen')}
                title={t('map.fullscreen')}
                className="btn btn-secondary btn-sm"
              >
                <Maximize2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t('map.fullscreen')}</span>
              </button>
            )}
            <div role="tablist" aria-label={t('dash.view')} className="inline-flex rounded-lg bg-paper p-1">
              {(
                [
                  { id: 'map', label: t('dash.tabMap'), icon: MapIcon },
                  { id: 'camera', label: t('dash.tabCamera'), icon: Video },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setView(id)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                    view === id ? 'bg-white text-ink shadow-[0_1px_2px_rgba(15,20,25,.12)]' : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            </div>
          </div>
          <div className="p-3 sm:p-5">
            {view === 'map' ? (
              <DiningRoomMap
                plan={p.plan}
                tables={tables}
                liveTableIds={liveTableIds}
                problem={p.problem}
                selectedTableId={p.selectedTableId}
                onSelectTable={p.onSelectTable}
                readyByTable={readyByTable}
                cookingByTable={cookingByTable}
                guideAuto={p.engine?.setupComplete === true}
              />
            ) : (
              <LiveFeed
                cameras={p.cameras}
                tables={tables}
                engine={p.engine}
                loading={!p.loaded}
                liveTableIds={liveTableIds}
                selectedTableId={p.selectedTableId}
                onSelectTable={p.onSelectTable}
              />
            )}
          </div>
        </section>

        {/* På mobil kommer uppgifterna först, det är dem personalen behöver */}
        <div className="order-1 flex min-w-0 flex-col gap-5 lg:sticky lg:top-8 lg:order-2 lg:self-start">
          {selectedTable && (
            <TablePanel
              key={selectedTable.id}
              table={selectedTable}
              live={liveTableIds.has(selectedTable.id)}
              orders={orders.orders.filter((o) => o.table_id === selectedTable.id)}
              ordersAvailable={orders.available}
              onClose={() => p.onSelectTable(null)}
              onCreate={orders.create}
              onSetStatus={orders.setStatus}
            />
          )}
          <TaskQueue
            tasks={tasks}
            tables={tables}
            selectedTableId={p.selectedTableId}
            monitoring={monitoring}
            onComplete={p.onCompleteTask}
            onSelectTable={p.onSelectTable}
            readyOrders={readyOrders}
            onServe={(order) => orders.setStatus(order, 'SERVED')}
            pendingOrders={orders.orders.filter((o) => o.status === 'PENDING_APPROVAL')}
            onApprove={(order, approve) => orders.setStatus(order, approve ? 'RECEIVED' : 'CANCELLED')}
            blindTables={blindTables}
          />
        </div>
      </div>

      {mapFull && p.plan && (
        <FullscreenMap
          title={[t('dash.mapTitle'), p.plan.name].filter(Boolean).join(' · ')}
          aspectRatio={p.plan.aspect_ratio}
          onClose={closeMap}
        >
          <DiningRoomMap
            plan={p.plan}
            tables={tables}
            liveTableIds={liveTableIds}
            problem={p.problem}
            selectedTableId={p.selectedTableId}
            onSelectTable={(id) => {
              // Bordets detaljer visas bredvid kartan, så lämna helskärmen
              setMapFull(false);
              p.onSelectTable(id);
            }}
            readyByTable={readyByTable}
            cookingByTable={cookingByTable}
          />
        </FullscreenMap>
      )}
    </AppShell>
  );
}

const plain = (n: number) => String(n);

function Stat({
  label,
  value,
  total,
  icon: Icon,
  tone,
  href,
  hrefTitle,
  className = '',
}: {
  label: string;
  value: number;
  total?: number;
  icon: React.ComponentType<{ className?: string }>;
  /** Färger när siffran är viktig, annars neutral */
  tone: string | null;
  href?: string;
  hrefTitle?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[13px] font-semibold ${tone ? '' : 'text-muted'}`}>{label}</span>
        <Icon className={`h-4 w-4 ${tone ? '' : 'text-gray-400'}`} />
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
        <CountUp value={value} format={plain} />
        {total !== undefined && <span className="text-base font-semibold text-muted"> / {total}</span>}
      </p>
    </>
  );
  const cls = `rounded-xl border p-4 transition-colors ${tone ?? 'border-line bg-white text-ink'} ${className}`;
  return href ? (
    <Link href={href} className={`${cls} press hover:border-ink`} title={hrefTitle}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Kartan över hela skärmen, t.ex. på en platta på väggen. Esc eller knappen stänger. */
function FullscreenMap({
  title,
  aspectRatio,
  onClose,
  children,
}: {
  title: string;
  aspectRatio: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();

  useEffect(() => {
    const root = document.documentElement;
    // Riktig helskärm där webbläsaren tillåter det (inte på iPhone). Annars fyller rutan fönstret.
    root.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Om man lämnar webbläsarens helskärm (t.ex. med Esc) stängs kartan också
    const onChange = () => !document.fullscreenElement && onClose();
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
        <h2 className="truncate font-display text-[18px] font-bold">{title}</h2>
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
          <Minimize2 className="h-4 w-4" /> {t('map.exitFullscreen')}
        </button>
      </div>
      <div className="app-zoom min-h-0 flex-1 overflow-auto p-3 sm:p-6">
        {/* Så stor som möjligt utan att kartan blir högre än skärmen */}
        <div className="mx-auto" style={{ width: `min(100%, calc((100dvh - 150px) * ${aspectRatio}))` }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
