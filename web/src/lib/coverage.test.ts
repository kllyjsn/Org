import test from 'node:test';
import assert from 'node:assert/strict';
import { committeeCoverage, coverageBand } from './coverage';
import type { Person } from '../types';

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Eng',
    department: null,
    role: 'none',
    confidence: 'medium',
    sources: [],
    notes: '',
    email: null,
    linkedin: null,
    x: 0,
    y: 0,
    ...patch,
  };
}

function state(people: Person[]): Person[] {
  return people;
}

const NOW = Date.parse('2026-03-09T12:00:00.000Z');

test('committeeCoverage mirrors api scoring', () => {
  const coverage = committeeCoverage(
    state([
      person({ id: 'a', role: 'champion', metWith: true, lastTouchAt: '2026-03-01T00:00:00Z' }),
      person({ id: 'b', role: 'champion', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'c', role: 'economic_buyer', metWith: true, lastTouchAt: '2025-12-01T00:00:00Z' }),
      person({ id: 'd', role: 'influencer' }),
    ]),
    NOW
  );
  assert.equal(coverage.coveredCount, 2);
  assert.deepEqual(coverage.missingRoles, ['decision_maker']);
  assert.equal(coverage.threadCount, 3);
  assert.equal(coverage.singleThreaded, false);
  assert.deepEqual(coverage.untouchedKeyPeople.map((p) => p.id), ['c']);
  assert.equal(coverage.score, 63);
  assert.equal(coverageBand(coverage.score), 'moderate');
});

test('full coverage and empty map', () => {
  const strong = committeeCoverage(
    state([
      person({ id: 'a', role: 'champion', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'b', role: 'economic_buyer', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'c', role: 'decision_maker', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
    ]),
    NOW
  );
  assert.equal(strong.score, 100);
  assert.equal(coverageBand(strong.score), 'strong');

  const empty = committeeCoverage(state([]), NOW);
  assert.equal(empty.score, 20);
  assert.equal(coverageBand(empty.score), 'weak');
});
