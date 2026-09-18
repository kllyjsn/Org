import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import {
  bearerToken,
  hashExtensionToken,
  isExtensionOrigin,
  makeRequireExtensionAuth,
  newExtensionToken,
  normalizeLinkedinUrl,
  parseExtensionPeople,
  rosterInputsFromExtension,
} from './extension-tokens.js';
import { mergeRosterRows, personKeyFor } from './roster.js';
import type { UserRow } from './types.js';

const USER: UserRow = {
  id: 'u1',
  email: 'ada@acme.com',
  name: 'Ada',
  password_hash: 'x',
  created_at: '2026-01-01T00:00:00.000Z',
};

test('extension tokens are prefixed, unique and only stored hashed', () => {
  const a = newExtensionToken();
  const b = newExtensionToken();
  assert.match(a, /^tdx_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(a, b);
  assert.equal(hashExtensionToken(a).length, 64);
  assert.notEqual(hashExtensionToken(a), hashExtensionToken(b));
  assert.equal(hashExtensionToken(a), hashExtensionToken(a));
});

test('bearerToken only accepts extension-prefixed bearer credentials', () => {
  assert.equal(bearerToken('Bearer tdx_abc'), 'tdx_abc');
  assert.equal(bearerToken('bearer   tdx_abc'), 'tdx_abc');
  assert.equal(bearerToken('Bearer sess_abc'), null);
  assert.equal(bearerToken('Basic tdx_abc'), null);
  assert.equal(bearerToken(undefined), null);
});

test('chrome-extension origins are recognised without matching arbitrary hosts', () => {
  assert.equal(isExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(isExtensionOrigin('chrome-extension://evil.example.com'), false);
  assert.equal(isExtensionOrigin('https://www.linkedin.com'), false);
});

test('requireExtensionAuth resolves the user from the hashed bearer token', async () => {
  const token = newExtensionToken();
  const seen: string[] = [];
  const app = new Hono<{ Variables: { user: UserRow } }>();
  app.use(
    '/api/extension/*',
    makeRequireExtensionAuth(async (hash) => {
      seen.push(hash);
      return hash === hashExtensionToken(token) ? USER : null;
    })
  );
  app.get('/api/extension/me', (c) => c.json({ id: c.get('user').id }));

  const ok = await app.request('/api/extension/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: 'u1' });
  assert.deepEqual(seen, [hashExtensionToken(token)]);

  const wrong = await app.request('/api/extension/me', {
    headers: { authorization: 'Bearer tdx_not-a-real-token' },
  });
  assert.equal(wrong.status, 401);

  const missing = await app.request('/api/extension/me');
  assert.equal(missing.status, 401);
  assert.equal(seen.length, 2, 'lookup is skipped when no bearer token is present');
});

test('normalizeLinkedinUrl canonicalises profile and Sales Navigator lead URLs', () => {
  assert.equal(
    normalizeLinkedinUrl('https://www.linkedin.com/in/Ada-Lovelace-123/?trk=x#top'),
    'https://www.linkedin.com/in/ada-lovelace-123'
  );
  assert.equal(
    normalizeLinkedinUrl('linkedin.com/in/ada'),
    'https://www.linkedin.com/in/ada'
  );
  assert.equal(
    normalizeLinkedinUrl('https://www.linkedin.com/sales/lead/ACwAAAbc123,NAME_SEARCH,xyz?x=1'),
    'https://www.linkedin.com/sales/lead/ACwAAAbc123'
  );
  assert.equal(normalizeLinkedinUrl('https://evil.com/in/ada'), null);
  assert.equal(normalizeLinkedinUrl('https://www.linkedin.com/company/acme'), null);
  assert.equal(normalizeLinkedinUrl(42), null);
});

test('parseExtensionPeople validates, trims and dedupes by profile URL', () => {
  const people = parseExtensionPeople([
    {
      name: '  Ada Lovelace ',
      title: 'VP Engineering',
      company: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/in/ada/',
      location: 'London',
      email: 'ADA@acme.com',
    },
    { name: 'Ada Lovelace', linkedinUrl: 'https://linkedin.com/in/ADA?x=1' },
    { name: '', linkedinUrl: 'https://linkedin.com/in/nobody' },
    { name: 'Grace Hopper', title: 7 },
    'garbage',
    null,
  ]);
  assert.deepEqual(people, [
    {
      name: 'Ada Lovelace',
      title: 'VP Engineering',
      company: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
      location: 'London',
      email: 'ada@acme.com',
    },
    {
      name: 'Grace Hopper',
      title: null,
      company: null,
      linkedinUrl: null,
      location: null,
      email: null,
    },
  ]);
  assert.deepEqual(parseExtensionPeople('nope'), []);
});

test('extension people become roster upserts keyed by LinkedIn slug', () => {
  const [input] = rosterInputsFromExtension(
    parseExtensionPeople([
      {
        name: 'Ada Lovelace',
        title: 'VP Engineering',
        linkedinUrl: 'https://www.linkedin.com/in/ada',
        location: 'London',
      },
    ]),
    'linkedin_url'
  );
  assert.ok(input);
  assert.equal(input.source, 'linkedin_url');
  assert.equal(input.confidence, 'high');
  assert.equal(input.sourceUrl, 'https://www.linkedin.com/in/ada');
  assert.equal(personKeyFor(input.name, input.linkedin), 'ada');

  const row = mergeRosterRows(null, input, '2026-01-01T00:00:00.000Z');
  assert.equal(row.function, 'engineering');
  assert.equal(row.seniority, 'vp');
  assert.equal(row.status, 'suggested');

  const [lead] = rosterInputsFromExtension(
    parseExtensionPeople([{ name: 'Grace Hopper', title: 'CISO' }]),
    'sales_navigator'
  );
  assert.ok(lead);
  assert.equal(lead.source, 'sales_navigator');
  assert.equal(lead.confidence, 'medium');
  assert.equal(personKeyFor(lead.name, lead.linkedin), 'grace hopper');
});

test('a bulk provider sync may replace a sales_navigator source, but not vice versa', () => {
  const [lead] = rosterInputsFromExtension(
    parseExtensionPeople([{ name: 'Grace Hopper', title: 'CISO' }]),
    'sales_navigator'
  );
  const first = mergeRosterRows(null, lead!, '2026-01-01T00:00:00.000Z');
  const existing = { ...first, workspace_id: 'w', domain: 'acme.com' };
  const bulk = mergeRosterRows(
    existing,
    { ...lead!, source: 'sumble', sourceUrl: 'https://sumble/p' },
    '2026-01-02T00:00:00.000Z'
  );
  assert.equal(bulk.source, 'sumble');
  const again = mergeRosterRows(
    { ...bulk, workspace_id: 'w', domain: 'acme.com' },
    lead!,
    '2026-01-03T00:00:00.000Z'
  );
  assert.equal(again.source, 'sumble');
});
