import { performance } from 'node:perf_hooks';
import { generateFixturePeople } from '../src/lib/devFixtures';
import * as laneView from '../src/lib/laneView';
import { applyLanes } from '../src/lib/layout';

const sizes = [100, 300, 600, 1000];

function bestOf(run: () => void): number {
  run();
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function measure(size: number): Record<string, number> {
  const { people } = generateFixturePeople(size);
  const items = people.map((person) => ({ ...person, person }));
  const clearCache = () => {
    const clear = (laneView as typeof laneView & {
      clearLaneViewCache?: () => void;
    }).clearLaneViewCache;
    clear?.();
  };
  const applyMs = bestOf(() => {
    applyLanes(people, 4, 'department');
  });
  const coldMs = bestOf(() => {
    clearCache();
    laneView.computeLaneView(items, {
      columns: 4,
      expandedLanes: new Set(),
      collapsedLanes: new Set(),
      showAll: false,
    });
  });
  laneView.computeLaneView(items, {
    columns: 4,
    expandedLanes: new Set(),
    collapsedLanes: new Set(),
    showAll: false,
  });
  const warmMs = bestOf(() => {
    laneView.computeLaneView(items, {
      columns: 4,
      expandedLanes: new Set(),
      collapsedLanes: new Set(),
      showAll: false,
    });
  });
  const showAllMs = bestOf(() => {
    laneView.computeLaneView(items, {
      columns: 4,
      expandedLanes: new Set(),
      collapsedLanes: new Set(),
      showAll: true,
    });
  });
  return { applyMs, coldMs, warmMs, showAllMs };
}

console.log('| N | applyLanes (ms) | laneView cold (ms) | laneView warm (ms) | laneView showAll (ms) |');
console.log('|---:|---:|---:|---:|---:|');
for (const size of sizes) {
  const result = measure(size);
  console.log(
    `| ${size} | ${result.applyMs.toFixed(2)} | ${result.coldMs.toFixed(2)} | ${result.warmMs.toFixed(2)} | ${result.showAllMs.toFixed(2)} |`
  );
}
