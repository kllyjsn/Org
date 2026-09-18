import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLaneViewCache, computeLaneView, laneTopK } from './laneView';
import type { Person } from '../types';

const person = (
  id: string,
  name: string,
  jobLevel: Person['jobLevel'],
  lane = 'Engineering'
): Person => ({
  id,
  name,
  title: `${jobLevel ?? 'IC'} ${name}`,
  department: lane,
  role: 'none',
  confidence: 'high',
  sources: [],
  notes: '',
  email: null,
  linkedin: null,
  x: 0,
  y: 0,
  jobLevel,
});

const itemsFor = (people: Person[], y = 0) =>
  people.map((member, index) => ({ id: member.id, person: member, x: index * 300, y }));

const options = (overrides: Partial<Parameters<typeof computeLaneView>[1]> = {}) => ({
  columns: 4,
  expandedLanes: new Set<string>(),
  collapsedLanes: new Set<string>(),
  showAll: false,
  ...overrides,
});

test('keeps leaders in laneTopK', () => {
  const leaders = Array.from({ length: 3 }, (_, index) => person(`l${index}`, `Leader ${index}`, 'Director'));
  assert.equal(laneTopK(leaders, 4), 8);
  assert.equal(laneTopK(Array.from({ length: 12 }, (_, index) => person(`l${index}`, `Leader ${index}`, 'Director')), 4), 12);
});

test('collapsed lanes show all leaders and tile only the remainder', () => {
  clearLaneViewCache();
  const leaders = Array.from({ length: 5 }, (_, index) => person(`d${index}`, `Director ${index}`, 'Director'));
  const members = [...leaders, ...Array.from({ length: 25 }, (_, index) => person(`i${index}`, `IC ${index}`, 'IC'))];
  const result = computeLaneView(itemsFor(members), options());
  assert.equal(result.visibleIds.size, 8);
  for (const leader of leaders) assert.ok(result.visibleIds.has(leader.id));
  assert.equal(result.tiles[0]?.count, 22);
});

test('small lanes do not collapse, and expansion reveals all members', () => {
  const members = Array.from({ length: 9 }, (_, index) => person(`p${index}`, `Person ${index}`, 'IC'));
  assert.equal(computeLaneView(itemsFor(members), options()).tiles.length, 0);
  const large = Array.from({ length: 30 }, (_, index) => person(`p${index}`, `Person ${index}`, 'IC'));
  const expanded = computeLaneView(itemsFor(large), options({ expandedLanes: new Set(['Engineering']) }));
  assert.equal(expanded.visibleIds.size, 30);
  assert.equal(expanded.tiles.length, 0);
});

test('showAll still honors explicitly collapsed lanes', () => {
  const members = Array.from({ length: 30 }, (_, index) => person(`p${index}`, `Person ${index}`, 'IC'));
  const result = computeLaneView(itemsFor(members), options({
    showAll: true,
    collapsedLanes: new Set(['Engineering']),
  }));
  assert.equal(result.visibleIds.size, 8);
  assert.equal(result.tiles[0]?.count, 22);
});

test('reuses lane sort cache until a person reference changes', () => {
  clearLaneViewCache();
  const first = [person('a', 'Zed', 'IC'), person('b', 'Able', 'IC')];
  const initial = computeLaneView(itemsFor(first), options());
  const repeated = computeLaneView(itemsFor(first), options());
  assert.deepEqual([...initial.visibleIds], [...repeated.visibleIds]);
  const changed = [{ ...first[0], name: 'Aaron' }, first[1]];
  const updated = computeLaneView(itemsFor(changed), options());
  assert.deepEqual([...updated.visibleIds], ['a', 'b']);
  assert.equal(updated.posOverride.size, 0);
  assert.equal(updated.laneOrder[0], 'Engineering');
});

test('reflows lanes below collapsed lanes upward', () => {
  const first = Array.from({ length: 30 }, (_, index) => person(`a${index}`, `A${index}`, 'IC', 'A'));
  const second = Array.from({ length: 3 }, (_, index) => person(`b${index}`, `B${index}`, 'IC', 'B'));
  const result = computeLaneView(
    [
      ...itemsFor(first).map((item, index) => ({ ...item, y: Math.floor(index / 4) * 160 })),
      ...itemsFor(second, 2000),
    ],
    options({ laneOf: (member) => member.department ?? 'none' })
  );
  assert.ok(result.posOverride.get('b0')!.y < 2000);
});

test('returns lanes ordered by their layout position', () => {
  const people = [
    ...Array.from({ length: 2 }, (_, index) => person(`a${index}`, `A${index}`, 'IC', 'A')),
    ...Array.from({ length: 2 }, (_, index) => person(`b${index}`, `B${index}`, 'IC', 'B')),
  ];
  const result = computeLaneView(
    itemsFor(people).map((item) => item.person.department === 'A'
      ? { ...item, y: 300, x: 0 }
      : { ...item, y: 0, x: 100 }),
    options({ laneOf: (member) => member.department ?? 'none' })
  );
  assert.deepEqual(result.laneOrder, ['B', 'A']);
});
