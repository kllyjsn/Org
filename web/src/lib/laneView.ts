import {
  LANE_COL_GAP,
  LANE_ROW_GAP,
  laneSpan,
  personLane,
  seniorityRank,
} from './layout';
import type { Person } from '../types';

export interface LaneViewItem {
  id: string;
  x: number;
  y: number;
  person: Person;
  /** Mid-drag items report live positions; excluding them keeps lane bounds settled. */
  dragging?: boolean;
}

export interface LaneViewHeader {
  lane: string;
  x: number;
  y: number;
  /** Columns the lane occupies — headers only overlap within this span. */
  span: number;
  count: number;
  shown: number;
  expanded: boolean;
}

export interface LaneViewTile {
  lane: string;
  x: number;
  y: number;
  count: number;
}

export interface LaneViewResult {
  /** Member ids that should render (all of them when nothing collapses). */
  visibleIds: Set<string>;
  /** Display positions — packed for collapsed lanes, shifted for reflow. */
  posOverride: Map<string, { x: number; y: number }>;
  headers: LaneViewHeader[];
  tiles: LaneViewTile[];
  shownCount: number;
  hiddenCount: number;
  laneOrder: string[];
}

interface LaneSortCacheEntry {
  key: string;
  members: LaneViewItem[];
  order: string[];
}

const laneSortCache = new Map<string, LaneSortCacheEntry>();
const LANE_CACHE_LIMIT = 64;

export function clearLaneViewCache(): void {
  laneSortCache.clear();
}

export function laneTopK(members: Person[], columns: number): number {
  const cap = Math.max(1, columns) * 2;
  const leaders = members.reduce(
    (count, person) => count + (seniorityRank(person) <= 6 ? 1 : 0),
    0
  );
  return Math.max(cap, leaders);
}

function sortedLaneMembers(lane: string, members: LaneViewItem[]): LaneViewItem[] {
  const key = members.map((member) => member.id).join('|');
  const cached = laneSortCache.get(lane);
  if (cached?.key === key) {
    const cachedById = new Map(cached.members.map((member) => [member.id, member]));
    if (members.every((member) => cachedById.get(member.id)?.person === member.person)) {
      const currentById = new Map(members.map((member) => [member.id, member]));
      return cached.order.map((id) => currentById.get(id)!);
    }
  }
  const sorted = [...members].sort(
    (a, b) =>
      seniorityRank(a.person) - seniorityRank(b.person) ||
      a.person.name.localeCompare(b.person.name)
  );
  laneSortCache.delete(lane);
  laneSortCache.set(lane, {
    key,
    members: sorted,
    order: sorted.map((member) => member.id),
  });
  while (laneSortCache.size > LANE_CACHE_LIMIT) {
    laneSortCache.delete(laneSortCache.keys().next().value!);
  }
  return sorted;
}

/**
 * Progressive disclosure for department lanes: each lane keeps its most
 * senior members plus a "+N more" tile, and lanes below reflow upward so the
 * map stays dense. Pure display math — callers layer it over their own
 * node/person state; nothing here mutates or persists positions.
 */
export function computeLaneView(
  items: LaneViewItem[],
  options: {
    columns: number;
    expandedLanes: Set<string>;
    collapsedLanes: Set<string>;
    showAll: boolean;
    /** Lane key extractor — must match the grouping the layout used. */
    laneOf?: (person: Person) => string;
    colGap?: number;
  }
): LaneViewResult {
  const columns = Math.max(1, options.columns);
  const laneOf = options.laneOf ?? personLane;
  const colGap = options.colGap ?? LANE_COL_GAP;
  const lanes = new Map<string, LaneViewItem[]>();
  for (const item of items) {
    const name = laneOf(item.person);
    const members = lanes.get(name);
    if (members) members.push(item);
    else lanes.set(name, [item]);
  }
  const ordered = [...lanes.entries()]
    .map(([name, members]) => {
      const settled = members.filter((m) => !m.dragging);
      const basis = settled.length > 0 ? settled : members;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const m of basis) {
        minX = Math.min(minX, m.x);
        minY = Math.min(minY, m.y);
        maxY = Math.max(maxY, m.y);
      }
      return { name, members, minX, minY, maxY };
    })
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  const posOverride = new Map<string, { x: number; y: number }>();
  const visibleIds = new Set<string>();
  const headers: LaneViewHeader[] = [];
  const tiles: LaneViewTile[] = [];
  const laneOrder = ordered.map((lane) => lane.name);
  let offset = 0;
  let shown = 0;
  // Headers must never overlap: lanes whose members interleave in position
  // (dragged cards, met-status flips under the met grouping) can report the
  // same minX/minY, stacking two headers into unreadable double text. Only
  // lanes whose column spans overlap horizontally can actually clash.
  for (const lane of ordered) {
    const expanded = options.showAll
      ? !options.collapsedLanes.has(lane.name)
      : options.expandedLanes.has(lane.name);
    const members = sortedLaneMembers(lane.name, lane.members);
    const topK = laneTopK(members.map((item) => item.person), columns);
    const collapsible = !expanded && members.length > topK + 2;
    const shownCount = collapsible ? topK : members.length;
    const top = lane.minY - offset;
    if (collapsible) {
      members.forEach((item, index) => {
        if (index < shownCount) {
          posOverride.set(item.id, {
            x: lane.minX + (index % columns) * colGap,
            y: top + Math.floor(index / columns) * LANE_ROW_GAP,
          });
          visibleIds.add(item.id);
        }
      });
      tiles.push({
        lane: lane.name,
        x: lane.minX + (shownCount % columns) * colGap,
        y: top + Math.floor(shownCount / columns) * LANE_ROW_GAP,
        count: members.length - shownCount,
      });
    } else {
      for (const item of lane.members) {
        if (offset !== 0) {
          posOverride.set(item.id, {
            x: item.x,
            y: item.y - offset,
          });
        }
        visibleIds.add(item.id);
      }
    }
    const span = laneSpan(members.length, columns);
    const spanWidth = span * colGap;
    let headerY = top - 56;
    for (;;) {
      const clashing = headers.find(
        (h) =>
          Math.abs(h.y - headerY) < 32 &&
          h.x < lane.minX + spanWidth &&
          lane.minX < h.x + h.span * colGap
      );
      if (!clashing) break;
      headerY = clashing.y + 32;
    }
    headers.push({
      lane: lane.name,
      x: lane.minX,
      y: headerY,
      span,
      count: members.length,
      shown: shownCount,
      expanded,
    });
    shown += shownCount;
    // offset only grows after this lane, so lanes sharing a band (same
    // minY) all shift by the same amount.
    const originalHeight = Math.max(0, lane.maxY - lane.minY);
    const packedRows = collapsible ? Math.ceil((shownCount + 1) / columns) : 0;
    const newHeight = collapsible
      ? (packedRows - 1) * LANE_ROW_GAP
      : originalHeight;
    offset += originalHeight - newHeight;
  }
  return {
    visibleIds,
    posOverride,
    headers,
    tiles,
    shownCount: shown,
    hiddenCount: items.length - shown,
    laneOrder,
  };
}
