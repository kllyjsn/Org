import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJson, normalizePeople } from './research.js';

test('truncated research JSON keeps the complete people it did return', () => {
  const truncated = `{
    "companyName": "Acme",
    "people": [
      { "name": "Ada Byron", "title": "CTO" },
      { "name": "Grace Hopper", "title": "VP Engineering" },
      { "name": "Alan Tur`;
  const parsed = extractJson(truncated) as {
    companyName?: string;
    people?: { name: string }[];
  };
  assert.equal(parsed.companyName, 'Acme');
  assert.deepEqual(
    parsed.people?.map((person) => person.name),
    ['Ada Byron', 'Grace Hopper']
  );
});

test('malformed JSON with no complete element still fails loudly', () => {
  assert.throws(() => extractJson('not json at all'));
});

test('freshness and corroboration derive from dated, distinct sources', () => {
  const nowMs = Date.parse('2026-09-12T00:00:00.000Z');
  const [person] = normalizePeople(
    [
      {
        name: 'Ada Byron',
        title: 'CTO',
        confidence: 'high',
        researchStatus: 'verified',
        sources: [
          {
            url: 'https://acme.com/leadership',
            publishedAt: '2026-08-01',
            sourceType: 'official',
          },
          {
            url: 'https://acme.com/press/ada',
            publishedAt: '2026-07-01',
            sourceType: 'press',
          },
          {
            url: 'https://news.example.com/ada',
            publishedAt: '2020-01-01',
            sourceType: 'news',
          },
        ],
      },
    ],
    60,
    nowMs
  );

  assert.equal(person.freshness, 'fresh');
  // Two distinct domains, not three source URLs.
  assert.equal(person.corroborationCount, 2);
  assert.equal(person.lastVerifiedAt, new Date(nowMs).toISOString());
});

test('only-stale evidence downgrades research status', () => {
  const nowMs = Date.parse('2026-09-12T00:00:00.000Z');
  const [person] = normalizePeople(
    [
      {
        name: 'Grace Hopper',
        title: 'VP Engineering',
        confidence: 'high',
        researchStatus: 'verified',
        sources: [
          {
            url: 'https://acme.com/old',
            publishedAt: '2018-01-01',
            sourceType: 'official',
          },
        ],
      },
    ],
    60,
    nowMs
  );

  assert.equal(person.freshness, 'stale');
  assert.equal(person.researchStatus, 'possibly_stale');
});

test('numeric confidence and non-url sources are normalized', () => {
  const [person] = normalizePeople([
    {
      name: 'Alan Turing',
      title: 'Principal Engineer',
      confidence: 0.92,
      sources: ['not-a-url', { url: 'https://acme.com/team' }],
    },
  ]);

  assert.equal(person.confidence, 'high');
  assert.deepEqual(person.sources, ['https://acme.com/team']);
  assert.equal(person.freshness, 'unknown');
});
