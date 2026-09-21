import assert from 'node:assert/strict';
import test from 'node:test';
import { templateOutreachDraft } from './outreach.js';
import type { MapState, Person, SellerProfile } from './types.js';

const person: Person = {
  id: 'p1',
  name: 'Jane Chen',
  title: 'VP Revenue Operations',
  department: 'Sales',
  team: 'RevOps',
  role: 'champion',
  confidence: 'high',
  sources: ['https://acme.com/team/jane'],
  notes: 'Met at SKO — owns CRM migration',
  email: 'jane@acme.com',
  linkedin: 'https://linkedin.com/in/janechen',
  x: 0,
  y: 0,
};

const state: MapState = {
  people: [person],
  edges: [],
  meta: {
    domain: 'acme.com',
    companyName: 'Acme',
    researchedAt: null,
    tier: 'T0',
    provider: null,
    initiatives: [
      {
        name: 'CRM consolidation',
        summary: 'Acme is merging three CRMs into one.',
        category: 'operations',
        evidence: ['https://acme.com/blog/crm'],
        relevantPeople: ['Jane Chen'],
        relevantTeams: ['RevOps'],
        salesAngles: ['Position migration-assistance tooling'],
      },
    ],
  },
};

const seller: SellerProfile = {
  companyName: 'Stripe',
  domain: 'stripe.com',
  summary: 'Payments infrastructure',
  products: ['Billing'],
  targetCustomers: ['B2B SaaS'],
  useCases: ['Usage-based billing'],
  proofPoints: ['Processes $1T annually'],
  competitors: [],
  positioning: 'Default billing stack',
  researchedAt: 'now',
};

test('template draft is grounded in the map', () => {
  const draft = templateOutreachDraft(state, person, seller);
  assert.equal(draft.provider, 'template');
  assert.match(draft.emailBody, /Hi Jane/);
  assert.match(draft.emailBody, /Acme/);
  assert.match(draft.emailBody, /CRM consolidation/);
  assert.match(draft.emailBody, /\$1T/);
  assert.ok(draft.linkedinNote.length <= 280);
  assert.ok(draft.talkingPoints.length >= 3);
  assert.deepEqual(draft.evidence, ['https://acme.com/team/jane']);
});

test('template draft works without a seller profile', () => {
  const draft = templateOutreachDraft(state, person, null);
  assert.match(draft.emailBody, /Hi Jane/);
  assert.equal(draft.provider, 'template');
});

test('draft handles a bare person with no initiatives', () => {
  const bare: MapState = {
    people: [{ ...person, notes: '', sources: [] }],
    edges: [],
    meta: { domain: 'acme.com', companyName: 'Acme', researchedAt: null, tier: 'T0', provider: null },
  };
  const draft = templateOutreachDraft(bare, { ...person, notes: '', sources: [] }, null);
  assert.match(draft.emailBody, /Hi Jane/);
  assert.ok(draft.talkingPoints.length >= 1);
});
