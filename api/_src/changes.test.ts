import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMapStates } from './changes.js';
import type { MapState, Person } from './types.js';

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

test('a renamed person with the same linkedin is neither added nor removed', () => {
  const before = state([
    person({
      id: 'p1',
      name: 'Jane Doe',
      linkedin: 'https://www.linkedin.com/in/jane-doe',
    }),
  ]);
  const after = state([
    person({
      id: 'p1',
      name: 'Jane Doe-Wilson',
      linkedin: 'https://uk.linkedin.com/in/jane-doe/',
    }),
  ]);
  const changes = compareMapStates(before, after);
  assert.equal(
    changes.some(
      (c) => c.type === 'person_added' || c.type === 'person_removed'
    ),
    false
  );
});
