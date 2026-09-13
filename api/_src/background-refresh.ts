import { randomUUID } from 'node:crypto';
import { query, now } from './db.js';
import {
  canonicalPersonName,
  researchOrg,
  type ResearchResult,
} from './research.js';
import type { MapRow, MapState, Person } from './types.js';

function nextRefreshAt(cadence: MapState['meta']['refreshCadence']): string {
  const days = cadence === 'monthly' ? 30 : 7;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function mergedSources(existing: Person, researched: ResearchResult['people'][number]) {
  const sourceDetails = Array.from(
    new Map(
      [...(existing.sourceDetails ?? []), ...researched.sourceDetails].map(
        (source) => [source.url, source]
      )
    ).values()
  );
  return {
    sources: Array.from(
      new Set([
        ...existing.sources,
        ...researched.sources,
        ...(researched.source ? [researched.source] : []),
      ])
    ),
    sourceDetails,
  };
}

export function mergeBackgroundResearch(
  state: MapState,
  result: ResearchResult
): MapState {
  const people = state.people.map((person) => ({ ...person }));
  const byName = new Map(
    people.map((person, index) => [canonicalPersonName(person.name), index])
  );
  const maxY = people.length > 0 ? Math.max(...people.map((person) => person.y)) : 0;
  const minX = people.length > 0 ? Math.min(...people.map((person) => person.x)) : 0;
  let added = 0;

  for (const researched of result.people) {
    const index = byName.get(canonicalPersonName(researched.name));
    if (index !== undefined) {
      const existing = people[index];
      const evidence = mergedSources(existing, researched);
      const titleChanged =
        existing.title.trim().toLowerCase() !== researched.title.trim().toLowerCase();
      people[index] = {
        ...existing,
        // Background research may only replace a user's title when direct
        // source inspection verified the new claim.
        title:
          titleChanged && researched.researchStatus === 'verified'
            ? researched.title
            : existing.title,
        department: existing.department ?? researched.department,
        team: existing.team ?? researched.team,
        productLine: existing.productLine ?? researched.productLine,
        teamEvidence: existing.teamEvidence ?? researched.teamEvidence,
        confidence: researched.confidence,
        ...evidence,
        freshness: researched.freshness,
        corroborationCount: researched.corroborationCount,
        lastVerifiedAt: researched.lastVerifiedAt,
        conflictingTitles:
          titleChanged && researched.researchStatus !== 'verified'
            ? Array.from(
                new Set([
                  ...(existing.conflictingTitles ?? []),
                  ...researched.conflictingTitles,
                  researched.title,
                ])
              )
            : Array.from(
                new Set([
                  ...(existing.conflictingTitles ?? []),
                  ...researched.conflictingTitles,
                ])
              ),
        researchStatus:
          titleChanged && researched.researchStatus !== 'verified'
            ? 'conflicting'
            : researched.researchStatus,
      };
      continue;
    }

    const person: Person = {
      id: randomUUID(),
      name: researched.name,
      title: researched.title,
      department: researched.department,
      team: researched.team,
      productLine: researched.productLine,
      teamEvidence: researched.teamEvidence,
      role: 'none',
      confidence: researched.confidence,
      sources: researched.sources,
      sourceDetails: researched.sourceDetails,
      freshness: researched.freshness,
      corroborationCount: researched.corroborationCount,
      lastVerifiedAt: researched.lastVerifiedAt,
      conflictingTitles: researched.conflictingTitles,
      researchStatus: researched.researchStatus,
      notes: '',
      email: null,
      linkedin: null,
      x: minX + (added % 3) * 280,
      y: maxY + 240 + Math.floor(added / 3) * 180,
    };
    byName.set(canonicalPersonName(person.name), people.length);
    people.push(person);
    added += 1;
  }

  return {
    people,
    edges: state.edges,
    meta: {
      ...state.meta,
      companyName: result.companyName ?? state.meta.companyName,
      researchedAt: now(),
      provider: result.provider,
      nextRefreshAt: nextRefreshAt(state.meta.refreshCadence),
      initiatives:
        result.initiatives.length > 0
          ? result.initiatives
          : (state.meta.initiatives ?? []),
    },
  };
}

export async function refreshNextDueMap(): Promise<{
  refreshed: boolean;
  mapId?: string;
  domain?: string;
}> {
  const due = await query<MapRow>(
    `SELECT * FROM maps
     WHERE COALESCE(state->'meta'->>'refreshCadence', 'weekly') <> 'manual'
       AND (
         state->'meta'->>'nextRefreshAt' IS NULL
         OR state->'meta'->>'nextRefreshAt' <= $1
       )
     ORDER BY is_live_opportunity DESC,
              COALESCE(state->'meta'->>'nextRefreshAt', created_at) ASC
     LIMIT 1`,
    [now()]
  );
  const map = due[0];
  if (!map) return { refreshed: false };

  const result = await researchOrg(map.domain);
  const state = mergeBackgroundResearch(map.state as MapState, result);
  const timestamp = now();
  await query(
    `INSERT INTO map_versions
      (id, map_id, name, state, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      map.id,
      map.name,
      JSON.stringify(map.state),
      map.created_by,
      timestamp,
    ]
  );
  await query(
    `UPDATE maps SET state = $1, company_name = $2, updated_at = $3
     WHERE id = $4`,
    [JSON.stringify(state), state.meta.companyName, timestamp, map.id]
  );
  return { refreshed: true, mapId: map.id, domain: map.domain };
}
