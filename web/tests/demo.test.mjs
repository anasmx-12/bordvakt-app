import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PLAN, demoTables, demoTasks, demoOrders } from '../lib/demo.ts';

const NOW = '2026-11-15T18:00:00.000Z';

test('åtta bord som alla ligger på demoplanen', () => {
  const tables = demoTables(0, NOW);
  assert.equal(tables.length, 8);
  for (const t of tables) {
    assert.equal(t.floor_plan_id, DEMO_PLAN.id);
    assert.ok(t.floor_x >= 0 && t.floor_x + t.floor_w <= 1, `bord ${t.table_number} x`);
    assert.ok(t.floor_y >= 0 && t.floor_y + t.floor_h <= 1, `bord ${t.table_number} y`);
  }
  assert.deepEqual(tables.map((t) => t.table_number), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('samma tick ger samma data, nästa tick ändrar något', () => {
  assert.deepEqual(demoTables(3, NOW), demoTables(3, NOW));
  const a = demoTables(3, NOW).map((t) => t.status).join();
  const b = demoTables(4, NOW).map((t) => t.status).join();
  assert.notEqual(a, b);
});

test('flera olika färger syns samtidigt', () => {
  for (let tick = 0; tick < 20; tick++) {
    assert.ok(new Set(demoTables(tick, NOW).map((t) => t.status)).size >= 4, `tick ${tick}`);
  }
});

test('uppgifter följer borden: vill betala ger notan, söker kontakt ger service', () => {
  for (let tick = 0; tick < 20; tick++) {
    const tables = demoTables(tick, NOW);
    const tasks = demoTasks(tables, NOW);
    for (const t of tables) {
      const types = tasks.filter((x) => x.table_id === t.id).map((x) => x.type);
      if (t.status === 'WANTS_BILL') assert.deepEqual(types, ['BILL']);
      if (t.status === 'NEEDS_ATTENTION') assert.deepEqual(types, ['SERVICE']);
      if (t.status === 'AVAILABLE') assert.deepEqual(types, []);
    }
    assert.equal(new Set(tasks.map((x) => x.id)).size, tasks.length, 'unika id');
  }
});

test('bord som väntar på mat har en beställning', () => {
  for (let tick = 0; tick < 20; tick++) {
    const tables = demoTables(tick, NOW);
    const orders = demoOrders(tables, NOW);
    for (const t of tables.filter((x) => x.status === 'AWAITING_FOOD')) {
      assert.ok(orders.some((o) => o.table_id === t.id), `bord ${t.table_number}`);
    }
  }
});
