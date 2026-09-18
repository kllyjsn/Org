import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveStage,
  mapPortfolioRow,
  portfolioSummary,
  stageFromText,
  type PortfolioInput,
} from './portfolio.js';
import type { Person } from './types.js';

function person(patch: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP',
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

function map(patch: Partial<PortfolioInput> = {}): PortfolioInput {
  return {
    id: 'm1',
    name: 'Acme',
    domain: 'acme.com',
    company_name: 'Acme',
    is_live_opportunity: true,
    outcome: 'open',
    outcome_at: null,
    outcome_coverage: null,
    stage: null,
    state: {
      people: [],
      edges: [],
      meta: {
        domain: 'acme.com',
        companyName: 'Acme',
        researchedAt: null,
        tier: 'T0',
        provider: null,
      },
    },
    updated_at: new Date().toISOString(),
    created_by: 'u1',
    ...patch,
  };
}

test('stageFromText keyword table', () => {
  assert.equal(stageFromText('Closed Won'), 'closed');
  assert.equal(stageFromText('Contract negotiation'), 'negotiation');
  assert.equal(stageFromText('Proposal sent'), 'proposal');
  assert.equal(stageFromText('POC'), 'evaluation');
  assert.equal(stageFromText('Discovery call'), 'discovery');
  assert.equal(stageFromText('weird'), null);
  assert.equal(stageFromText(null), null);
});

test('effectiveStage prefers manual override, then CRM stage', () => {
  const m = map({
    stage: 'proposal',
    state: {
      people: [],
      edges: [],
      meta: {
        domain: '',
        companyName: null,
        researchedAt: null,
        tier: 'T0',
        provider: null,
        crm: {
          provider: 'hubspot',
          accountId: 'a',
          accountName: 'A',
          opportunityId: null,
          opportunityName: null,
          stage: 'Discovery',
          amount: null,
          closeDate: null,
          linkedAt: '',
          lastPulledAt: null,
          lastPushedAt: null,
        },
      },
    },
  });
  assert.equal(effectiveStage(m), 'proposal');
  m.stage = null;
  assert.equal(effectiveStage(m), 'discovery');
});

test('mapPortfolioRow gap math and risk flags', () => {
  // discovery expects 2 known people; champion met → 1 known → gap 1.
  const m = map({
    state: {
      people: [person({ role: 'champion', metWith: true, lastTouchAt: new Date().toISOString() })],
      edges: [],
      meta: { domain: '', companyName: null, researchedAt: null, tier: 'T0', provider: null },
    },
  });
  const row = mapPortfolioRow(m);
  assert.equal(row.knownPeople, 1);
  assert.equal(row.expectedKnown, 2);
  assert.equal(row.gap, 1);
  assert.ok(row.riskFlags.includes('coverage_gap'));
  assert.ok(row.riskFlags.includes('single_threaded'));
  assert.ok(row.riskFlags.includes('no_economic_buyer'));
});

test('stale_30d flag needs open + old activity', () => {
  const stale = map({
    updated_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    state: { people: [], edges: [], meta: { domain: '', companyName: null, researchedAt: null, tier: 'T0', provider: null } },
  });
  assert.ok(mapPortfolioRow(stale).riskFlags.includes('stale_30d'));
  const won = { ...stale, outcome: 'won' as const };
  assert.ok(!mapPortfolioRow(won).riskFlags.includes('stale_30d'));
});

test('portfolioSummary winLoss uses snapshot coverage, not current', () => {
  const closed = map({
    outcome: 'won',
    outcome_at: new Date().toISOString(),
    outcome_coverage: { score: 80 }, // strong at close
    // today the committee is gone → current score would be weak
    state: { people: [], edges: [], meta: { domain: '', companyName: null, researchedAt: null, tier: 'T0', provider: null } },
  });
  const rows = [mapPortfolioRow(closed)];
  const summary = portfolioSummary(rows);
  assert.equal(summary.winLoss.byBand.strong.won, 1);
  assert.equal(summary.winLoss.byBand.strong.winRate, 1);
  assert.equal(summary.winLoss.byBand.weak.won, 0);
});
