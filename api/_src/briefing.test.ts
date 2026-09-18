import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountContext } from './account-agent.js';
import {
  buildAccountBriefing,
  deepenAccountBriefing,
} from './briefing.js';
import { compareMapStates } from './changes.js';
import type { MapState, Person, SellerProfile } from './types.js';

const state: MapState = {
  people: [
    {
      id: 'eng-1',
      name: 'Taylor Engineer',
      title: 'VP of Platform Engineering',
      department: 'Engineering',
      team: 'Platform',
      productLine: null,
      teamEvidence: 'sourced',
      role: 'technical_buyer',
      confidence: 'high',
      sources: ['https://target.example/leadership'],
      notes: '',
      email: null,
      linkedin: null,
      x: 0,
      y: 0,
    },
  ],
  edges: [],
  meta: {
    domain: 'target.example',
    companyName: 'Target',
    researchedAt: '2026-09-13T00:00:00.000Z',
    tier: 'T0',
    provider: 'gemini',
    initiatives: [
      {
        name: 'Platform modernization',
        summary: 'Target is modernizing its internal software platform.',
        category: 'technology',
        evidence: ['https://target.example/platform'],
        relevantPeople: ['Taylor Engineer'],
        relevantTeams: ['Platform'],
        salesAngles: ['Explore developer workflow constraints.'],
      },
    ],
  },
};

const sellerProfile: SellerProfile = {
  companyName: 'DevTools',
  domain: 'devtools.example',
  summary: 'Developer productivity software',
  products: ['Developer platform'],
  targetCustomers: ['Engineering teams'],
  useCases: ['Improve developer productivity'],
  proofPoints: ['Faster software delivery'],
  competitors: ['Manual workflows'],
  positioning: 'A secure developer productivity platform',
  researchedAt: '2026-09-13T00:00:00.000Z',
};

test('briefing leaves the value case absent without seller context', async () => {
  const briefing = buildAccountBriefing(state, [], null);
  const deepened = await deepenAccountBriefing(briefing, state, null);
  assert.equal(deepened.valueCase, null);
});

test('briefing fallback separates evidence from seller hypotheses', async () => {
  const keys = [
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'PERPLEXITY_API_KEY',
  ] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const briefing = buildAccountBriefing(state, [], null);
    const deepened = await deepenAccountBriefing(
      briefing,
      state,
      sellerProfile
    );
    assert.equal(deepened.valueCase?.researchDepth, 'map_only');
    assert.equal(deepened.valueCase?.currentState[0]?.provenance, 'sourced');
    assert.equal(deepened.valueCase?.desiredOutcomes[0]?.provenance, 'hypothesis');
    assert.deepEqual(deepened.valueCase?.desiredOutcomes[0]?.evidence, []);
    assert.ok(
      deepened.valueCase?.researchGaps.some((gap) =>
        /business problems/i.test(gap)
      )
    );
    assert.ok(
      deepened.valueCase?.researchGaps.some((gap) =>
        /decision criteria/i.test(gap)
      )
    );
    assert.match(
      deepened.valueCase?.stakeholderMessages[0]?.statement ?? '',
      /before positioning DevTools/
    );
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('analysis survives legacy states with missing person and initiative fields', () => {
  // Map versions saved before fields like role/notes/relevantPeople existed
  // arrive as plain JSON — missing keys are undefined at runtime.
  const legacyPeople = [
    { id: 'old-1', name: 'Old Stakeholder' },
    { id: 'old-2', name: 'Taylor Engineer' },
  ] as unknown as Person[];
  const legacyState = {
    people: legacyPeople,
    edges: [{ id: 'e1', from: 'old-1', to: 'old-2', inferred: true }],
    meta: {
      domain: 'target.example',
      initiatives: [
        { summary: 'Legacy initiative row without list fields.' },
        { name: 'Named', evidence: ['https://x.example/a'] },
      ],
    },
  } as unknown as MapState;

  const changes = compareMapStates(legacyState, state);
  assert.ok(changes.length > 0);
  const briefing = buildAccountBriefing(legacyState, changes, null);
  assert.ok(briefing.actions.length > 0);
  const { context } = buildAccountContext(legacyState);
  assert.equal(context.people.length, 2);
});
