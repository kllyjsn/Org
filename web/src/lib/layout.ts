import type { MapEdge, MapState, Person, ResearchResult } from '../types';

const NODE_W = 280;
const NODE_H = 170;

/**
 * Tidy-tree layout over `reports` edges: depth → y, leaf order → x,
 * parents centered over children. Handles forests, cycles, and people
 * with no reporting links (they become roots / grid fallback).
 */
function layoutPositions(
  people: Person[],
  edges: MapEdge[]
): Map<string, { x: number; y: number }> {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'reports') continue;
    children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
    hasParent.add(e.to);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  let nextX = 0;

  const place = (id: string, depth: number): number => {
    if (visited.has(id)) {
      const dummy = nextX * NODE_W;
      nextX += 1;
      return dummy;
    }
    visited.add(id);
    const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
    let x: number;
    if (kids.length === 0) {
      x = nextX * NODE_W;
      nextX += 1;
    } else {
      const xs = kids.map((k) => place(k, depth + 1));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    pos.set(id, { x, y: depth * NODE_H });
    return x;
  };

  const roots = people.filter((p) => !hasParent.has(p.id));
  for (const root of roots) place(root.id, 0);
  // Cycle leftovers / disconnected nodes become roots in a trailing row.
  for (const p of people) if (!visited.has(p.id)) place(p.id, 0);
  return pos;
}

export function applyLayout(people: Person[], edges: MapEdge[]): Person[] {
  const pos = layoutPositions(people, edges);
  return people.map((p) => ({ ...p, ...(pos.get(p.id) ?? { x: 0, y: 0 }) }));
}

const LANE_COLUMNS = 4;
export const LANE_COL_GAP = 300;
export const LANE_ROW_GAP = 200;
const LANE_GAP = 140;

/** The lane a person belongs to — shared by layout and lane headers. */
export function personLane(person: Person): string {
  return (
    person.department?.trim() ||
    person.productLine?.trim() ||
    person.team?.trim() ||
    'Unassigned'
  );
}

export type LaneGrouping = 'department' | 'team' | 'met';

/** Lane label for a person under a given grouping dimension. */
export function laneKey(
  person: Person,
  grouping: LaneGrouping = 'department'
): string {
  if (grouping === 'team') {
    return (
      person.team?.trim() ||
      person.productLine?.trim() ||
      person.department?.trim() ||
      'No team'
    );
  }
  if (grouping === 'met') {
    const team =
      person.team?.trim() ||
      person.productLine?.trim() ||
      person.department?.trim() ||
      'No team';
    return person.metWith ? `Met with · ${team}` : `Haven’t met · ${team}`;
  }
  return personLane(person);
}

/**
 * Lane-first reading order: one horizontal band per lane, wrapped at a fixed
 * column count so a large account stays a tall page instead of an endless
 * horizontal scroll. Within a band people are ordered by seniority. An
 * optional lane rank orders lane groups first (e.g. Haven't met before Met).
 */
