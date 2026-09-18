import { committeeCoverage, type CommitteeCoverage } from './notifications/coverage.js';
import type { MapState } from './types.js';

export type DealStage =
  | 'discovery'
  | 'evaluation'
  | 'proposal'
  | 'negotiation'
  | 'closed';

export function stageFromText(text: string | null): DealStage | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/closed|won|lost/.test(t)) return 'closed';
  if (/negot|contract|legal|procure/.test(t)) return 'negotiation';
  if (/propos|quote|pricing|commit/.test(t)) return 'proposal';
  if (/eval|demo|poc|pilot|trial|solution/.test(t)) return 'evaluation';
  if (/discover|qualif|prospect|new/.test(t)) return 'discovery';
  return null;
}

export const EXPECTED_KNOWN: Record<DealStage, number> = {
  discovery: 2,
  evaluation: 4,
  proposal: 6,
  negotiation: 6,
  closed: 0,
};

export type RiskFlag =
  | 'single_threaded'
  | 'coverage_gap'
  | 'no_economic_buyer'
  | 'stale_30d';

const THIRTY_DAYS = 30 * 86_400_000;

export interface PortfolioInput {
  id: string;
  name: string;
  domain: string;
  company_name: string | null;
  is_live_opportunity: boolean;
  outcome: 'open' | 'won' | 'lost';
  outcome_at: string | null;
  outcome_coverage: unknown;
  stage: string | null;
  state: MapState;
  updated_at: string;
  created_by: string;
}

export function effectiveStage(map: {
  stage?: string | null;
  state?: MapState;
}): DealStage {
  const manual = map.stage as DealStage | null | undefined;
  if (
    manual === 'discovery' ||
    manual === 'evaluation' ||
    manual === 'proposal' ||
    manual === 'negotiation' ||
    manual === 'closed'
  ) {
    return manual;
  }
  return stageFromText(map.state?.meta?.crm?.stage ?? null) ?? 'discovery';
}

export interface PortfolioRow {
  id: string;
  name: string;
  domain: string;
  companyName: string | null;
  isLiveOpportunity: boolean;
  outcome: 'open' | 'won' | 'lost';
  outcomeAt: string | null;
  stage: DealStage;
  coverage: CommitteeCoverage;
  knownPeople: number;
  expectedKnown: number;
  gap: number;
  singleThreaded: boolean;
  untouchedKeyCount: number;
  amount: number | null;
  closeDate: string | null;
  crmStage: string | null;
  lastActivityAt: string | null;
  riskFlags: RiskFlag[];
  /** Coverage score when the outcome was set (null for open maps w/o snapshot). */
  outcomeCoverageScore: number | null;
}

export function mapPortfolioRow(map: PortfolioInput, nowMs = Date.now()): PortfolioRow {
  const state = map.state ?? { people: [], edges: [], meta: {} as MapState['meta'] };
  const coverage = committeeCoverage(state, nowMs);
  const people = state.people ?? [];
  const knownPeople = people.filter(
    (p) => (p.role ?? 'none') !== 'none' || p.metWith === true
  ).length;
  const stage = effectiveStage(map);
  const expectedKnown = EXPECTED_KNOWN[stage];
  const touches = people
    .map((p) => Date.parse(p.lastTouchAt ?? ''))
    .filter(Number.isFinite);
  const candidates = [Date.parse(map.updated_at), ...touches].filter(
    Number.isFinite
  );
  const lastActivityAt = candidates.length
    ? new Date(Math.max(...candidates)).toISOString()
    : null;
  const riskFlags: RiskFlag[] = [];
  if (coverage.singleThreaded) riskFlags.push('single_threaded');
  if (expectedKnown - knownPeople > 0) riskFlags.push('coverage_gap');
  if (!coverage.keyRoles.find((r) => r.role === 'economic_buyer')?.covered) {
    riskFlags.push('no_economic_buyer');
  }
  if (
    map.outcome === 'open' &&
    lastActivityAt !== null &&
    nowMs - Date.parse(lastActivityAt) > THIRTY_DAYS
  ) {
    riskFlags.push('stale_30d');
  }
  const crm = state.meta?.crm;
  return {
    id: map.id,
    name: map.name,
    domain: map.domain,
    companyName: map.company_name,
    isLiveOpportunity: map.is_live_opportunity === true,
    outcome: map.outcome ?? 'open',
    outcomeAt: map.outcome_at ?? null,
    stage,
    coverage,
    knownPeople,
    expectedKnown,
    gap: Math.max(0, expectedKnown - knownPeople),
    singleThreaded: coverage.singleThreaded,
    untouchedKeyCount: coverage.untouchedKeyPeople.length,
    amount: crm?.amount ?? null,
    closeDate: crm?.closeDate ?? null,
    crmStage: crm?.stage ?? null,
    lastActivityAt,
    riskFlags,
    outcomeCoverageScore:
      typeof (map.outcome_coverage as { score?: number } | null)?.score ===
      'number'
        ? (map.outcome_coverage as { score: number }).score
        : null,
  };
}

export type CoverageBand = 'strong' | 'moderate' | 'weak';

export function coverageBand(score: number): CoverageBand {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}

export interface PortfolioSummary {
  total: number;
  live: number;
  byBand: Record<CoverageBand, number>;
  singleThreaded: number;
  withGaps: number;
  atRiskLive: number;
  winLoss: {
    byBand: Record<CoverageBand, { won: number; lost: number; winRate: number | null }>;
  };
}

export function portfolioSummary(rows: PortfolioRow[]): PortfolioSummary {
  const byBand: Record<CoverageBand, number> = { strong: 0, moderate: 0, weak: 0 };
  const winBand: Record<CoverageBand, { won: number; lost: number; winRate: number | null }> = {
    strong: { won: 0, lost: 0, winRate: null },
    moderate: { won: 0, lost: 0, winRate: null },
    weak: { won: 0, lost: 0, winRate: null },
  };
  let live = 0;
  let singleThreaded = 0;
  let withGaps = 0;
  let atRiskLive = 0;
  for (const row of rows) {
    if (row.isLiveOpportunity) live += 1;
    byBand[coverageBand(row.coverage.score)] += 1;
    if (row.singleThreaded) singleThreaded += 1;
    if (row.gap > 0) withGaps += 1;
    if (row.isLiveOpportunity && row.riskFlags.length > 0) atRiskLive += 1;
    if (row.outcome === 'won' || row.outcome === 'lost') {
      // Win/loss bands on coverage-at-close, falling back to today's score.
      const score = row.outcomeCoverageScore ?? row.coverage.score;
      winBand[coverageBand(score)][row.outcome === 'won' ? 'won' : 'lost'] += 1;
    }
  }
  for (const band of Object.keys(winBand) as CoverageBand[]) {
    const { won, lost } = winBand[band];
    winBand[band].winRate = won + lost > 0 ? won / (won + lost) : null;
  }
  return {
    total: rows.length,
    live,
    byBand,
    singleThreaded,
    withGaps,
    atRiskLive,
    winLoss: { byBand: winBand },
  };
}
