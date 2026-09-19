import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import {
  canonicalProfileUrl,
  classifyUrl,
  findNextButton,
  parsePage,
  splitOgTitle,
} from '../src/parsers';

function fixture(name: string): Document {
  const html = readFileSync(
    resolve(import.meta.dirname, 'fixtures', name),
    'utf8'
  );
  return parseHTML(html).document as unknown as Document;
}

test('classifyUrl recognises LinkedIn page kinds', () => {
  assert.equal(classifyUrl('https://www.linkedin.com/in/jane-doe/'), 'profile');
  assert.equal(
    classifyUrl('https://www.linkedin.com/in/jane-doe/details/experience/'),
    'other'
  );
  assert.equal(
    classifyUrl('https://www.linkedin.com/sales/search/people?query=x'),
    'sales_search'
  );
  assert.equal(
    classifyUrl('https://www.linkedin.com/sales/lists/people/123?page=2'),
    'sales_list'
  );
  assert.equal(classifyUrl('https://www.linkedin.com/feed/'), 'other');
  assert.equal(classifyUrl('https://example.com/in/jane'), 'other');
  assert.equal(classifyUrl('not a url'), 'other');
});

test('canonicalProfileUrl strips tracking and resolves relative hrefs', () => {
  assert.equal(
    canonicalProfileUrl('https://www.linkedin.com/in/jane-doe?trk=abc'),
    'https://www.linkedin.com/in/jane-doe'
  );
  assert.equal(
    canonicalProfileUrl('/sales/lead/ACwAAA123,NAME_SEARCH,xyz?_ntb=1'),
    'https://www.linkedin.com/sales/lead/ACwAAA123'
  );
  assert.equal(canonicalProfileUrl('https://evil.com/in/jane'), null);
  assert.equal(canonicalProfileUrl(null), null);
});

test('splitOgTitle splits "Name - Title - Company | LinkedIn"', () => {
  assert.deepEqual(
    splitOgTitle('Jordan Example - VP Engineering - Acme Robotics | LinkedIn'),
    { name: 'Jordan Example', title: 'VP Engineering', company: 'Acme Robotics' }
  );
  assert.deepEqual(splitOgTitle('Jordan Example | LinkedIn'), {
    name: 'Jordan Example',
    title: null,
    company: null,
  });
});

test('parses a public profile via JSON-LD', () => {
  const ctx = parsePage(
    fixture('profile-public.html'),
    'https://www.linkedin.com/in/jordan-example-1a2b3c?trk=public_profile'
  );
  assert.equal(ctx.kind, 'profile');
  assert.deepEqual(ctx.person, {
    name: 'Jordan Example',
    title: 'VP Engineering',
    company: 'Acme Robotics',
    location: 'Austin, Texas',
    linkedinUrl: 'https://www.linkedin.com/in/jordan-example-1a2b3c',
  });
});

test('parses an authenticated profile from aria/data attributes', () => {
  const ctx = parsePage(
    fixture('profile-authenticated.html'),
    'https://www.linkedin.com/in/priya-sample/'
  );
  assert.equal(ctx.kind, 'profile');
  assert.deepEqual(ctx.person, {
    name: 'Priya Sample',
    title: 'Head of Revenue Operations | Scaling GTM at Globex',
    company: 'Globex Corporation',
    location: 'Berlin, Germany',
    linkedinUrl: 'https://www.linkedin.com/in/priya-sample',
  });
});

test('parses Sales Navigator search results, skipping promos and duplicates', () => {
  const doc = fixture('sales-search.html');
  const ctx = parsePage(
    doc,
    'https://www.linkedin.com/sales/search/people?query=(company:initech)'
  );
  assert.equal(ctx.kind, 'sales_search');
  assert.equal(ctx.people.length, 3);
  assert.deepEqual(ctx.people[0], {
    name: 'Ana Fixture',
    title: 'Chief Information Officer',
    company: 'Initech',
    location: 'Denver, Colorado, United States',
    linkedinUrl: 'https://www.linkedin.com/sales/lead/ACwAAAExample1',
  });
  assert.equal(ctx.people[1].name, 'Ben Placeholder');
  assert.equal(ctx.people[1].location, 'Remote');
  assert.deepEqual(ctx.people[2], {
    name: 'Chen Sample',
    title: 'Staff Platform Engineer',
    company: 'Initech',
    location: null,
    linkedinUrl: 'https://www.linkedin.com/sales/lead/ACwAAAExample3',
  });
  assert.deepEqual(ctx.pagination, { hasNext: true, page: 1, total: 94 });
  assert.ok(findNextButton(doc));
});

test('parses a Sales Navigator lead list table on its last page', () => {
  const doc = fixture('sales-list.html');
  const ctx = parsePage(
    doc,
    'https://www.linkedin.com/sales/lists/people/9001?page=2'
  );
  assert.equal(ctx.kind, 'sales_list');
  assert.deepEqual(
    ctx.people.map((p) => [p.name, p.title, p.company]),
    [
      ['Dana Mock', 'SVP, Supply Chain', 'Umbrella Corp'],
      ['Eli Stand-in', 'Procurement Manager', 'Umbrella Corp'],
    ]
  );
  assert.equal(
    ctx.people[0].linkedinUrl,
    'https://www.linkedin.com/sales/lead/ACwAAAListOne'
  );
  assert.deepEqual(ctx.pagination, { hasNext: false, page: 2, total: 2 });
  assert.equal(findNextButton(doc), null);
});

test('non-LinkedIn pages yield an empty context', () => {
  const doc = parseHTML('<html><body><h1>Hi</h1></body></html>')
    .document as unknown as Document;
  const ctx = parsePage(doc, 'https://example.com/');
  assert.equal(ctx.kind, 'other');
  assert.equal(ctx.person, null);
  assert.deepEqual(ctx.people, []);
});
