import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  getNodesBounds,
  getViewportForBounds,
} from 'reactflow';
import type { Node, ReactFlowInstance } from 'reactflow';
import { reportsEdge } from '../../lib/flowEdges';
import type { FlowEdge } from '../../lib/flowEdges';
import {
  applyLanes,
  laneKey,
  LANE_COL_GAP,
  NODE_H,
} from '../../lib/layout';
import type { LaneGrouping } from '../../lib/layout';
import { computeLaneView } from '../../lib/laneView';
import { FN_LABELS } from '../../lib/taxonomy';
import type { PersonNodeData } from '../../components/PersonNode';
import type { LaneHeaderData } from '../../components/LaneHeaderNode';
import type { MoreNodeData } from '../../components/MoreNode';
import type {
  ChartSuggestion,
  Person,
  SuggestedPerson,
} from '../../types';
import {
  GHOST_NODE_H,
  MOBILE_COL_GAP,
} from './helpers';

type LaneNodes = (
  | Node<PersonNodeData>
  | Node<LaneHeaderData>
  | Node<MoreNodeData>
)[];

export interface LanesApi {
  expandedLanes: Set<string>;
  setExpandedLanes: Dispatch<SetStateAction<Set<string>>>;
  collapsedLanes: Set<string>;
  setCollapsedLanes: Dispatch<SetStateAction<Set<string>>>;
  showAllLanes: boolean;
  setShowAllLanes: Dispatch<SetStateAction<boolean>>;
  laneOf: (person: Person) => string;
  ghostPeople: SuggestedPerson[];
  ghostNodes: Node<PersonNodeData>[];
  laneItems: {
    id: string;
    x: number;
    y: number;
    person: Person;
    dragging?: boolean;
  }[];
  laneView: {
    nodes: LaneNodes;
    shownCount: number;
    hiddenCount: number;
    laneOrder: string[];
  };
  displayNodes: LaneNodes;
  displayEdges: FlowEdge[];
  pendingFocus: MutableRefObject<{
    ids: Set<string>;
    single: boolean;
  } | null>;
  toggleLane: (lane: string) => void;
  relayLanes: (ns: Node<PersonNodeData>[]) => Node<PersonNodeData>[];
  lanesChanged: (
    before: Node<PersonNodeData>[],
    after: Node<PersonNodeData>[]
  ) => boolean;
}

