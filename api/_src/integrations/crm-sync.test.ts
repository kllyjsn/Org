import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPushResults,
  buyingRoleFromCrm,
  contactsToPush,
  mergeCrmContacts,
} from './crm-sync.js';
import type { MapState, Person } from '../types.js';
import type { CrmContact } from './crm-types.js';

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Eng',
    department: null,
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

function state(people: Person[], metaPatch: Partial<MapState['meta']> = {}): MapState {
  return {
    people,
    edges: [],
    meta: {
      domain: 'acme.com',
      companyName: 'Acme',
      researchedAt: null,
      tier: 'T0',
      provider: null,
      ...metaPatch,
    },
  };
}

function contact(patch: Partial<CrmContact>): CrmContact {
  return {
    id: 'crm-1',
    name: 'New Person',
    title: null,
    email: null,
    linkedin: null,
    url: 'https://crm.test/1',
    role: null,
    ...patch,
  };
}

test('mergeCrmContacts: email match fills gaps only', () => {
  const s = state([person({ id: 'p1', email: 'jane@acme.com', role: 'champion' })]);
  const { state: next, matched, created, updated } = mergeCrmContacts(
    s,
    [contact({ id: 'c9', name: 'Janet Doehler', email: 'jane@acme.com', title: 'CTO', role: 'blocker' })],
    'hubspot',
    { createUnmatched: true }
  );
  assert.equal(matched, 1);
  assert.equal(created, 0);
  assert.equal(updated, 1);
  const p = next.people[0];
  assert.equal(p.crm?.contactId, 'c9');
  assert.equal(p.title, 'VP Eng'); // existing title kept
  assert.equal(p.role, 'champion'); // role only fills 'none'
});

test('mergeCrmContacts: same crm id matches despite rename', () => {
  const s = state([
    person({ id: 'p1', crm: { provider: 'hubspot', contactId: 'c1', url: null } }),
  ]);
  const { state: next, matched } = mergeCrmContacts(
    s,
    [contact({ id: 'c1', name: 'Renamed Person' })],
    'hubspot',
    { createUnmatched: false }
  );
  assert.equal(matched, 1);
  assert.equal(next.people[0].id, 'p1');
});

test('mergeCrmContacts: creates unmatched in a grid below, role from CRM', () => {
  const s = state([person({ id: 'p1', x: 100, y: 500 })]);
  const { state: next, created } = mergeCrmContacts(
    s,
    [
      contact({ id: 'n1', name: 'New One', role: 'Champion' }),
      contact({ id: 'n2', name: 'New Two', role: 'unknown' }),
    ],
    'salesforce',
    { createUnmatched: true }
  );
  assert.equal(created, 2);
  const createdPeople = next.people.slice(1);
  assert.equal(createdPeople[0].role, 'champion');
  assert.equal(createdPeople[0].notes, 'Imported from salesforce');
  assert.equal(createdPeople[1].role, 'none'); // unrecognized → none
  assert.ok(createdPeople[0].y > 500); // below the map
  assert.equal(createdPeople[0].crm?.provider, 'salesforce');
});

test('buyingRoleFromCrm handles salesforce role text', () => {
  assert.equal(buyingRoleFromCrm('Economic Buyer'), 'economic_buyer'); // OCR role text
  assert.equal(buyingRoleFromCrm('Decision Maker'), 'decision_maker');
  assert.equal(buyingRoleFromCrm('random junk'), null);
  assert.equal(buyingRoleFromCrm('Executive Sponsor'), 'champion');
  assert.equal(buyingRoleFromCrm('champion'), 'champion');
  assert.equal(buyingRoleFromCrm(null), null);
});

test('contactsToPush and applyPushResults', () => {
  const s = state(
    [
      person({ id: 'p1', role: 'champion' }),
      person({ id: 'p2', role: 'none' }),
    ],
    {
      strategy: {
        stakeholders: { p2: { stance: 'advocate', nextStep: '', note: '' } },
        tasks: [],
        updatedAt: '',
      },
    }
  );
  const rows = contactsToPush(s);
  assert.equal(rows.length, 2); // role OR stance qualifies
  assert.equal(rows.find((r) => r.personId === 'p2')?.stance, 'advocate');

  const next = applyPushResults(
    s,
    [{ personId: 'p1', crmId: 'c1', url: 'https://x' }],
    'salesforce'
  );
  assert.equal(next.people[0].crm?.contactId, 'c1');
  assert.equal(next.people[1].crm, undefined);
});

import { contactRoleFor, soqlEscape } from './salesforce.js';

test('salesforce role mapping honors picklist fallbacks', () => {
  const full = ['Champion', 'Economic Buyer', 'Decision Maker', 'Technical Buyer', 'Influencer', 'Other'];
  assert.equal(contactRoleFor('champion', full), 'Champion');
  assert.equal(contactRoleFor('economic_buyer', full), 'Economic Buyer');
  assert.equal(contactRoleFor('decision_maker', full), 'Decision Maker');
  assert.equal(contactRoleFor('technical_buyer', full), 'Technical Buyer');
  assert.equal(contactRoleFor('influencer', full), 'Influencer');
  assert.equal(contactRoleFor('blocker', full), 'Other');
  assert.equal(contactRoleFor('none', full), null);
  // restricted picklist falls back
  assert.equal(contactRoleFor('champion', ['Influencer', 'Other']), 'Influencer');
  assert.equal(contactRoleFor('champion', []), 'Champion'); // unknown picklist → first candidate
});

test('soqlEscape escapes quotes and backslashes', () => {
  assert.equal(soqlEscape("O'Brien \\ co"), "O\\'Brien \\\\ co");
});
