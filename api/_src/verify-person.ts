import type { ResearchedPerson } from './research.js';
import type { Person } from './types.js';

/**
 * Shape a stored map Person into the ResearchedPerson the verification
 * pipeline (deadSourceUrls / verifyTitleClaims) operates on.
 */
export function toResearchedPerson(person: Person): ResearchedPerson {
  const sources = person.sources ?? [];
  return {
    name: person.name ?? '',
    title: person.title ?? '',
    department: person.department ?? null,
    team: person.team ?? null,
    productLine: person.productLine ?? null,
    teamEvidence: person.teamEvidence ?? null,
    reportsToName: null,
    confidence: person.confidence ?? 'low',
    source: sources[0] ?? null,
    sources: [...sources],
    sourceDetails: [...(person.sourceDetails ?? [])],
    freshness: person.freshness ?? 'unknown',
    corroborationCount: person.corroborationCount ?? 0,
    lastVerifiedAt: person.lastVerifiedAt ?? null,
    conflictingTitles: [...(person.conflictingTitles ?? [])],
    researchStatus: person.researchStatus ?? 'possibly_stale',
    linkedin: person.linkedin ?? null,
    jobLevel: null,
  };
}

/**
 * Copy a verification pass back onto the stored person. `deadUrls` are
 * sources the probe proved dead — they are dropped regardless of what the
 * verified result still lists. Confidence only ever upgrades (verified →
 * high); a worse outcome never downgrades it automatically.
 */
export function applyVerification(
  person: Person,
  verified: ResearchedPerson,
  deadUrls?: Iterable<string>
): Person {
  const dead = new Set(deadUrls ?? []);
  const sourceDetails = (verified.sourceDetails ?? []).filter(
    (source) => !dead.has(source.url)
  );
  const sources = Array.from(
    new Set(
      (verified.sources ?? []).filter((url) => !dead.has(url))
    )
  );
  return {
    ...person,
    sources,
    sourceDetails,
    researchStatus: verified.researchStatus,
    conflictingTitles: verified.conflictingTitles,
    freshness: verified.freshness,
    corroborationCount: verified.corroborationCount,
    lastVerifiedAt: verified.lastVerifiedAt ?? new Date().toISOString(),
    confidence:
      verified.researchStatus === 'verified' ? 'high' : person.confidence,
  };
}
