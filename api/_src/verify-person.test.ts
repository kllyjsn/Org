import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVerification } from './verify-person.js';
import type { ResearchedPerson } from './research.js';
import type { Person } from './types.js';

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Sales',
    department: 'Sales',
    role: 'none',
    confidence: 'medium',
    sources: ['https://acme.com/team'],
    sourceDetails: [
      {
        url: 'https://acme.com/team',
        title: null,
        publisher: null,
        publishedAt: null,
        retrievedAt: '2026-01-01T00:00:00.000Z',
        sourceType: 'official',
      },
    ],
    notes: '',
    email: null,
    linkedin: null,
    x: 0,
    y: 0,
    ...patch,
  };
}

function researched(patch: Partial<ResearchedPerson>): ResearchedPerson {
  return {
    name: 'Jane Doe',
    title: 'VP Sales',
    department: 'Sales',
    team: null,
    productLine: null,
    teamEvidence: null,
    reportsToName: null,
    confidence: 'medium',
    source: null,
    sources: [],
    sourceDetails: [],
    freshness: 'fresh',
    corroborationCount: 1,
    lastVerifiedAt: null,
    conflictingTitles: [],
    researchStatus: 'verified',
    ...patch,
  };
}

test('verified result upgrades confidence to high', () => {
  const p = person({ confidence: 'medium' });
  const next = applyVerification(
    p,
    researched({ researchStatus: 'verified' })
  );
  assert.equal(next.confidence, 'high');
  assert.equal(next.researchStatus, 'verified');
  assert.ok(next.lastVerifiedAt);
});

test('low confidence + conflicting does not downgrade or upgrade', () => {
  const p = person({ confidence: 'low' });
  const next = applyVerification(
    p,
    researched({
      researchStatus: 'conflicting',
      confidence: 'high',
      conflictingTitles: ['VP Sales', 'CRO'],
    })
  );
  assert.equal(next.confidence, 'low');
  assert.equal(next.researchStatus, 'conflicting');
  assert.deepEqual(next.conflictingTitles, ['VP Sales', 'CRO']);
});

test('dead sources are removed from the applied result', () => {
  const p = person({});
  const next = applyVerification(
    p,
    researched({
      sources: ['https://acme.com/team', 'https://news.example.com/x'],
      sourceDetails: p.sourceDetails,
    }),
    new Set(['https://acme.com/team'])
  );
  assert.deepEqual(next.sources, ['https://news.example.com/x']);
  assert.equal(next.sourceDetails?.length, 0);
});
