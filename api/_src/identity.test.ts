import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchPerson,
  normalizeEmail,
  normalizeLinkedin,
  pairPeople,
} from './identity.js';

test('normalizeLinkedin strips protocol, www, query, and case', () => {
  assert.equal(
    normalizeLinkedin('https://www.linkedin.com/in/Jane-Doe/?x=1'),
    'linkedin.com/in/jane-doe'
  );
  assert.equal(
    normalizeLinkedin('https://linkedin.com/in/jane-doe'),
    'linkedin.com/in/jane-doe'
  );
  assert.equal(
    normalizeLinkedin('linkedin.com/in/jane-doe#about'),
    'linkedin.com/in/jane-doe'
  );
});

test('normalizeLinkedin handles country subdomains', () => {
  assert.equal(
    normalizeLinkedin('https://uk.linkedin.com/in/jane-doe'),
    'linkedin.com/in/jane-doe'
  );
  assert.equal(
    normalizeLinkedin('uk.linkedin.com/in/jane-doe/'),
    'linkedin.com/in/jane-doe'
  );
});

test('normalizeLinkedin rejects non-/in/ and non-linkedin URLs', () => {
  assert.equal(normalizeLinkedin('https://linkedin.com/company/acme'), null);
  assert.equal(normalizeLinkedin('https://example.com/in/jane'), null);
  assert.equal(normalizeLinkedin(null), null);
  assert.equal(normalizeLinkedin(''), null);
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Jane@Acme.COM '), 'jane@acme.com');
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail('  '), null);
});

test('matchPerson: same linkedin matches even when names differ', () => {
  const people = [
    { name: 'Jane Doe', linkedin: 'https://uk.linkedin.com/in/jane-doe' },
  ];
  const hit = matchPerson(
    { name: 'Janet Doehler', linkedin: 'www.linkedin.com/in/Jane-Doe' },
    people
  );
  assert.equal(hit, people[0]);
});

test('matchPerson: different linkedin with same name does NOT match', () => {
  const people = [
    { name: 'Jane Doe', linkedin: 'https://linkedin.com/in/jane-doe' },
  ];
  // A conflicting stronger key disqualifies the weaker name match.
  const hit = matchPerson(
    { name: 'Jane Doe', linkedin: 'https://linkedin.com/in/jane-d' },
    people
  );
  assert.equal(hit, null);
  const miss = matchPerson(
    { name: 'John Smith', linkedin: 'https://linkedin.com/in/john-smith' },
    people
  );
  assert.equal(miss, null);
});

test('matchPerson falls back to email, then canonical name with alias', () => {
  const people = [
    { name: 'Robert Komin', email: 'bob@acme.com' },
    { name: 'Ada Byron', email: 'ada@acme.com' },
  ];
  assert.equal(
    matchPerson({ name: 'R Komin', email: 'BOB@acme.com' }, people),
    people[0]
  );
  // No linkedin/email → canonical name with nickname resolution.
  assert.equal(
    matchPerson(
      { name: 'Bob Komin' },
      [{ name: 'Robert Komin', email: null }]
    )?.name,
    'Robert Komin'
  );
});

test('pairPeople pairs on linkedin across renames, once each', () => {
  const prev = [
    { name: 'Jane Doe', linkedin: 'https://linkedin.com/in/jane' },
    { name: 'Bob Smith', linkedin: 'https://linkedin.com/in/bob' },
  ];
  const curr = [
    { name: 'Jane Doe-Wilson', linkedin: 'https://linkedin.com/in/jane' },
    { name: 'Someone New' },
  ];
  const { pairs, removed, added } = pairPeople(prev, curr);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0].name, 'Jane Doe');
  assert.equal(pairs[0][1].name, 'Jane Doe-Wilson');
  assert.deepEqual(removed.map((p) => p.name), ['Bob Smith']);
  assert.deepEqual(added.map((p) => p.name), ['Someone New']);
});