export function useLanes(deps: {
  mapId: string | undefined;
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
  people: Person[];
  isMobile: boolean;
  rf: ReactFlowInstance;
  laneGrouping: LaneGrouping;
  suggestionMapId: string | null;
  suggestion: ChartSuggestion | null;
  confirmedSuggestions: Set<string>;
  declinedSuggestions: Set<string>;
  confirmSuggestion: (rosterId: string) => void;
  declineSuggestion: (rosterId: string) => void;
}): LanesApi {
  const {
    mapId,
    nodes,
    edges,
    people,
    isMobile,
    rf,
    laneGrouping,
    suggestionMapId,
    suggestion,
    confirmedSuggestions,
    declinedSuggestions,
    confirmSuggestion,
    declineSuggestion,
  } = deps;

  // Progressive disclosure for large accounts: each lane shows its most
  // senior people plus a "+N more" tile; expanding reveals the full bench.
  // All of it is derived at render time — expansion state, packed positions,
  // headers, and tiles never enter MapState, undo history, or saved maps.
  const [expandedLanes, setExpandedLanes] = useState<Set<string>>(new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [showAllLanes, setShowAllLanes] = useState(false);
  const laneOf = useCallback(
    (person: Person) =>
      person.id.startsWith('ghost:')
        ? person.department ?? 'Suggested'
        : laneKey(person, laneGrouping),
    [laneGrouping]
  );

  const ghostPeople = useMemo(
    () =>
      mapId && suggestionMapId === mapId && suggestion
        ? suggestion.people.filter(
            (person) => !declinedSuggestions.has(person.rosterId)
          )
        : [],
    [declinedSuggestions, mapId, suggestion, suggestionMapId]
  );
  const ghostLaneLabelByGroupId = useMemo(() => {
    const labels = new Map<string, string>();
    for (const group of suggestion?.groups ?? []) {
      labels.set(group.id, group.name);
    }
    return labels;
  }, [suggestion]);
  const realMaxY = useMemo(
    () =>
      nodes.length
        ? Math.round(Math.max(...nodes.map((node) => node.position.y)) / 100) * 100
        : 0,
    [nodes]
  );
  const ghostNodeCache = useRef(
    new Map<string, Node<PersonNodeData>>()
  );
  const ghostSuggestionRef = useRef<ChartSuggestion | null>(null);
  const ghostNodes = useMemo(() => {
    if (ghostSuggestionRef.current !== suggestion) {
      ghostNodeCache.current.clear();
      ghostSuggestionRef.current = suggestion;
    }
    if (ghostPeople.length === 0 || !suggestion) return [];
    const ghostPersons: Person[] = ghostPeople.map((person) => ({
      id: `ghost:${person.rosterId}`,
      name: person.name,
      title: person.title,
      department: `Suggested · ${
        ghostLaneLabelByGroupId.get(person.groupId) ?? FN_LABELS[person.function]
      }`,
      team: null,
      role: 'none',
      confidence: person.confidence,
      sources: person.evidence.sourceUrl ? [person.evidence.sourceUrl] : [],
      notes: '',
      email: null,
      linkedin: null,
      jobLevel:
        person.seniority === 'c_level'
          ? 'cxo'
          : person.seniority === 'evp_svp'
            ? 'evp'
            : person.seniority,
      groupId: person.groupId,
      x: 0,
      y: 0,
    }));
    const laid = applyLanes(
      ghostPersons,
      isMobile ? 2 : 4,
      'department',
      isMobile ? MOBILE_COL_GAP : LANE_COL_GAP
    );
    const byId = new Map(
      ghostPeople.map((person) => [`ghost:${person.rosterId}`, person])
    );
    const shiftY =
      realMaxY + 200;
    return laid.flatMap((person) => {
      const source = byId.get(person.id);
      if (!source) return [];
      const x = person.x;
      const y = person.y + shiftY;
      const confirmed = confirmedSuggestions.has(source.rosterId);
      const key = `${source.rosterId}:${x}:${y}:${confirmed}`;
      const cached = ghostNodeCache.current.get(key);
      if (cached) return [cached];
      const node: Node<PersonNodeData> = {
        id: person.id,
        type: 'person',
        position: { x, y },
        data: {
          person: { ...person, x, y },
          readOnly: true,
          suggested: {
            confidence: source.confidence,
            evidence: source.evidence,
            confirmed,
            onConfirm: () => confirmSuggestion(source.rosterId),
            onDecline: () => declineSuggestion(source.rosterId),
          },
        },
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        style: { width: 250, height: GHOST_NODE_H },
        width: 250,
        height: GHOST_NODE_H,
      };
      ghostNodeCache.current.set(key, node);
      return [node];
    });
  }, [
    confirmSuggestion,
    declineSuggestion,
    ghostPeople,
    ghostLaneLabelByGroupId,
    isMobile,
    realMaxY,
    suggestion,
    confirmedSuggestions,
  ]);

  const ghostLaneEvidence = useMemo(() => {
    const evidence = new Map<
      string,
      {
        confidence: 'high' | 'medium' | 'low';
        evidenceCounts: Record<string, number>;
      }
    >();
    for (const person of ghostPeople) {
      const lane = `Suggested · ${
        ghostLaneLabelByGroupId.get(person.groupId) ?? FN_LABELS[person.function]
      }`;
      const current = evidence.get(lane) ?? {
        confidence: 'low' as const,
        evidenceCounts: {},
      };
      current.evidenceCounts[person.evidence.kind] =
        (current.evidenceCounts[person.evidence.kind] ?? 0) + 1;
      if (
        person.confidence === 'high' ||
        (person.confidence === 'medium' && current.confidence === 'low')
      ) {
        current.confidence = person.confidence;
      }
      evidence.set(lane, current);
    }
    return evidence;
  }, [ghostLaneLabelByGroupId, ghostPeople]);
  const fitSuggestionRef = useRef<ChartSuggestion | null>(null);
  useEffect(() => {
    if (
      !suggestion ||
      fitSuggestionRef.current === suggestion ||
      ghostNodes.length === 0
    ) {
      return;
    }
    fitSuggestionRef.current = suggestion;
    const timer = window.setTimeout(
      () => void rf.fitView({ nodes: ghostNodes, padding: 0.2, duration: 450 }),
      80
    );
    return () => window.clearTimeout(timer);
  }, [ghostNodes, rf, suggestion]);

  const toggleLane = useCallback((lane: string) => {
    setExpandedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }, []);

  const laneItems = useMemo(
    () =>
      [...nodes, ...ghostNodes].map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        person: n.data.person,
        dragging: n.dragging,
      })),
    [ghostNodes, nodes]
  );
  const view = useMemo(
    () =>
      computeLaneView(laneItems, {
        columns: isMobile ? 2 : 4,
        colGap: isMobile ? MOBILE_COL_GAP : LANE_COL_GAP,
        expandedLanes,
        collapsedLanes,
        showAll: showAllLanes,
        laneOf,
      }),
    [laneItems, isMobile, expandedLanes, collapsedLanes, showAllLanes, laneOf]
  );
  const visibleNodeCache = useRef(
    new WeakMap<
      Node<PersonNodeData>,
      { derived: Node<PersonNodeData>; x: number; y: number }
    >()
  );
  const laneView = useMemo(() => {
    // Synthetic nodes must declare their size: React Flow hides nodes until
    // they are measured, and these objects are recreated on every lane
    // recompute, which wipes their measured dimensions and leaves them
    // permanently invisible.
    const headers: Node<LaneHeaderData>[] = view.headers.map((header) => ({
      id: `lane:${header.lane}`,
      type: 'lane',
      position: { x: header.x, y: header.y - (isMobile ? 38 : 0) },
      width: header.span * (isMobile ? MOBILE_COL_GAP : LANE_COL_GAP) - 40,
      height: isMobile ? 72 : 34,
      data: {
        label: header.lane,
        count: header.count,
        span: header.span,
        colGap: isMobile ? MOBILE_COL_GAP : LANE_COL_GAP,
        shown: header.shown,
        expanded: header.expanded,
        onToggle: toggleLane,
        ...(ghostLaneEvidence.has(header.lane)
          ? { suggested: ghostLaneEvidence.get(header.lane) }
          : {}),
      },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      zIndex: -1,
    }));
    const tiles: Node<MoreNodeData>[] = view.tiles.map((tile) => ({
      id: `more:${tile.lane}`,
      type: 'more',
      position: { x: tile.x, y: tile.y },
      width: 250,
      height: isMobile ? 72 : 52,
      style: { width: 250 },
      data: { count: tile.count, lane: tile.lane, onExpand: toggleLane },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
    }));
    const visibleNodes = [...nodes, ...ghostNodes]
      .filter((node) => view.visibleIds.has(node.id))
      .map((node) => {
        const person = node.data.person;
        const ariaLabel = `${person.name}${person.title ? ', ' + person.title : ''}${person.department ? ', ' + person.department : ''}`;
        const pos = node.dragging ? undefined : view.posOverride.get(node.id);
        const x = pos?.x ?? node.position.x;
        const y = pos?.y ?? node.position.y;
        const cached = visibleNodeCache.current.get(node);
        if (
          cached &&
          cached.x === x &&
          cached.y === y &&
          cached.derived.data === node.data
        ) {
          return cached.derived;
        }
        const derived = {
          ...node,
          ...(pos ? { position: pos } : {}),
          ariaLabel,
        };
        visibleNodeCache.current.set(node, { derived, x, y });
        return derived;
      });
    return {
      nodes: [...headers, ...tiles, ...visibleNodes],
      shownCount: view.shownCount,
      hiddenCount: view.hiddenCount,
      laneOrder: view.laneOrder,
    };
  }, [
    ghostNodes,
    ghostLaneEvidence,
    nodes,
    view,
    isMobile,
    toggleLane,
  ]);

  const displayNodes = laneView.nodes;

  const pendingFocus = useRef<{ ids: Set<string>; single: boolean } | null>(
    null
  );
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const matched = displayNodes.filter((node) => pending.ids.has(node.id));
    if (matched.length !== pending.ids.size) return;
    const frame = window.requestAnimationFrame(() => {
      const current = pendingFocus.current;
      if (!current) return;
      const currentMatched = displayNodes.filter((node) =>
        current.ids.has(node.id)
      );
      if (currentMatched.length !== current.ids.size) return;
      const flow = document.querySelector('.react-flow') as HTMLElement | null;
      const bounds = getNodesBounds(
        currentMatched.map((node) => ({
          ...node,
          width: node.width ?? 250,
          height: node.height ?? NODE_H,
        }))
      );
      const vp = getViewportForBounds(
        bounds,
        flow?.clientWidth ?? window.innerWidth,
        flow?.clientHeight ?? window.innerHeight,
        0.4,
        1,
        current.single ? 0.6 : 0.35
      );
      rf.setViewport(vp, { duration: 450 });
      pendingFocus.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayNodes, rf]);

  const displayEdges = useMemo(() => {
    const nameById = new Map([
      ...people.map((person) => [person.id, person.name] as const),
      ...ghostPeople.map((person) => [`ghost:${person.rosterId}`, person.name] as const),
    ]);
    const displayedIds = new Set(
      displayNodes.filter((node) => node.type === 'person').map((node) => node.id)
    );
    const ghostEdges = ghostPeople.flatMap((person) => {
      const target = `ghost:${person.rosterId}`;
      const manager = person.reportsToRosterId
        ? `ghost:${person.reportsToRosterId}`
        : person.reportsToPersonId;
      if (!manager || !displayedIds.has(manager) || !displayedIds.has(target)) {
        return [];
      }
      return [{
        ...reportsEdge(manager, target, `ghost-edge:${person.rosterId}`, true),
        style: { opacity: 0.6, stroke: '#c7d2fe', strokeDasharray: '5 4' },
        selectable: false,
      }];
    });
    return [...edges, ...ghostEdges].map((edge) => {
      const sourceName = nameById.get(edge.source) ?? edge.source;
      const targetName = nameById.get(edge.target) ?? edge.target;
      const ariaLabel =
        edge.data?.kind === 'reports'
          ? `${targetName} reports to ${sourceName}`
          : `${sourceName} influences ${targetName}${edge.data?.label ? ': ' + edge.data.label : ''}`;
      return { ...edge, ariaLabel };
    });
  }, [displayNodes, edges, ghostPeople, people]);

  const relayLanes = useCallback(
    (ns: Node<PersonNodeData>[]) => {
      const laid = applyLanes(
        ns.map((n) => ({
          ...n.data.person,
          x: n.position.x,
          y: n.position.y,
        })),
        isMobile ? 2 : 4,
        laneGrouping,
        isMobile ? MOBILE_COL_GAP : LANE_COL_GAP
      );
      const pos = new Map(laid.map((p) => [p.id, { x: p.x, y: p.y }]));
      return ns.map((n) => ({
        ...n,
        position: pos.get(n.id) ?? n.position,
      }));
    },
    [isMobile, laneGrouping]
  );

  const lanesChanged = useCallback(
    (before: Node<PersonNodeData>[], after: Node<PersonNodeData>[]) => {
      const prev = new Map(
        before.map((n) => [n.id, laneKey(n.data.person, laneGrouping)])
      );
      return after.some((n) => {
        const was = prev.get(n.id);
        return was !== undefined && was !== laneKey(n.data.person, laneGrouping);
      });
    },
    [laneGrouping]
  );

  return {
    expandedLanes,
    setExpandedLanes,
    collapsedLanes,
    setCollapsedLanes,
    showAllLanes,
    setShowAllLanes,
    laneOf,
    ghostPeople,
    ghostNodes,
    laneItems,
    laneView,
    displayNodes,
    displayEdges,
    pendingFocus,
    toggleLane,
    relayLanes,
    lanesChanged,
  };
}
