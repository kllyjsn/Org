import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractJson,
  normalizePeople,
  resolveSourceUrls,
} from './research.js';

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

test('subdomains of one publisher count as a single source', () => {
  const [person] = normalizePeople([
    {
      name: 'Ada Byron',
      title: 'CTO',
      confidence: 'high',
      sources: [
        'https://ir.acme.com/governance',
        'https://www.acme.com/leadership',
        'https://profiles.example.net/ada',
      ],
    },
  ]);

  assert.equal(person.corroborationCount, 2);
});

test('grounding redirects resolve and dead citations are dropped', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: unknown
  ) => {
    const url = String(input);
    if (url.includes('grounding-api-redirect')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://real.example.com/profile' },
      });
    }
    if (url.includes('dead.example.com')) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const people = normalizePeople([
      {
        name: 'Ada Byron',
        title: 'CTO',
        confidence: 'high',
        researchStatus: 'verified',
        sources: [
          'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
          'https://dead.example.com/gone',
        ],
      },
    ]);
    await resolveSourceUrls(people, []);
    const [person] = people;
    assert.deepEqual(person.sources, ['https://real.example.com/profile']);
    assert.equal(person.corroborationCount, 1);
    assert.equal(person.researchStatus, 'verified');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a person whose only citation is dead is downgraded', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as typeof fetch;
  try {
    const people = normalizePeople([
      {
        name: 'Grace Hopper',
        title: 'VP Engineering',
        confidence: 'high',
        researchStatus: 'verified',
        sources: ['https://gone.example.com/404'],
      },
    ]);
    assert.equal(people[0].researchStatus, 'verified');
    await resolveSourceUrls(people, []);
    const [person] = people;
    assert.deepEqual(person.sources, []);
    assert.equal(person.corroborationCount, 0);
    assert.equal(person.lastVerifiedAt, null);
    assert.equal(person.researchStatus, 'possibly_stale');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sourceless claims are not presented as verified', () => {
  const [person] = normalizePeople([
    {
      name: 'Jean-Philippe Fricker',
      title: 'Chief System Architect',
      confidence: 'high',
      teamEvidence: 'sourced',
      team: 'Engineering',
      sources: [],
    },
  ]);

  assert.equal(person.confidence, 'medium');
  assert.equal(person.teamEvidence, 'inferred');
  assert.equal(person.researchStatus, 'possibly_stale');
});

test('dedupes nickname + full-name aliases for the same person', () => {
  const people = normalizePeople([
    { name: 'Robert Komin', title: 'Chief Financial Officer' },
    { name: 'Bob Komin', title: 'CFO' },
    { name: 'Mike Feldman', title: 'COO' },
    { name: 'Michael Feldman', title: 'Chief Operating Officer' },
  ]);
  assert.equal(people.length, 2);
});

test('does not merge distinct people sharing a last name', () => {
  const people = normalizePeople([
    { name: 'Andrew Feldman', title: 'CEO' },
    { name: 'Michael Feldman', title: 'COO' },
  ]);
  assert.equal(people.length, 2);
});
