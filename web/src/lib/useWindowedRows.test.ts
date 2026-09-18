import test from 'node:test';
import assert from 'node:assert/strict';
import { windowRange } from './useWindowedRows';

test('computes an overscanned and clamped row window', () => {
  assert.deepEqual(windowRange(1000, 500, 100, 100, 2), {
    start: 8,
    end: 17,
    topPad: 800,
    bottomPad: 8300,
  });
  assert.deepEqual(windowRange(0, 500, 5, 100, 8), {
    start: 0,
    end: 5,
    topPad: 0,
    bottomPad: 0,
  });
});
