import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, fresh, drain, MAX_AGE_MS } from '../lib/offlineQueue.ts';

const T = 1_000_000;
const task = (id, extra = {}) => ({ kind: 'task', id, ...extra });

test('samma id köas bara en gång, senaste trycket vinner', () => {
  let q = enqueue([], task('a'), T);
  q = enqueue(q, task('b'), T + 1);
  q = enqueue(q, task('a', { falseAlarm: true }), T + 2);
  assert.deepEqual(q.map((x) => [x.id, x.falseAlarm ?? false]), [['b', false], ['a', true]]);
});

test('uppgift och beställning med samma id hålls isär', () => {
  const q = enqueue(enqueue([], task('x'), T), { kind: 'serve', id: 'x' }, T);
  assert.equal(q.length, 2);
});

test('tryck äldre än 15 minuter slängs', () => {
  assert.equal(MAX_AGE_MS, 15 * 60_000);
  const q = enqueue(enqueue([], task('old'), T), task('new'), T + MAX_AGE_MS);
  assert.deepEqual(fresh(q, T + MAX_AGE_MS + 1).map((x) => x.id), ['new']);
});

test('drain tar bort ok och gone, stannar vid retry och behåller resten', async () => {
  let q = [];
  for (const id of ['a', 'b', 'c', 'd']) q = enqueue(q, task(id), T);
  const sent = [];
  const left = await drain(q, async (a) => {
    sent.push(a.id);
    return a.id === 'c' ? 'retry' : a.id === 'b' ? 'gone' : 'ok';
  }, T);
  assert.deepEqual(sent, ['a', 'b', 'c']);
  assert.deepEqual(left.map((x) => x.id), ['c', 'd']);
});

test('drain skickar inte gamla tryck', async () => {
  const q = enqueue([], task('old'), T);
  const sent = [];
  const left = await drain(q, async (a) => (sent.push(a.id), 'ok'), T + MAX_AGE_MS + 1);
  assert.deepEqual(sent, []);
  assert.deepEqual(left, []);
});

test('ett kastat fel räknas som retry', async () => {
  const q = enqueue([], task('a'), T);
  const left = await drain(q, async () => { throw new TypeError('Failed to fetch'); }, T);
  assert.deepEqual(left.map((x) => x.id), ['a']);
});
