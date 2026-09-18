import test from 'node:test';
import assert from 'node:assert/strict';
import { planPngExport } from './pngExport';

test('plans small bounds at full zoom', () => {
  assert.deepEqual(planPngExport({ width: 1000, height: 500 }), {
    mode: 'full',
    width: 1160,
    height: 580,
    zoom: 1,
  });
});

test('clamps large rectangular bounds by side and area', () => {
  const plan = planPngExport({ width: 30000, height: 4000 });
  assert.equal(plan.mode, 'full');
  if (plan.mode === 'full') {
    assert.ok(plan.width <= 8192);
    assert.ok(plan.height <= 8192);
    assert.ok(plan.width * plan.height <= 16_000_000);
  }
});

test('uses viewport mode when bounds cannot fit minimum zoom', () => {
  assert.equal(planPngExport({ width: 60000, height: 60000 }).mode, 'viewport');
});

test('uses a default image for empty bounds', () => {
  assert.deepEqual(planPngExport({ width: 0, height: 0 }), {
    mode: 'full',
    width: 1080,
    height: 720,
    zoom: 1,
  });
});
