import type { BuyingRole, MapState, Person } from '../types.js';

export const KEY_ROLES: BuyingRole[] = [
  'champion',
  'economic_buyer',
  'decision_maker',
];

const THIRTY_DAYS = 30 * 86_400_000;

export interface CoveragePerson {
  name: string;
  metWith: boolean;
  lastTouchAt: string | null;
}

export interface CommitteeCoverage {
  keyRoles: {
    role: BuyingRole;
    covered: boolean;
    people: CoveragePerson[];
  }[];
  coveredCount: number;
  missingRoles: BuyingRole[];
  untouchedKeyPeople: Person[];
  threadCount: number;
  singleThreaded: boolean;
  score: number;
}

/**
 * Rule-based committee coverage: which key buying roles exist on the map,
 * how thin the met-with threads are, and which key stakeholders have gone
 * untouched for 30+ days. Deterministic so digests and the UI agree.
 */
export function committeeCoverage(
  state: MapState,
  nowMs = Date.now()
): CommitteeCoverage {
  const people = (state.people ?? []).filter(Boolean);
  const keyRoles = KEY_ROLES.map((role) => {
    const inRole = people.filter((p) => p.role === role);
    return {
      role,
      covered: inRole.length > 0,
      people: inRole.map((p) => ({
        name: p.name,
        metWith: p.metWith === true,
        lastTouchAt: p.lastTouchAt ?? null,
      })),
    };
  });
  const coveredCount = keyRoles.filter((r) => r.covered).length;
  const missingRoles = keyRoles.filter((r) => !r.covered).map((r) => r.role);
  const untouchedKeyPeople = people.filter(
    (p) =>
      KEY_ROLES.includes(p.role) &&
      (!p.lastTouchAt ||
        !Number.isFinite(Date.parse(p.lastTouchAt)) ||
        nowMs - Date.parse(p.lastTouchAt) > THIRTY_DAYS)
  );
  const threadCount = people.filter(
    (p) => p.role !== 'none' && p.metWith === true
  ).length;
  const singleThreaded = threadCount <= 1;
  const score = Math.round(
    (50 * coveredCount) / KEY_ROLES.length +
      (30 * Math.min(threadCount, 3)) / 3 +
      20 * (untouchedKeyPeople.length === 0 ? 1 : 0)
  );
  return {
    keyRoles,
    coveredCount,
    missingRoles,
    untouchedKeyPeople,
    threadCount,
    singleThreaded,
    score,
  };
}

export function coverageBand(
  score: number
): 'strong' | 'moderate' | 'weak' {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}
