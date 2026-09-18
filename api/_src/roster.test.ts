import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRosterRows } from './roster.js';
import type { RosterPersonRow } from './roster.js';

const existing = {
  id: '1', workspace_id: 'w', domain: 'acme.com', person_key: 'ada-lovelace', name: 'Ada Lovelace',
  title: 'Engineer', function: 'engineering', seniority: 'ic', location: 'London',
  linkedin: 'https://linkedin.com/in/ada-lovelace', email: 'ada@acme.com', manager_key: null,
  source: 'csv', source_url: null, confidence: 'low', status: 'added', map_person_id: 'p1',
  raw: null, first_seen_at: '2025-01-01T00:00:00Z', last_seen_at: '2025-01-02T00:00:00Z',
} as RosterPersonRow;

test('roster merges without downgrading user state', () => {
  const row = mergeRosterRows(existing, {
    name: 'Ada Lovelace', title: 'Senior Staff Software Engineer', location: null,
    linkedin: null, email: null, managerKey: 'boss', source: 'sumble', sourceUrl: 'https://sumble/p',
    jobLevel: 'VP',
  }, '2025-02-01T00:00:00Z');
  assert.equal(row.status, 'added');
  assert.equal(row.title, 'Senior Staff Software Engineer');
  assert.equal(row.linkedin, existing.linkedin);
  assert.equal(row.seniority, 'vp');
  assert.equal(row.first_seen_at, existing.first_seen_at);
  assert.equal(row.last_seen_at, '2025-02-01T00:00:00Z');
  assert.equal(row.map_person_id, 'p1');
  assert.equal(row.source, 'sumble');
});

test('roster uses a provider function hint for unclassified titles', () => {
  const row = mergeRosterRows(null, {
    name: 'Taylor Morgan',
    title: null,
    location: null,
    linkedin: null,
    email: null,
    managerKey: null,
    source: 'sumble',
    sourceUrl: null,
    functionHint: 'Security',
  }, '2025-02-01T00:00:00Z');
  assert.equal(row.function, 'security');
  assert.equal(row.seniority, 'unknown');
});
