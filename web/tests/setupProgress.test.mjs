import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_STEPS, progress, requiredDone } from '../lib/setupProgress.ts';

test('sju steg i rätt ordning', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.id), ['restaurant', 'floor_plan', 'cameras', 'calibrate', 'menu', 'extras', 'done']);
});

test('progress ger steg X av Y med namn och minuter', () => {
  assert.deepEqual(progress('cameras'), { index: 3, total: 7, label: 'Kameror', minutes: 10 });
  assert.equal(progress('restaurant').index, 1);
  assert.equal(progress('done').minutes, 0);
});

test('requiredDone räknar klara obligatoriska steg (av 4)', () => {
  assert.equal(requiredDone('restaurant'), 0);
  assert.equal(requiredDone('cameras'), 2);
  assert.equal(requiredDone('calibrate'), 3);
  assert.equal(requiredDone('done'), 4);
  assert.equal(requiredDone('okänt'), 0);
});
