import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPerson, normalizeLinkedin } from './identity';

test('normalizeLinkedin strips protocol, www, query, and case', () => {
  assert.equal(
    normalizeLinkedin('https://www.linkedin.com/in/Jane-Doe/?x=1'),
    'linkedin.com/in/jane-doe'
  );
  assert.equal(
    normalizeLinkedin('https://uk.linkedin.com/in/jane-doe'),
    'linkedin.com/in/jane-doe'
  );
  assert.equal(normalizeLinkedin('https://linkedin.com/company/acme'), null);
  assert.equal(normalizeLinkedin(null), null);
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
  assert.equal(
    matchPerson(
      { name: 'Jane Doe', linkedin: 'https://linkedin.com/in/jane-d' },
      people
    ),
    null
  );
});

test('matchPerson falls back to email, then canonical name with alias', () => {
  const people = [{ name: 'Robert Komin', email: 'bob@acme.com' }];
  assert.equal(
    matchPerson({ name: 'R Komin', email: 'BOB@acme.com' }, people),
    people[0]
  );
  assert.equal(
    matchPerson({ name: 'Bob Komin' }, [{ name: 'Robert Komin' }])?.name,
    'Robert Komin'
  );
});