function lanePositions(
  people: Person[],
  columns: number,
  keyOf: (person: Person) => string,
  laneRank?: (name: string) => number,
  colGap = LANE_COL_GAP
): Map<string, { x: number; y: number }> {
  const perRow = Math.max(1, columns);
  const lanes = new Map<string, Person[]>();
  for (const person of people) {
    const name = keyOf(person);
    lanes.set(name, [...(lanes.get(name) ?? []), person]);
  }

  const ordered = [...lanes.entries()].sort((a, b) => {
    if (laneRank) {
      const rankDiff = laneRank(a[0]) - laneRank(b[0]);
      if (rankDiff !== 0) return rankDiff;
    }
    const seniorityA = Math.min(...a[1].map((p) => seniorityRank(p)));
    const seniorityB = Math.min(...b[1].map((p) => seniorityRank(p)));
    if (seniorityA !== seniorityB) return seniorityA - seniorityB;
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const pos = new Map<string, { x: number; y: number }>();
  let laneTop = 0;
  for (const [, members] of ordered) {
    // Seniority first so each lane reads as a leadership stack (and collapsed
    // lanes keep their leaders visible); equal ranks cluster by team so
    // business units still sit together.
    const sorted = [...members].sort((a, b) => {
      const rank = seniorityRank(a) - seniorityRank(b);
      if (rank !== 0) return rank;
      const teamA = (a.team ?? a.productLine ?? '').toLowerCase();
      const teamB = (b.team ?? b.productLine ?? '').toLowerCase();
      if (teamA !== teamB) return teamA.localeCompare(teamB);
      return a.name.localeCompare(b.name);
    });
    sorted.forEach((person, index) => {
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      pos.set(person.id, {
        x: column * colGap,
        y: laneTop + row * LANE_ROW_GAP,
      });
    });
    const rows = Math.ceil(sorted.length / perRow);
    laneTop += rows * LANE_ROW_GAP + LANE_GAP;
  }
  return pos;
}

function departmentLanePositions(
  people: Person[],
  columns = LANE_COLUMNS
): Map<string, { x: number; y: number }> {
  return lanePositions(people, columns, personLane);
}

function applyDepartmentLanes(
  people: Person[],
  columns = LANE_COLUMNS
): Person[] {
  const pos = departmentLanePositions(people, columns);
  return people.map((p) => ({ ...p, ...(pos.get(p.id) ?? { x: p.x, y: p.y }) }));
}

/** Lay people into lanes under any grouping dimension. */
export function applyLanes(
  people: Person[],
  columns = LANE_COLUMNS,
  grouping: LaneGrouping = 'department',
  colGap = LANE_COL_GAP
): Person[] {
  const pos = lanePositions(
    people,
    columns,
    (person) => laneKey(person, grouping),
    grouping === 'met'
      ? (name) => (name.startsWith('Met with') ? 1 : 0)
      : undefined,
    colGap
  );
  return people.map((p) => ({ ...p, ...(pos.get(p.id) ?? { x: p.x, y: p.y }) }));
}

/**
 * Title-seniority ladder used when research finds people but no reporting
 * lines. Lower number = more senior; the CEO/founder anchors the tree and each
 * person attaches to the most senior person above them — same department when
 * possible. Guessed edges are flagged `inferred` so the canvas can mark them.
 */
const TITLE_RANK: [RegExp, number][] = [
  [/chief executive|\bceo\b|founder/i, 0],
  [/\bpresident\b/i, 1],
  [/\bchief\b|\bc[acefmorst]o\b|\bciso\b|general counsel/i, 2],
  [/\b(evp|svp)\b|executive vice president|senior vice president/i, 3],
  [/\bhead\b|\bgm\b|general manager/i, 4],
  [/\bvp\b|vice president/i, 5],
  [/\bdirector\b/i, 6],
];

const DEFAULT_RANK = 7;

function titleRank(title: string): number {
  for (const [re, rank] of TITLE_RANK) if (re.test(title)) return rank;
  return DEFAULT_RANK;
}

/** Structured seniority (Sumble job_level) when present, else title guess. */
function jobLevelRank(jobLevel: string | null | undefined): number | null {
  const value = jobLevel?.trim();
  if (!value) return null;
  if (/cxo|c-level|chief|founder|president|owner/i.test(value)) return 0;
  if (/svp|evp|senior vice|executive vice/i.test(value)) return 3;
  if (/head|gm|general manager/i.test(value)) return 4;
  if (/vp|vice president/i.test(value)) return 5;
  if (/director/i.test(value)) return 6;
  if (/manager|lead/i.test(value)) return 7;
  if (/senior|staff|principal/i.test(value)) return 8;
  return 9;
}

export function seniorityRank(person: Person): number {
  return jobLevelRank(person.jobLevel) ?? titleRank(person.title);
}

/**
 * Draft a plausible reporting hierarchy for people with no known managers.
 * Acyclic by construction: parents are always strictly more senior or the root.
 */
function inferEdges(
  people: Person[],
  parentless: Set<string> | null = null
): MapEdge[] {
  if (people.length < 2) return [];
  const rankOf = new Map(people.map((p) => [p.id, seniorityRank(p)]));
  const root = people.reduce((a, b) =>
    rankOf.get(b.id)! < rankOf.get(a.id)! ? b : a
  );
  const edges: MapEdge[] = [];
  for (const p of people) {
    if (p.id === root.id) continue;
    if (parentless && !parentless.has(p.id)) continue;
    const myRank = rankOf.get(p.id)!;
    const seniors = people.filter(
      (c) => c.id !== p.id && rankOf.get(c.id)! < myRank
    );
    const sameDept = p.department
      ? seniors.filter((c) => c.department === p.department)
      : [];
    const pool = sameDept.length > 0 ? sameDept : seniors;
    const parent = pool.length
      ? pool.reduce((a, b) => (rankOf.get(b.id)! < rankOf.get(a.id)! ? b : a))
      : root;
    edges.push({
      id: crypto.randomUUID(),
      from: parent.id,
      to: p.id,
      kind: 'reports',
      label: null,
      inferred: true,
    });
  }
  return edges;
}

/** Convert a T0 research result into an initial canvas state. */
export function stateFromResearch(result: ResearchResult): MapState {
  const people: Person[] = result.people.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    title: p.title,
    department: p.department,
    team: p.team,
    productLine: p.productLine,
    teamEvidence: p.teamEvidence,
    role: 'none',
    confidence: p.confidence,
    sources: p.sources.length > 0 ? p.sources : p.source ? [p.source] : [],
    sourceDetails: p.sourceDetails,
    freshness: p.freshness,
    corroborationCount: p.corroborationCount,
    lastVerifiedAt: p.lastVerifiedAt,
    conflictingTitles: p.conflictingTitles,
    researchStatus: p.researchStatus,
    notes: '',
    email: null,
    linkedin: p.linkedin ?? null,
    jobLevel: p.jobLevel ?? null,
    x: 0,
    y: 0,
  }));

  const idByName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
  const edges: MapEdge[] = [];
  for (const rp of result.people) {
    const from = rp.reportsToName
      ? idByName.get(rp.reportsToName.toLowerCase())
      : undefined;
    const to = idByName.get(rp.name.toLowerCase());
    if (!from || !to || from === to) continue;
    edges.push({ id: crypto.randomUUID(), from, to, kind: 'reports', label: null });
  }

  // Public-web research often comes back as a flat list — draft a hierarchy
  // for everyone without a real edge rather than leaving them disconnected.
  const parentless = new Set(
    people
      .filter((p) => !edges.some((e) => e.to === p.id))
      .map((p) => p.id)
  );
  if (people.length > 1) edges.push(...inferEdges(people, parentless));

  return {
    people: applyDepartmentLanes(people),
    edges,
    meta: {
      domain: result.domain,
      companyName: result.companyName,
      researchedAt: new Date().toISOString(),
      tier: result.tier,
      provider: result.provider,
      refreshCadence: 'weekly',
      nextRefreshAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      initiatives: result.initiatives,
    },
  };
}
