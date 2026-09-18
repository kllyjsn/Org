import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFixturePeople } from './devFixtures';
import { applyLanes, applyLayout, personLane, seniorityRank } from './layout';
import type { Person } from '../types';

const person = (
  id: string,
  name: string,
  department: string,
  jobLevel: Person['jobLevel'],
  title = `${jobLevel ?? 'IC'} ${name}`
): Person => ({
  id,
  name,
  title,
  department,
  team: 'Core',
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

test('lays out 600 people into finite, seniority-ordered lane positions', () => {
  const people = generateFixturePeople(600).people;
  const laidOut = applyLanes(people, 4);
  assert.ok(laidOut.every((member) => Number.isFinite(member.x) && Number.isFinite(member.y)));
  for (const lane of new Set(laidOut.map(personLane))) {
    const members = laidOut
      .filter((member) => personLane(member) === lane)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (let index = 1; index < members.length; index += 1) {
      assert.ok(seniorityRank(members[index - 1]) <= seniorityRank(members[index]));
    }
  }
});

test('places the lane with the most senior person first', () => {
  const people = [
    person('a', 'Alice', 'Later', 'IC'),
    person('b', 'Bob', 'First', 'VP'),
    person('c', 'Cleo', 'Later', 'Manager'),
    person('d', 'Drew', 'First', 'IC'),
  ];
  const laidOut = applyLanes(people, 2);
  assert.ok(laidOut.find((member) => member.id === 'b')!.y < laidOut.find((member) => member.id === 'a')!.y);
});

test('caches seniority ranks and prefers job level over title', () => {
  const member = person('ranked', 'Ranked', 'Engineering', 'Director', 'Chief Executive Officer');
  assert.equal(seniorityRank(member), 6);
  assert.equal(seniorityRank(member), 6);
  const titleOnly = person('title', 'Title', 'Engineering', null, 'Chief Executive Officer');
  assert.equal(seniorityRank(titleOnly), 0);
});

test('preserves finite positions for hand-built tree layouts', () => {
  const people = [person('ceo', 'CEO', 'Exec', 'CXO'), person('ic', 'IC', 'Eng', 'IC')];
  const laidOut = applyLayout(people, [
    { id: 'e', from: 'ceo', to: 'ic', kind: 'reports', label: null },
  ]);
  assert.ok(laidOut.every((member) => Number.isFinite(member.x) && Number.isFinite(member.y)));
});
