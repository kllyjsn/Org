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
