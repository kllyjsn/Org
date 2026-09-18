import assert from 'node:assert/strict';
import test from 'node:test';
import { deepenAccountStrategy, strategyContext } from './strategy.js';
import type { MapState } from './types.js';

test('strategy fallback returns map_only summary and mutual action plan without seller profile', async () => {
  const state = {
    people: [
      {
        id: 'p1',
        name: 'Alex Buyer',
        title: 'VP Sales',
        department: 'Sales',
        role: 'economic_buyer',
        confidence: 'high',
        sources: [],
        notes: '',
        email: null,
        linkedin: null,
        x: 0,
        y: 0,
      },
    ],
    edges: [],
    meta: {
      domain: 'target.test',
      companyName: 'Target',
      tier: 'T0',
      provider: null,
      researchedAt: null,
    },
  } as unknown as MapState;
  const insights = await deepenAccountStrategy(state, null, {
    entry: state.people[0],
    target: state.people[0],
    pathNames: ['Alex Buyer'],
    risks: [],
    objections: [],
  });
  assert.equal(insights.researchDepth, 'map_only');
  assert.ok(insights.executiveSummary.length > 0);
  assert.ok(insights.mutualActionPlan.length >= 4);
  assert.equal(insights.provider, 'map');
});

test('strategy context honors valid plan overrides', () => {
  const state = {
    people: [
      {
        id: 'entry',
        name: 'Mapped Entry',
        title: 'Champion',
        role: 'champion',
      },
      {
        id: 'target',
        name: 'Mapped Target',
        title: 'CFO',
        role: 'economic_buyer',
      },
      {
        id: 'auto',
        name: 'Automatic Entry',
        title: 'VP Sales',
        role: 'champion',
      },
    ],
    edges: [{ from: 'entry', to: 'target' }],
    meta: {
      domain: 'target.test',
      companyName: 'Target',
      strategy: {
        entryPersonId: 'entry',
        targetPersonId: 'target',
        stakeholders: {},
        tasks: [],
        updatedAt: '',
      },
    },
  } as unknown as MapState;
  const context = strategyContext(state);
  assert.equal(context.entry?.id, 'entry');
  assert.equal(context.target?.id, 'target');
  assert.deepEqual(context.pathNames, ['Mapped Entry', 'Mapped Target']);
});

test('strategy context falls back when plan overrides are missing', () => {
  const state = {
    people: [
      {
        id: 'champion',
        name: 'Automatic Champion',
        title: 'VP Sales',
        role: 'champion',
      },
      {
        id: 'buyer',
        name: 'Automatic Buyer',
        title: 'CFO',
        role: 'economic_buyer',
      },
    ],
    edges: [{ from: 'champion', to: 'buyer' }],
    meta: {
      domain: 'target.test',
      companyName: 'Target',
      strategy: {
        entryPersonId: 'missing-entry',
        targetPersonId: 'missing-target',
        stakeholders: {},
        tasks: [],
        updatedAt: '',
      },
    },
  } as unknown as MapState;
  const context = strategyContext(state);
  assert.equal(context.entry?.id, 'champion');
  assert.equal(context.target?.id, 'buyer');
  assert.deepEqual(context.pathNames, [
    'Automatic Champion',
    'Automatic Buyer',
  ]);
});

test('strategy context mirrors scored selection and weighted paths', () => {
  const state = {
    people: [
      {
        id: 'alex',
        name: 'Alex Morgan',
        title: 'Champion',
        department: null,
        role: 'champion',
        confidence: 'high',
        sources: ['source'],
      },
      {
        id: 'jordan',
        name: 'Jordan Lee',
        title: 'Operations Director',
        department: 'Operations',
        role: 'influencer',
        confidence: 'high',
        sources: ['source'],
        metWith: true,
      },
      {
        id: 'casey',
        name: 'Casey Rivera',
        title: 'Economic Buyer',
        department: null,
        role: 'economic_buyer',
        confidence: 'high',
        sources: ['source'],
      },
      {
        id: 'sam',
        name: 'Sam Chen',
        title: 'Decision Maker',
        department: null,
        role: 'decision_maker',
        confidence: 'high',
        sources: ['source'],
      },
    ],
    edges: [
      {
        id: 'direct-inferred',
        from: 'jordan',
        to: 'casey',
        kind: 'reports',
        inferred: true,
      },
      {
        id: 'via-sam',
        from: 'jordan',
        to: 'sam',
        kind: 'influence',
      },
      {
        id: 'sam-casey',
        from: 'sam',
        to: 'casey',
        kind: 'influence',
      },
    ],
    meta: {
      domain: 'target.test',
      companyName: 'Target',
      strategy: undefined,
    },
  } as unknown as MapState;
  const sellerProfile = {
    companyName: 'Seller',
    domain: 'seller.test',
    summary: 'Operations workflow platform',
    products: ['workflow automation'],
    targetCustomers: ['operations teams'],
    useCases: ['operations workflows'],
    proofPoints: [],
    competitors: [],
    positioning: 'Operations productivity',
    researchedAt: '',
  };
  const context = strategyContext(state, sellerProfile);

  // Jordan wins entry on operations product fit and the met-with bonus, while
  // Casey wins target priority over Sam (100 versus 90).
  assert.equal(context.entry?.id, 'jordan');
  assert.equal(context.target?.id, 'casey');
  assert.deepEqual(context.pathNames, [
    'Jordan Lee',
    'Sam Chen',
    'Casey Rivera',
  ]);
});
