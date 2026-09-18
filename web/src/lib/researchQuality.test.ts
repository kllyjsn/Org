import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceScore } from './researchQuality';
import type { Person, ResearchSource } from '../types';

function src(url: string, patch: Partial<ResearchSource> = {}): ResearchSource {
  return {
    url,
    title: null,
    publisher: null,
    publishedAt: null,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    sourceType: 'news',
    ...patch,
  };
}

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Sales',
    department: 'Sales',
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

test('a person with no evidence scores 0 / weak', () => {
  const result = evidenceScore(person({ confidence: 'high' }));
  assert.equal(result.score, 0);
  assert.equal(result.band, 'weak');
  assert.deepEqual(result.reasons, ['No public evidence']);
});

test('3 fresh verified high-confidence sources incl. official is strong', () => {
  const now = Date.parse('2026-03-01T00:00:00.000Z');
  const result = evidenceScore(
    person({
      confidence: 'high',
      researchStatus: 'verified',
      sources: ['a', 'b', 'c'],
      sourceDetails: [
        src('https://acme.com/team', {
          sourceType: 'official',
          publishedAt: '2026-02-01T00:00:00.000Z',
        }),
        src('https://news.example.com/a', {
          publishedAt: '2026-01-15T00:00:00.000Z',
        }),
        src('https://blog.example.org/b', {
          publishedAt: '2026-01-10T00:00:00.000Z',
        }),
      ],
    }),
    now
  );
  // 75 (3 sources) + 15 (fresh) + 10 (verified) + 5 (high) + 10 (official)
  assert.equal(result.score, 100);
  assert.equal(result.band, 'strong');
  assert.ok(result.reasons.includes('Official source'));
});

test('conflicting titles pull a 2-source person down', () => {
  // 60 (2 sources) + 0 (unknown freshness) - 25 (conflicting) - 10 (low) = 25
  const result = evidenceScore(
    person({
      confidence: 'low',
      researchStatus: 'conflicting',
      sources: ['a', 'b'],
      sourceDetails: [
        src('https://news.example.com/a'),
        src('https://blog.example.org/b'),
      ],
      freshness: 'unknown',
      corroborationCount: 2,
    })
  );
  assert.equal(result.score, 25);
  assert.equal(result.band, 'weak');
  // Same person verified instead: 60 + 10 = 70 → strong boundary.
  const verified = evidenceScore(
    person({
      confidence: 'low',
      researchStatus: 'verified',
      sources: ['a', 'b'],
      sourceDetails: [
        src('https://news.example.com/a'),
        src('https://blog.example.org/b'),
      ],
      freshness: 'unknown',
      corroborationCount: 2,
    })
  );
  // 60 + 10 - 10 = 60 → moderate
  assert.equal(verified.score, 60);
  assert.equal(verified.band, 'moderate');
});

test('score clamps at 0', () => {
  const result = evidenceScore(
    person({
      confidence: 'low',
      researchStatus: 'conflicting',
      sources: ['a'],
      sourceDetails: [src('https://news.example.com/a')],
      freshness: 'stale',
      corroborationCount: 1,
    })
  );
  // 40 - 15 - 25 - 10 = -10 → clamped to 0
  assert.equal(result.score, 0);
  assert.equal(result.band, 'weak');
});
