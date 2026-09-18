import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBackgroundResearch } from './background-refresh.js';
import type { ResearchResult } from './research.js';
import type { MapState, Person } from './types.js';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1',
    name: 'Ada Lovelace',
    title: 'CTO',
    department: 'Engineering',
    role: 'champion',
    confidence: 'high',
    sources: ['https://example.com/old'],
    notes: 'User-authored note',
    email: 'ada@example.com',
    linkedin: null,
    x: 100,
    y: 200,
    ...overrides,
  };
}

function state(existing: Person): MapState {
  return {
    people: [existing],
    edges: [],
    meta: {
      domain: 'example.com',
      companyName: 'Example',
      researchedAt: null,
      tier: 'T0',
      provider: null,
      refreshCadence: 'weekly',
      initiatives: [],
    },
  };
}

function result(
  overrides: Partial<ResearchResult['people'][number]> = {}
): ResearchResult {
  return {
    companyName: 'Example',
    companyProfile: null,
    domain: 'example.com',
    provider: 'gemini',
    tier: 'T0',
    demo: false,
    initiatives: [],
    complete: true,
    people: [
      {
        name: 'Ada Lovelace',
        title: 'Chief Technology Officer',
        department: 'Technology',
        team: null,
        productLine: null,
        teamEvidence: 'inferred',
        reportsToName: null,
        confidence: 'high',
        source: 'https://example.com/about',
        sources: ['https://example.com/about'],
        sourceDetails: [],
        freshness: 'fresh',
        corroborationCount: 1,
        lastVerifiedAt: '2026-09-13T00:00:00.000Z',
        conflictingTitles: [],
        researchStatus: 'verified',
        ...overrides,
      },
    ],
  };
}

test('background refresh preserves user fields while applying verified titles', () => {
  const merged = mergeBackgroundResearch(state(person()), result());
  const updated = merged.people[0];
  assert.equal(updated.title, 'Chief Technology Officer');
  assert.equal(updated.notes, 'User-authored note');
  assert.equal(updated.role, 'champion');
  assert.equal(updated.email, 'ada@example.com');
  assert.equal(updated.x, 100);
  assert.equal(updated.y, 200);
  assert.deepEqual(updated.sources, [
    'https://example.com/old',
    'https://example.com/about',
  ]);
  assert.ok(merged.meta.nextRefreshAt);
});

test('background refresh flags unsupported title changes without overwriting', () => {
  const merged = mergeBackgroundResearch(
    state(person()),
    result({
      title: 'Chief Financial Officer',
      confidence: 'medium',
      researchStatus: 'possibly_stale',
    })
  );
  const updated = merged.people[0];
  assert.equal(updated.title, 'CTO');
  assert.equal(updated.researchStatus, 'conflicting');
  assert.deepEqual(updated.conflictingTitles, ['Chief Financial Officer']);
});

test('background refresh matches nickname variants instead of duplicating', () => {
  const existing = person({ name: 'Bob Komin', title: 'CFO' });
  const researched = result({
    name: 'Robert Komin',
    title: 'Chief Financial Officer',
  });
  const merged = mergeBackgroundResearch(state(existing), researched);
  assert.equal(merged.people.length, 1);
  assert.equal(merged.people[0].name, 'Bob Komin');
  assert.equal(merged.people[0].title, 'Chief Financial Officer');
});
