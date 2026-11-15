// Demoläget: låtsasdata för Matsalen innan restaurangen är kopplad. Inget hämtas eller sparas.
// Samma tick ger alltid samma data. Inga @/-importer (testas med node --test).

import type { DiningTable, Order, TableStatus, Task, TaskType } from './types';
import type { ActiveFloorPlan } from './useFloorPlan';

export const DEMO_TICK_MS = 4000;

export const DEMO_PLAN: ActiveFloorPlan = {
  id: 'demo-plan',
  name: 'Demo',
  aspect_ratio: 1.6,
  elements: [
    { kind: 'bar', label: 'Bar', shape: 'rect', x: 0.04, y: 0.05, w: 0.3, h: 0.1, rotation: 0 },
    { kind: 'kitchen', label: 'Kök', shape: 'rect', x: 0.66, y: 0.05, w: 0.3, h: 0.1, rotation: 0 },
    { kind: 'entrance', label: 'Entré', shape: 'rect', x: 0.4, y: 0.86, w: 0.2, h: 0.09, rotation: 0 },
  ],
};

// Ett bords besök, ett steg per tick. Borden börjar på olika ställen så att flera färger syns samtidigt.
const VISIT: TableStatus[] = [
  'AVAILABLE',
  'OCCUPIED',
  'NEEDS_ATTENTION',
  'AWAITING_FOOD',
  'AWAITING_FOOD',
  'OCCUPIED',
  'OCCUPIED',
  'DESSERT_OPPORTUNITY',
  'WANTS_BILL',
  'NEEDS_CLEANING',
];
const OFFSETS = [0, 3, 6, 1, 8, 4, 7, 2];

const TASK_FOR: Partial<Record<TableStatus, TaskType>> = {
  NEEDS_ATTENTION: 'SERVICE',
  WANTS_BILL: 'BILL',
  NEEDS_CLEANING: 'CLEANING',
  DESSERT_OPPORTUNITY: 'DESSERT',
};

export function demoTables(tick: number, now: string): DiningTable[] {
  return OFFSETS.map((offset, i) => {
    const round = i % 3 === 1;
    return {
      id: `demo-table-${i + 1}`,
      restaurant_id: 'demo',
      table_number: i + 1,
      area: 'Matsal',
      camera_id: 'demo-camera',
      roi_x1: null,
      roi_y1: null,
      roi_x2: null,
      roi_y2: null,
      status: VISIT[(tick + offset) % VISIT.length],
      camera_issue: null,
      last_updated: now,
      floor_plan_id: DEMO_PLAN.id,
      shape: round ? 'round' : 'rect',
      seats: round ? 2 : 4,
      floor_x: 0.1 + (i % 4) * 0.22,
      floor_y: i < 4 ? 0.28 : 0.6,
      floor_w: round ? 0.08 : 0.12,
      floor_h: round ? 0.13 : 0.15,
      rotation: 0,
    };
  });
}

export function demoTasks(tables: DiningTable[], now: string): Task[] {
  return tables.flatMap((t) => {
    const type = TASK_FOR[t.status];
    return type
      ? [{ id: `demo-task-${t.table_number}-${t.status}`, table_id: t.id, type, status: 'PENDING' as const, created_at: now, resolved_at: null }]
      : [];
  });
}

export function demoOrders(tables: DiningTable[], now: string): Order[] {
  return tables
    .filter((t) => t.status === 'AWAITING_FOOD')
    .map((t, i) => ({
      id: `demo-order-${t.table_number}`,
      restaurant_id: 'demo',
      table_id: t.id,
      items: [
        { name: 'Dagens fisk', qty: 2 },
        { name: 'Pasta', qty: 1 },
      ],
      note: null,
      status: i % 2 === 0 ? 'READY' : 'PREPARING',
      created_at: now,
      updated_at: now,
      ready_at: i % 2 === 0 ? now : null,
      served_at: null,
      completed_at: null,
      source: 'staff' as const,
    }));
}
