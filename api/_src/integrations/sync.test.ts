import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTouchStats,
  deriveTouchStats,
  matchParticipants,
} from './sync.js';
import type { MapState, Person } from '../types.js';

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Sales',
    department: 'Sales',
    role: 'none',
    confidence: 'high',
    sources: [],
    notes: '',
    email: null,
    linkedin: null,
    x: 0,
    y: 0,
    ...patch,
  };
}

function state(people: Person[]): MapState {
  return {
    people,
    edges: [],
    meta: {
      domain: 'acme.com',
      companyName: 'Acme',
      researchedAt: null,
      tier: 'T0',
      provider: null,
    },
  };
}

test('matchParticipants: exact email match wins', () => {
  const people = [person({ id: 'p1', email: 'jane@acme.com' })];
  const matches = matchParticipants(
    [{ email: 'jane@acme.com', name: 'Different Name' }],
    people,
    'acme.com'
  );
  assert.deepEqual([...matches.keys()], ['p1']);
});

test('matchParticipants: same-domain name match works', () => {
  const people = [person({ id: 'p1', name: 'Robert Komin' })];
  const matches = matchParticipants(
    [{ email: 'bob@acme.com', name: 'Bob Komin' }],
    people,
    'acme.com'
  );
  assert.deepEqual([...matches.keys()], ['p1']);
});

test('matchParticipants: external-domain same-name does NOT match', () => {
  const people = [person({ id: 'p1', name: 'Bob Komin' })];
  const matches = matchParticipants(
    [{ email: 'bob@gmail.com', name: 'Bob Komin' }],
    people,
    'acme.com'
  );
  assert.equal(matches.size, 0);
  // …but a participant with no email may still match by name.
  const byName = matchParticipants(
    [{ email: null, name: 'Bob Komin' }],
    people,
    'acme.com'
  );
  assert.deepEqual([...byName.keys()], ['p1']);
});

test('matchParticipants: integration owner is never matched', () => {
  const people = [person({ id: 'p1', name: 'Rep One', email: 'rep@ours.com' })];
  const matches = matchParticipants(
    [{ email: 'rep@ours.com', name: 'Rep One' }],
    people,
    'acme.com',
    'rep@ours.com'
  );
  assert.equal(matches.size, 0);
});

test('deriveTouchStats: counts and future meetings do not set metWith', () => {
  const nowMs = Date.parse('2026-03-10T00:00:00.000Z');
  const stats = deriveTouchStats(
    [
      { personId: 'p1', kind: 'meeting', occurredAt: '2026-03-01T10:00:00Z' },
      { personId: 'p1', kind: 'meeting', occurredAt: '2026-04-01T10:00:00Z' },
      { personId: 'p1', kind: 'email', occurredAt: '2026-03-05T10:00:00Z' },
      { personId: 'p2', kind: 'meeting', occurredAt: '2026-04-01T10:00:00Z' },
    ],
    nowMs
  );
  const p1 = stats.get('p1')!;
  assert.equal(p1.meetingCount, 2);
  assert.equal(p1.emailThreadCount, 1);
  assert.equal(p1.metWith, true); // one meeting already happened
  // The April meeting is still scheduled — last touch is the past email.
  assert.equal(p1.lastTouchAt, '2026-03-05T10:00:00Z');
  const p2 = stats.get('p2')!;
  assert.equal(p2.metWith, false); // only a future meeting
});

test('deriveTouchStats: a future-only meeting leaves lastTouchAt null but still counts', () => {
  const stats = deriveTouchStats(
    [{ personId: 'p1', kind: 'meeting', occurredAt: '2026-04-01T10:00:00Z' }],
    Date.parse('2026-03-10T00:00:00.000Z')
  );
  const p1 = stats.get('p1')!;
  assert.equal(p1.meetingCount, 1);
  assert.equal(p1.metWith, false);
  assert.equal(p1.lastTouchAt, null);
});

test('applyTouchStats: preserves metWith=true and only touches changed people', () => {
  const before = state([
    person({ id: 'p1', metWith: true, touchSource: 'manual' }),
    person({ id: 'p2', lastTouchAt: '2026-03-01T00:00:00Z', meetingCount: 1, emailThreadCount: 0 }),
  ]);
  const stats = deriveTouchStats(
    [{ personId: 'p1', kind: 'email', occurredAt: '2026-03-05T00:00:00Z' }],
    Date.parse('2026-03-10T00:00:00.000Z')
  );
  const { state: next, changed } = applyTouchStats(before, stats, 'google');
  assert.equal(next.people[0].metWith, true);
  assert.equal(next.people[0].touchSource, 'google');
  assert.equal(next.people[0].lastTouchAt, '2026-03-05T00:00:00Z');
  // p2 has no stats → untouched object identity and no change counted.
  assert.equal(next.people[1], before.people[1]);
  assert.equal(changed, 1);
});
