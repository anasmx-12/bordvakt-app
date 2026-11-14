'use client';

import Link from 'next/link';
import { Loader2, Map as MapIcon } from 'lucide-react';
import { STATUS_STYLE } from '@/lib/types';
import { DiningTable } from '@/lib/types';
import { ActiveFloorPlan } from '@/lib/useFloorPlan';
import FloorPlan from './FloorPlan';
import Banner from './Banner';
import TableGrid from './TableGrid';
import { Key, translateIssue, useT } from '@/lib/i18n';

interface Props {
  plan: ActiveFloorPlan | null | undefined;
  tables: DiningTable[];
  liveTableIds: Set<string>;
  problem: string | null;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  /** Bord-id -> antal beställningar som är klara i köket */
  readyByTable: Map<string, number>;
  /** Bord-id -> antal beställningar som lagas */
  cookingByTable: Map<string, number>;
}

const LEGEND: { label: Key; className: string }[] = [
  { label: 'status.EMERGENCY', className: 'bg-red-800 ring-2 ring-red-400' },
  { label: 'map.legendAlert', className: 'bg-red-500' },
  { label: 'status.WANTS_BILL', className: 'bg-violet-600' },
  { label: 'status.DESSERT_OPPORTUNITY', className: 'bg-dessert' },
  { label: 'map.legendFoodReady', className: 'bg-teal' },
  { label: 'status.OCCUPIED', className: 'bg-blue-100 border border-blue-300' },
  { label: 'status.AVAILABLE', className: 'bg-teal-light border border-[#7DBDB4]' },
  { label: 'status.CAMERA_BLIND', className: STATUS_STYLE.CAMERA_BLIND.table },
];

export default function DiningRoomMap({
  plan,
  tables,
  liveTableIds,
  problem,
  selectedTableId,
  onSelectTable,
  readyByTable,
  cookingByTable,
}: Props) {
  const t = useT();
  if (plan === undefined) {
    return (
      <div className="flex aspect-[3/2] items-center justify-center rounded-[14px] bg-paper-soft text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Ingen planritning än: visa rutnätet och tipsa om att skapa en
  if (plan === null) {
    return (
      <div className="flex flex-col gap-3">
        <TableGrid
          tables={tables}
          liveTableIds={liveTableIds}
          problem={problem}
          selectedTableId={selectedTableId}
          onSelectTable={onSelectTable}
          readyByTable={readyByTable}
        />
        <Link href="/admin/floor-plan" className="btn btn-secondary self-start">
          <MapIcon className="h-4 w-4" /> {t('map.createPlan')}
        </Link>
      </div>
    );
  }

  const onPlan = tables.filter(
    (
      t,
    ): t is DiningTable & {
      floor_x: number;
      floor_y: number;
      floor_w: number;
      floor_h: number;
    } =>
      t.floor_plan_id === plan.id &&
      t.floor_x !== null &&
      t.floor_y !== null &&
      t.floor_w !== null &&
      t.floor_h !== null,
  );
  const notOnPlan = tables.filter((t) => t.floor_plan_id !== plan.id);

  return (
    <div className="flex flex-col gap-3">
      {/* Kartan visas alltid. Bord som inte bevakas visas som "Kameran ser inte bordet". */}
      {liveTableIds.size === 0 && problem && (
        <Banner title={t('map.noStatus')}>
          {problem} {t('map.ordersStillShown')}
        </Banner>
      )}

      <FloorPlan
        aspectRatio={plan.aspect_ratio}
        elements={plan.elements}
        selectedKey={selectedTableId}
        onSelect={onSelectTable}
        tables={onPlan.map((row) => ({
          key: row.id,
          table_number: row.table_number,
          shape: row.shape,
          seats: row.seats,
          x: row.floor_x,
          y: row.floor_y,
          w: row.floor_w,
          h: row.floor_h,
          rotation: row.rotation ?? 0,
          status: row.status,
          live: liveTableIds.has(row.id),
          blind: !liveTableIds.has(row.id) || row.status === 'CAMERA_BLIND',
          issue: row.status === 'CAMERA_BLIND' ? translateIssue(t, row.camera_issue) : problem,
          readyOrders: readyByTable.get(row.id) ?? 0,
          cookingOrders: cookingByTable.get(row.id) ?? 0,
        }))}
      />

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-soft pt-3">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-3 w-3 rounded-[4px] ${item.className}`} />
            {t(item.label)}
          </li>
        ))}
      </ul>

      {notOnPlan.length > 0 && (
        <p className="text-xs text-muted">
          {t('map.notOnPlan', { list: notOnPlan.map((x) => x.table_number).join(', ') })}{' '}
          <Link href="/admin/floor-plan" className="font-semibold text-accent hover:text-accent-dark">
            {t('map.editPlan')}
          </Link>
        </p>
      )}
    </div>
  );
}
