import type { MapEdge, MapState, Person, ResearchResult } from '../types';

const NODE_W = 280;
const NODE_H = 170;

/**
 * Tidy-tree layout over `reports` edges: depth → y, leaf order → x,
 * parents centered over children. Handles forests, cycles, and people
 * with no reporting links (they become roots / grid fallback).
 */
export function layoutPositions(
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
const LANE_COL_GAP = 300;
const LANE_ROW_GAP = 200;
const LANE_GAP = 140;

function laneName(person: Person): string {
  return (
    person.department?.trim() ||
    person.productLine?.trim() ||
    person.team?.trim() ||
    'Unassigned'
  );
}

/**
 * Department-first reading order: one horizontal band per department, wrapped
 * at a fixed column count so a large account stays a tall page instead of an
 * endless horizontal scroll. Within a band people are ordered by seniority.
 */
export function departmentLanePositions(
  people: Person[],
  columns = LANE_COLUMNS
): Map<string, { x: number; y: number }> {
  const perRow = Math.max(1, columns);
  const lanes = new Map<string, Person[]>();
  for (const person of people) {
    const name = laneName(person);
    lanes.set(name, [...(lanes.get(name) ?? []), person]);
  }

  const ordered = [...lanes.entries()].sort((a, b) => {
    const seniorityA = Math.min(...a[1].map((p) => titleRank(p.title)));
    const seniorityB = Math.min(...b[1].map((p) => titleRank(p.title)));
    if (seniorityA !== seniorityB) return seniorityA - seniorityB;
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const pos = new Map<string, { x: number; y: number }>();
  let laneTop = 0;
  for (const [, members] of ordered) {
    const sorted = [...members].sort((a, b) => {
      const rank = titleRank(a.title) - titleRank(b.title);
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });
    sorted.forEach((person, index) => {
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      pos.set(person.id, {
        x: column * LANE_COL_GAP,
        y: laneTop + row * LANE_ROW_GAP,
      });
    });
    const rows = Math.ceil(sorted.length / perRow);
    laneTop += rows * LANE_ROW_GAP + LANE_GAP;
  }
  return pos;
}

export function applyDepartmentLanes(
  people: Person[],
  columns = LANE_COLUMNS
): Person[] {
  const pos = departmentLanePositions(people, columns);
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

/**
 * Draft a plausible reporting hierarchy for people with no known managers.
 * Acyclic by construction: parents are always strictly more senior or the root.
 */
export function inferEdges(people: Person[]): MapEdge[] {
  if (people.length < 2) return [];
  const rankOf = new Map(people.map((p) => [p.id, titleRank(p.title)]));
  const root = people.reduce((a, b) =>
    rankOf.get(b.id)! < rankOf.get(a.id)! ? b : a
  );
  const edges: MapEdge[] = [];
  for (const p of people) {
    if (p.id === root.id) continue;
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
    linkedin: null,
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
  // from titles rather than landing the user on an unconnected row of cards.
  if (edges.length === 0 && people.length > 1) edges.push(...inferEdges(people));

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
