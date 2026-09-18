import type { BuyingRole, Person } from '../types';

// Client mirror of api/_src/notifications/coverage.ts — keep formulas identical.

export const KEY_ROLES: BuyingRole[] = [
  'champion',
  'economic_buyer',
  'decision_maker',
];

const THIRTY_DAYS = 30 * 86_400_000;

export interface CommitteeCoverage {
  coveredCount: number;
  missingRoles: BuyingRole[];
  untouchedKeyPeople: Person[];
  threadCount: number;
  singleThreaded: boolean;
  score: number;
}

export function committeeCoverage(
  people: Person[],
  nowMs = Date.now()
): CommitteeCoverage {
  people = (people ?? []).filter(Boolean);
  const coveredCount = KEY_ROLES.filter((role) =>
    people.some((p) => p.role === role)
  ).length;
  const missingRoles = KEY_ROLES.filter(
    (role) => !people.some((p) => p.role === role)
  );
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
    coveredCount,
    missingRoles,
    untouchedKeyPeople,
    threadCount,
    singleThreaded,
    score,
  };
}

export function coverageBand(score: number): 'strong' | 'moderate' | 'weak' {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}
