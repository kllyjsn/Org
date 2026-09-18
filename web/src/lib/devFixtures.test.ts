import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFixturePeople } from './devFixtures';
import { seniorityRank } from './layout';

test('generates a deterministic 600-person fixture', () => {
  const first = generateFixturePeople(600);
  const second = generateFixturePeople(600);
  assert.equal(first.people.length, 600);
  assert.equal(new Set(first.people.map((person) => person.department)).size, 12);
  assert.equal(first.people.filter((person) => person.jobLevel === 'CXO').length, 1);
  assert.equal(first.people.find((person) => person.jobLevel === 'CXO')?.title, 'Chief Executive Officer');
  const reports = first.edges.filter((edge) => edge.kind === 'reports');
  assert.ok(reports.length >= 0.8 * 599);
  const peopleById = new Map(first.people.map((person) => [person.id, person]));
  for (const edge of first.edges) {
    assert.ok(peopleById.has(edge.from));
    assert.ok(peopleById.has(edge.to));
    if (edge.kind === 'reports') {
      assert.ok(seniorityRank(peopleById.get(edge.from)!) < seniorityRank(peopleById.get(edge.to)!));
    }
  }
  assert.deepEqual(first, second);
});
