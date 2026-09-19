import { useCallback, useRef } from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';
import { api } from '../../api';
import { influenceEdge, reportsEdge } from '../../lib/flowEdges';
import type { FlowEdge } from '../../lib/flowEdges';
import { applyLanes, applyLayout, LANE_COL_GAP } from '../../lib/layout';
import type { LaneGrouping } from '../../lib/layout';
import { personDepartmentToFn, FN_LABELS } from '../../lib/taxonomy';
import type { PersonNodeData } from '../../components/PersonNode';
import type {
  AccountStrategyPlan,
  LoadedMap,
  MapEdge,
  MapState,
  Persona,
  PersonaCoverage,
  Person,
} from '../../types';
import {
  MOBILE_COL_GAP,
  PERSONA_FILTER_EVENT,
  edgeToMap,
  type PersonaFilterDetail,
} from './helpers';

export function useMapActions(deps: {
  mapId: string | undefined;
  readOnly: boolean;
  isMobile: boolean;
  rf: ReactFlowInstance;
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
  people: Person[];
  nodesRef: { current: Node<PersonNodeData>[] };
  edgesRef: { current: FlowEdge[] };
  metaRef: { current: MapState['meta'] | null };
  setNodes: (ns: Node<PersonNodeData>[]) => void;
  setEdges: (es: FlowEdge[]) => void;
  setSelectedId: (id: string | null) => void;
  setMeta: (meta: MapState['meta'] | null) => void;
  laneGrouping: LaneGrouping;
  setLaneGrouping: (grouping: LaneGrouping) => void;
  laneOf: (person: Person) => string;
  relayLanes: (ns: Node<PersonNodeData>[]) => Node<PersonNodeData>[];
  lanesChanged: (
    before: Node<PersonNodeData>[],
    after: Node<PersonNodeData>[]
  ) => boolean;
  setExpandedLanes: (
    update: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => void;
  setCollapsedLanes: (
    update: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => void;
  pendingFocus: {
    current: { ids: Set<string>; single: boolean } | null;
  };
  personaById: Map<string, Persona>;
  setImportNotice: (notice: string) => void;
  recordHistory: () => void;
  markDirty: (ns: Node<PersonNodeData>[], es: FlowEdge[]) => void;
  handleRosterMapUpdated: (updatedMap: LoadedMap) => void;
  setShowSuggest: (open: boolean | ((v: boolean) => boolean)) => void;
  setRosterCounts: (
    counts: { suggested: number; added: number; dismissed: number } | null
  ) => void;
  anchorTopLeft: (positions: { x: number; y: number }[]) => void;
}) {
  const {
    mapId,
    readOnly,
    isMobile,
    rf,
    nodes,
    edges,
    people,
    nodesRef,
    edgesRef,
    metaRef,
    setNodes,
    setEdges,
    setSelectedId,
    setMeta,
    laneGrouping,
    setLaneGrouping,
    laneOf,
    relayLanes,
    setExpandedLanes,
    setCollapsedLanes,
    pendingFocus,
    personaById,
    setImportNotice,
    recordHistory,
    markDirty,
    handleRosterMapUpdated,
    setShowSuggest,
    setRosterCounts,
    anchorTopLeft,
  } = deps;

  const editTimer = useRef<number | null>(null);

  const updatePerson = useCallback(
    (updated: Person) => {
      if (!editTimer.current) recordHistory();
      if (editTimer.current) window.clearTimeout(editTimer.current);
      editTimer.current = window.setTimeout(() => {
        editTimer.current = null;
      }, 750);
      const current = nodesRef.current;
      const metChanged =
        laneGrouping === 'met' &&
        current.some(
          (n) =>
            n.id === updated.id &&
            Boolean(n.data.person.metWith) !== Boolean(updated.metWith)
        );
      const next = current.map((n) =>
        n.id === updated.id
          ? { ...n, data: { ...n.data, person: updated } }
          : n
      );
      // Under the met split a met flip changes the person's lane — relay
      // so the card physically joins the other band.
      const positioned = metChanged ? relayLanes(next) : next;
      nodesRef.current = positioned;
      setNodes(positioned);
      markDirty(positioned, edgesRef.current);
    },
    [setNodes, markDirty, recordHistory, laneGrouping, relayLanes, edgesRef, nodesRef]
  );

  const setManager = useCallback(
    (personId: string, managerId: string | null) => {
      recordHistory();
      const without = edgesRef.current.filter(
        (e) => !(e.data?.kind === 'reports' && e.target === personId)
      );
      const next = managerId
        ? [...without, reportsEdge(managerId, personId)]
        : without;
      edgesRef.current = next;
      setEdges(next);
      markDirty(nodesRef.current, next);
    },
    [setEdges, markDirty, recordHistory, edgesRef, nodesRef]
  );

  const addInfluence = useCallback(
    (fromId: string, toId: string, label: string) => {
      recordHistory();
      const next = [
        ...edgesRef.current,
        influenceEdge(fromId, toId, label || null),
      ];
      edgesRef.current = next;
      setEdges(next);
      markDirty(nodesRef.current, next);
    },
    [setEdges, markDirty, recordHistory, edgesRef, nodesRef]
  );

  // Meeting import: flag matched people as Met (adopting captured titles
  // only when the map has no real title yet) and append unmatched names as
  // new Met nodes in a fresh row below the map.
  const applyMeetings = useCallback(
    (
      matched: { person: Person; title: string | null }[],
      unmatched: { name: string; title: string | null }[]
    ) => {
      if (readOnly) return;
      recordHistory();
      const titleById = new Map(
        matched.map((entry) => [entry.person.id, entry.title] as const)
      );
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const bounds =
        nodes.length > 0
          ? {
              minX: Math.min(...nodes.map((n) => n.position.x)),
              maxY: Math.max(...nodes.map((n) => n.position.y)),
            }
          : null;
      const startX = bounds ? bounds.minX : center.x;
      const startY = bounds ? bounds.maxY + 240 : center.y;
      const additions = unmatched.map((entry, index) => {
        const x = startX + (index % 6) * 300;
        const y = startY + Math.floor(index / 6) * 260;
        const person: Person = {
          id: crypto.randomUUID(),
          name: entry.name,
          title: entry.title ?? '',
          department: null,
          team: null,
          productLine: null,
          teamEvidence: null,
          role: 'none',
          confidence: 'low',
          sources: [],
          notes: '',
          email: null,
          linkedin: null,
          metWith: true,
          x,
          y,
        };
        return {
          id: person.id,
          type: 'person' as const,
          position: { x, y },
          data: { person, readOnly: false },
          style: { width: 250 },
        };
      });
      const next = [
        ...nodesRef.current.map((node) => {
          const capturedTitle = titleById.get(node.id);
          if (capturedTitle === undefined) return node;
          const person = node.data.person;
          const adoptTitle =
            !!capturedTitle &&
            (!person.title || person.title.trim().toLowerCase() === 'employee');
          return {
            ...node,
            data: {
              ...node.data,
              person: {
                ...person,
                metWith: true,
                ...(adoptTitle ? { title: capturedTitle } : {}),
              },
            },
          };
        }),
        ...additions,
      ];
      // Imported matches belong in the Met lane under the met split, and
      // unmatched names land in their lane band rather than a loose row.
      const positioned =
        laneGrouping === 'met' || unmatched.length > 0
          ? relayLanes(next)
          : next;
      nodesRef.current = positioned;
      setNodes(positioned);
      markDirty(positioned, edgesRef.current);
    },
    [
      edgesRef,
      nodesRef,
      markDirty,
      nodes,
      readOnly,
      recordHistory,
      rf,
      setNodes,
      laneGrouping,
      relayLanes,
    ]
  );

  const addPerson = useCallback((draft?: Partial<Person>) => {
    recordHistory();
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    // Land new cards below the chart's left edge — viewport center almost
    // always overlaps someone on a busy map.
    const spot =
      nodes.length === 0
        ? center
        : {
            x: Math.min(...nodes.map((n) => n.position.x)),
            y: Math.max(...nodes.map((n) => n.position.y)) + 160,
          };
    const person: Person = {
      id: crypto.randomUUID(),
      name: draft?.name ?? 'New person',
      title: draft?.title ?? '',
      department: draft?.department ?? null,
      team: draft?.team ?? null,
      productLine: draft?.productLine ?? null,
      teamEvidence: draft?.team ? 'inferred' : null,
      role: 'none',
      // Manually added people carry no evidence — mark unverified rather
      // than impersonating researched confidence.
      confidence: 'low',
      sources: [],
      notes: '',
      email: null,
      linkedin: null,
      x: spot.x,
      y: spot.y,
    };
    const next = [
      ...nodesRef.current,
      {
        id: person.id,
        type: 'person' as const,
        position: { x: spot.x, y: spot.y },
        data: { person, readOnly: false },
        style: { width: 250 },
      },
    ];
    nodesRef.current = next;
    setNodes(next);
    markDirty(next, edgesRef.current);
    setSelectedId(person.id);
    window.setTimeout(() => {
      void rf.setCenter(spot.x + 125, spot.y + 45, {
        zoom: rf.getZoom(),
        duration: 300,
      });
    }, 60);
  }, [rf, nodes, setNodes, markDirty, recordHistory, edgesRef, nodesRef, setSelectedId]);

  const focusPeople = useCallback(
    (matches: Person[]) => {
      if (matches.length === 0) return;
      // Reveal any lanes whose members are collapsed out of view so matches
      // are actually visible on the canvas.
      const lanes = new Set(matches.map((person) => laneOf(person)));
      setCollapsedLanes((prev) =>
        prev.size === 0 ? prev : new Set([...prev].filter((l) => !lanes.has(l)))
      );
      setExpandedLanes((prev) => {
        const next = new Set(prev);
        for (const lane of lanes) next.add(lane);
        return next;
      });
      const ids = new Set(matches.map((person) => person.id));
      const next = nodesRef.current.map((node) => ({
        ...node,
        selected: ids.has(node.id),
      }));
      nodesRef.current = next;
      setNodes(next);
      pendingFocus.current = {
        ids,
        single: matches.length === 1,
      };
      setSelectedId(matches.length === 1 ? matches[0].id : null);
    },
    [setNodes, laneOf, setCollapsedLanes, setExpandedLanes, setSelectedId, nodesRef, pendingFocus]
  );

  // Persona click: covered → select the matched people; missing → narrow the
  // canvas to the lanes holding that persona's functions. Either way we
  // broadcast `org:persona-filter` so sibling surfaces follow along.
  const focusPersona = useCallback(
    (entry: PersonaCoverage) => {
      const persona = personaById.get(entry.personaId);
      const functions = persona?.functions ?? [];
      window.dispatchEvent(
        new CustomEvent<PersonaFilterDetail>(PERSONA_FILTER_EVENT, {
          detail: {
            personaId: entry.personaId,
            name: entry.name,
            functions,
            minSeniority: persona?.minSeniority ?? 'unknown',
          },
        })
      );
      if (entry.covered) {
        const ids = new Set(entry.matches.map((m) => m.personId));
        focusPeople(people.filter((person) => ids.has(person.id)));
        return;
      }
      const inFunction =
        functions.length === 0
          ? people
          : people.filter((person) =>
              functions.includes(
                personDepartmentToFn(person.department, person.title)
              )
            );
      if (inFunction.length === 0) {
        const label =
          functions.length > 0
            ? functions.map((fn) => FN_LABELS[fn]).join(' / ')
            : 'that function';
        setImportNotice(`No one from ${label} on this map yet — add them to cover “${entry.name}”.`);
        window.setTimeout(() => setImportNotice(''), 5_000);
        return;
      }
      const targetLanes = new Set(inFunction.map((person) => laneOf(person)));
      const otherLanes = people
        .map((person) => laneOf(person))
        .filter((lane) => !targetLanes.has(lane));
      setExpandedLanes(new Set(targetLanes));
      setCollapsedLanes(new Set(otherLanes));
      const laneIds = new Set(inFunction.map((person) => person.id));
      const laneNodes = nodes.filter((node) => laneIds.has(node.id));
      window.setTimeout(
        () => rf.fitView({ nodes: laneNodes, padding: 0.35, duration: 450 }),
        30
      );
    },
    [
      personaById,
      people,
      nodes,
      rf,
      laneOf,
      focusPeople,
      setExpandedLanes,
      setCollapsedLanes,
      setImportNotice,
    ]
  );

  const deletePerson = useCallback(
    (personId: string) => {
      recordHistory();
      const nextNodes = nodesRef.current.filter((n) => n.id !== personId);
      const nextEdges = edgesRef.current.filter(
        (e) => e.source !== personId && e.target !== personId
      );
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      markDirty(nextNodes, nextEdges);
      setSelectedId(null);
    },
    [setNodes, setEdges, markDirty, recordHistory, setSelectedId, edgesRef, nodesRef]
  );

  const autoLayout = useCallback(
    (mode: LaneGrouping | 'hierarchy' = 'department') => {
      recordHistory();
      const currentPeople = nodes.map((n) => ({
        ...n.data.person,
        x: n.position.x,
        y: n.position.y,
      }));
      const currentEdges: MapEdge[] = edges.map(edgeToMap);
      const laid =
        mode === 'hierarchy'
          ? applyLayout(currentPeople, currentEdges)
          : applyLanes(currentPeople, isMobile ? 2 : 4, mode, isMobile ? MOBILE_COL_GAP : LANE_COL_GAP);
      if (mode !== 'hierarchy') setLaneGrouping(mode);
      const pos = new Map(laid.map((p) => [p.id, { x: p.x, y: p.y }]));
      const next = nodesRef.current.map((n) => ({
        ...n,
        position: pos.get(n.id) ?? n.position,
      }));
      nodesRef.current = next;
      setNodes(next);
      markDirty(next, edgesRef.current);
      window.setTimeout(() => {
        if (mode !== 'hierarchy') anchorTopLeft(laid);
        else rf.fitView({ padding: 0.2 });
      }, 50);
    },
    [
      edgesRef,
      nodesRef,
      nodes,
      edges,
      setNodes,
      markDirty,
      rf,
      recordHistory,
      anchorTopLeft,
      isMobile,
      setLaneGrouping,
    ]
  );

  const handleSuggestedApplied = useCallback(
    (updatedMap: LoadedMap) => {
      const laid = applyLanes(
        updatedMap.state.people,
        isMobile ? 2 : 4,
        laneGrouping,
        isMobile ? MOBILE_COL_GAP : LANE_COL_GAP
      );
      const laidMap = {
        ...updatedMap,
        state: { ...updatedMap.state, people: laid },
      };
      handleRosterMapUpdated(laidMap);
      setShowSuggest(false);
      markDirty(nodesRef.current, edgesRef.current);
      window.setTimeout(
        () => void rf.fitView({ padding: 0.2, duration: 450 }),
        80
      );
      if (mapId) {
        void api
          .getRoster(mapId, { pageSize: 1 })
          .then(({ counts }) => setRosterCounts(counts))
          .catch(() => undefined);
      }
    },
    [
      edgesRef,
      nodesRef,
      handleRosterMapUpdated,
      isMobile,
      laneGrouping,
      markDirty,
      mapId,
      rf,
      setShowSuggest,
      setRosterCounts,
    ]
  );

  const updateStrategyPlan = useCallback(
    (plan: AccountStrategyPlan) => {
      if (readOnly || !metaRef.current) return;
      const nextMeta = { ...metaRef.current, strategy: plan };
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      markDirty(nodes, edges);
    },
    [edges, markDirty, nodes, readOnly, setMeta, metaRef]
  );

  return {
    updatePerson,
    setManager,
    addInfluence,
    applyMeetings,
    addPerson,
    focusPeople,
    focusPersona,
    deletePerson,
    autoLayout,
    handleSuggestedApplied,
    updateStrategyPlan,
  };
}
