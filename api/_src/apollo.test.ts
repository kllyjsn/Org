import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apolloOrgPeople } from './apollo.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.APOLLO_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.APOLLO_API_KEY;
  else process.env.APOLLO_API_KEY = originalKey;
});

interface Call {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Mock fetch that routes by URL path to canned responses. */
function mockFetch(handlers: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace('https://api.apollo.io/api/v1', '');
    const call: Call = {
      path,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])
      ),
    };
    calls.push(call);
    const handler = handlers[path];
    if (!handler) return new Response('not found', { status: 404 });
    const result = handler(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

const SEARCH_PAGE = {
  total_entries: 2,
  people: [
    {
      id: 'p1',
      first_name: 'Ada',
      last_name_obfuscated: 'Lo***ce',
      title: 'Chief Technology Officer',
      organization: { name: 'Acme Corp' },
    },
    {
      id: 'p2',
      first_name: 'Grace',
      last_name_obfuscated: 'Ho***r',
      title: 'VP Engineering',
      organization: { name: 'Acme Corp' },
    },
  ],
  pagination: { page: 1, per_page: 100, total_entries: 2 },
};

test('apolloOrgPeople resolves search hits through bulk_match', async () => {
  process.env.APOLLO_API_KEY = 'test-key';
  const calls = mockFetch({
    '/mixed_people/api_search': (call) => {
      assert.deepEqual(call.body.q_organization_domains_list, ['acme.test']);
      assert.equal(call.headers['x-api-key'], 'test-key');
      return SEARCH_PAGE;
    },
    '/people/bulk_match': (call) => {
      assert.deepEqual(call.body.details, [{ id: 'p1' }, { id: 'p2' }]);
      return {
        matches: [
          {
            id: 'p1',
            person: {
              name: 'Ada Lovelace',
              title: 'Chief Technology Officer',
              linkedin_url: 'https://linkedin.com/in/ada',
              email: 'ada@acme.test',
              seniority: 'c_suite',
              departments: ['engineering'],
              city: 'London',
              country: 'United Kingdom',
            },
          },
          {
            id: 'p2',
            person: {
              first_name: 'Grace',
              last_name: 'Hopper',
              title: 'VP Engineering',
              seniority: 'vp',
              functions: ['engineering_information_technology'],
            },
          },
        ],
      };
    },
  });
  const org = await apolloOrgPeople('acme.test', {
    max: 100,
    deadlineMs: Date.now() + 10_000,
  });
  assert.equal(calls.length, 2);
  assert.equal(org?.companyName, 'Acme Corp');
  assert.equal(org?.total, 2);
  assert.equal(org?.people.length, 2);
  const ada = org!.people[0];
  assert.equal(ada.name, 'Ada Lovelace');
  assert.equal(ada.title, 'Chief Technology Officer');
  assert.equal(ada.linkedin, 'https://linkedin.com/in/ada');
  assert.equal(ada.email, 'ada@acme.test');
  assert.equal(ada.jobLevel, 'c_level'); // apollo's 'c_suite' normalized
  assert.equal(ada.functionHint, 'engineering');
  assert.equal(ada.location, 'London, United Kingdom');
  const grace = org!.people[1];
  assert.equal(grace.name, 'Grace Hopper'); // first+last fallback
  assert.equal(grace.jobLevel, 'vp');
  assert.equal(grace.functionHint, 'engineering_information_technology');
});

test('bulk_match chunks ids by 10', async () => {
  process.env.APOLLO_API_KEY = 'test-key';
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const calls = mockFetch({
    // A partial page (<100) ends pagination, so all 12 arrive on page 1.
    '/mixed_people/api_search': () => ({
      people: ids.map((id) => ({ id, first_name: 'N', title: 'T' })),
      total_entries: 12,
    }),
    '/people/bulk_match': (call) => ({
      matches: (call.body.details as { id: string }[]).map(({ id }) => ({
        id,
        person: { name: `Person ${id}`, title: 'T' },
      })),
    }),
  });
  const org = await apolloOrgPeople('acme.test', {
    max: 100,
    deadlineMs: Date.now() + 10_000,
  });
  assert.equal(org?.people.length, 12);
  const bulkCalls = calls.filter((c) => c.path === '/people/bulk_match');
  assert.equal(bulkCalls.length, 2);
  assert.equal((bulkCalls[0].body.details as unknown[]).length, 10);
  assert.equal((bulkCalls[1].body.details as unknown[]).length, 2);
});

test('a full page of search hits triggers a second page', async () => {
  process.env.APOLLO_API_KEY = 'test-key';
  const hundred = Array.from({ length: 100 }, (_, i) => ({
    id: `p${i}`,
    first_name: 'N',
    title: 'T',
  }));
  const calls = mockFetch({
    '/mixed_people/api_search': (call) =>
      (call.body.page as number) === 1
        ? { people: hundred, total_entries: 101 }
        : { people: [{ id: 'p100', first_name: 'N', title: 'T' }] },
    '/people/bulk_match': (call) => ({
      matches: (call.body.details as { id: string }[]).map(({ id }) => ({
        id,
        person: { name: `P${id}` },
      })),
    }),
  });
  const org = await apolloOrgPeople('acme.test', {
    max: 200,
    deadlineMs: Date.now() + 10_000,
  });
  assert.equal(calls.filter((c) => c.path === '/mixed_people/api_search').length, 2);
  assert.equal(org?.total, 101);
  assert.equal(org?.people.length, 101);
});

test('returns null without a key and tolerates API failures', async () => {
  delete process.env.APOLLO_API_KEY;
  assert.equal(
    await apolloOrgPeople('acme.test', { max: 10, deadlineMs: Date.now() + 5_000 }),
    null
  );

  process.env.APOLLO_API_KEY = 'test-key';
  mockFetch({
    '/mixed_people/api_search': () => new Response('denied', { status: 403 }),
  });
  assert.equal(
    await apolloOrgPeople('acme.test', { max: 10, deadlineMs: Date.now() + 5_000 }),
    null
  );

  // Search works, bulk_match dies → people enriched so far are returned.
  mockFetch({
    '/mixed_people/api_search': () => SEARCH_PAGE,
    '/people/bulk_match': () => new Response('oops', { status: 500 }),
  });
  const org = await apolloOrgPeople('acme.test', {
    max: 10,
    deadlineMs: Date.now() + 5_000,
  });
  assert.equal(org?.companyName, 'Acme Corp');
  assert.equal(org?.people.length, 0);
  assert.equal(org?.total, 2);
});
