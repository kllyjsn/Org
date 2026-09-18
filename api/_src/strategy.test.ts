import assert from 'node:assert/strict';
import test from 'node:test';
import { deepenAccountStrategy } from './strategy.js';
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
    meta: { domain: 'target.test', companyName: 'Target', tier: 'T0', provider: null, researchedAt: null },
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
