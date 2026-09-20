import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import type {
  Connection,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance,
} from 'reactflow';
import { api } from '../../api';
import { useSession } from '../../store';
import { generateFixtureState } from '../../lib/devFixtures';
import {
  applyLanes,
  lanesInterleave,
  LANE_COL_GAP,
} from '../../lib/layout';
import type { LaneGrouping } from '../../lib/layout';
import type { PersonNodeData } from '../../components/PersonNode';
import { reportsEdge } from '../../lib/flowEdges';
import type { EdgeData, FlowEdge } from '../../lib/flowEdges';
import type {
  LoadedMap,
  MapGroup,
  MapPresence,
  MapState,
  MapVersion,
  ChartSuggestion,
} from '../../types';
import {
  MOBILE_COL_GAP,
  snapshot,
  toFlow,
  toState,
  type CanvasSnapshot,
  type SaveState,
} from './helpers';

type SuggestChartSlice = {
  mapId: string | null;
  suggestion: ChartSuggestion | null;
  declined: Set<string>;
};

export function useMapCanvas(deps: {
  mapId: string | undefined;
  fixtureMode: boolean;
  fixtureCount: number;
  isMobile: boolean;
  rf: ReactFlowInstance;
  openingFitOptions: { padding: number; minZoom?: number; maxZoom?: number };
  anchorTopLeft: (positions: { x: number; y: number }[]) => void;
  searchParams: URLSearchParams;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setShowBriefing: (open: boolean) => void;
  setBriefingEntry: (
    entry: 'dashboard' | 'direct' | 'spotlight' | 'toolbar'
  ) => void;
  setImportNotice: (notice: string) => void;
  setShowHistory: (open: boolean) => void;
  clearSuggestion: () => void;
  suggestChart: SuggestChartSlice;
}) {
  const {
    mapId,
    fixtureMode,
    fixtureCount,
    isMobile,
    rf,
    openingFitOptions,
    anchorTopLeft,
    searchParams,
    selectedId,
    setSelectedId,
    setShowBriefing,
    setBriefingEntry,
    setImportNotice,
    setShowHistory,
    clearSuggestion,
    suggestChart,
  } = deps;

  const mapViewEntry = useRef<'dashboard' | 'direct'>(
    searchParams.get('briefing') === '1' ? 'dashboard' : 'direct'
  );
  const [mapName, setMapName] = useState('');
  const [domain, setDomain] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const loadPersonas = useSession((session) => session.loadPersonas);
  const loadCoverage = useSession((session) => session.loadCoverage);
  const scheduleCoverage = useSession((session) => session.scheduleCoverage);
  const [meta, setMeta] = useState<MapState['meta'] | null>(null);
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member');
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>([]);
  const [rosterCounts, setRosterCounts] = useState<{
    suggested: number;
    added: number;
    dismissed: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loaded, setLoaded] = useState(false);
  const [versions, setVersions] = useState<MapVersion[]>([]);
  const [presence, setPresence] = useState<MapPresence[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [past, setPast] = useState<CanvasSnapshot[]>([]);
  const [future, setFuture] = useState<CanvasSnapshot[]>([]);
  const [laneGrouping, setLaneGrouping] =
    useState<LaneGrouping>('department');
  const saveTimer = useRef<number | null>(null);
  const dragHistoryRecorded = useRef(false);
  const metaRef = useRef<MapState['meta'] | null>(null);
  const groupsRef = useRef<MapGroup[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const remoteUpdatedAt = useRef('');
  const saveStateRef = useRef<SaveState>('saved');
  // Mirror of the latest canvas arrays. Handlers persist post-update state
  // through these refs instead of running side effects inside state
  // updaters, which StrictMode double-invokes in dev.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  const readOnly = role === 'viewer';
  const researchDue = Boolean(
    meta?.researchedAt &&
      (!meta.nextRefreshAt || Date.parse(meta.nextRefreshAt) <= Date.now())
  );

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (!mapId) return;
    const mapRequest = fixtureMode
      ? Promise.resolve({
          map: {
            state: generateFixtureState(fixtureCount, {
              columns: isMobile ? 2 : 4,
              colGap: isMobile ? MOBILE_COL_GAP : LANE_COL_GAP,
            }),
            name: `Fixture ${fixtureCount}`,
            domain: 'fixture.example',
            workspace_id: '',
            role: 'member' as const,
            updated_at: new Date().toISOString(),
          },
        })
      : api.getMap(mapId);
    mapRequest
      .then(({ map }) => {
        const flow = toFlow(map.state, map.role === 'viewer');
        groupsRef.current = map.state.groups ?? [];
        // Default view for accounts with meeting coverage: met/unmet lanes
        // segmented by team. Pure arrangement — nothing marked dirty.
        let anchorPeople = map.state.people ?? [];
        const hasMet = (map.state.people ?? []).some(
          (person) => person.metWith
        );
        const grouping = hasMet
          ? 'met'
          : lanesInterleave(map.state.people ?? [])
            ? 'department'
            : null;
        if (grouping) {
          if (hasMet) setLaneGrouping('met');
          anchorPeople = applyLanes(
            map.state.people ?? [],
            isMobile ? 2 : 4,
            grouping,
            isMobile ? MOBILE_COL_GAP : LANE_COL_GAP
          );
          const pos = new Map(
            anchorPeople.map((p) => [p.id, { x: p.x, y: p.y }])
          );
          flow.nodes = flow.nodes.map((n) => ({
            ...n,
            position: pos.get(n.id) ?? n.position,
          }));
        }
        nodesRef.current = flow.nodes;
        edgesRef.current = flow.edges;
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setMapName(map.name);
        setDomain(map.domain);
        setWorkspaceId(map.workspace_id);
        setMeta(map.state.meta);
        setRole(map.role);
        remoteUpdatedAt.current = map.updated_at;
        setPast([]);
        setFuture([]);
        setLoaded(true);
        void api
          .getRoster(mapId, { pageSize: 1 })
          .then(({ counts }) => setRosterCounts(counts))
          .catch(() => undefined);
        if (!fixtureMode) {
          void api
            .trackEvent(mapId, 'map_viewed', {
              entry: mapViewEntry.current,
            })
            .catch(() => undefined);
        }
        window.setTimeout(() => {
          // Tall maps center on nothing useful when fit to bounds — anchor
          // the top of the chart at a readable zoom instead.
          const tallEnough =
            anchorPeople.length > 0 &&
            Math.max(...anchorPeople.map((p) => p.y)) -
              Math.min(...anchorPeople.map((p) => p.y)) >
              window.innerHeight / 0.8;
          if (isMobile || tallEnough) anchorTopLeft(anchorPeople);
          else rf.fitView(openingFitOptions);
        }, 50);
      })
      .catch(() => setNotFound(true));
  }, [
    mapId,
    setNodes,
    setEdges,
    rf,
    openingFitOptions,
    isMobile,
    anchorTopLeft,
    fixtureCount,
    fixtureMode,
  ]);

  useEffect(() => {
    if (searchParams.get('briefing') === '1') {
      setBriefingEntry('dashboard');
      setShowBriefing(true);
    }
  }, [searchParams, setBriefingEntry, setShowBriefing]);

  useEffect(() => {
    if (!mapId || fixtureMode) return;
    const update = () => {
      const cursor = cursorRef.current;
      void api
        .updatePresence(mapId, {
          cursorX: cursor?.x,
          cursorY: cursor?.y,
          selectedPersonId: selectedId,
        })
        .then(({ people: activePeople, selfId: currentUserId }) => {
          setPresence(activePeople);
          setSelfId(currentUserId);
        })
        .catch(() => undefined);
    };
    update();
    const interval = window.setInterval(update, 1_500);
    return () => window.clearInterval(interval);
  }, [mapId, selectedId, fixtureMode]);

  useEffect(() => {
    if (!mapId || fixtureMode) return;
    const sync = () => {
      if (saveStateRef.current !== 'saved') return;
      void api
        .getMap(mapId)
        .then(({ map }) => {
          if (!remoteUpdatedAt.current) {
            remoteUpdatedAt.current = map.updated_at;
            return;
          }
          if (map.updated_at <= remoteUpdatedAt.current) return;
          remoteUpdatedAt.current = map.updated_at;
          const flow = toFlow(map.state, map.role === 'viewer');
          groupsRef.current = map.state.groups ?? [];
          setMapName(map.name);
          setMeta(map.state.meta);
          nodesRef.current = flow.nodes;
          edgesRef.current = flow.edges;
          setNodes(flow.nodes);
          setEdges(flow.edges);
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(sync, 3_000);
    return () => window.clearInterval(interval);
  }, [mapId, setNodes, setEdges, fixtureMode]);

  const openHistory = useCallback(() => {
    if (!mapId || fixtureMode) return;
    setShowHistory(true);
    void api
      .listVersions(mapId)
      .then(({ versions: items }) => setVersions(items))
      .catch(() => undefined);
  }, [mapId, fixtureMode, setShowHistory]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!mapId || fixtureMode) return;
      try {
        const restored = await api.restoreVersion(mapId, versionId);
        const flow = toFlow(restored.state, readOnly);
        groupsRef.current = restored.state.groups ?? [];
        setMapName(restored.name);
        setMeta(restored.state.meta);
        nodesRef.current = flow.nodes;
        edgesRef.current = flow.edges;
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setPast([]);
        setFuture([]);
        setShowHistory(false);
        setSaveState('saved');
      } catch {
        setImportNotice('Restore failed — try again.');
        window.setTimeout(() => setImportNotice(''), 5_000);
      }
    },
    [
      mapId,
      readOnly,
      setNodes,
      setEdges,
      fixtureMode,
      setShowHistory,
      setImportNotice,
    ]
  );

  const persist = useCallback(
    (ns: Node<PersonNodeData>[], es: FlowEdge[]) => {
      if (fixtureMode) {
        saveStateRef.current = 'saved';
        setSaveState('saved');
        return;
      }
      if (!mapId || !metaRef.current || readOnly) return;
      saveStateRef.current = 'saving';
      setSaveState('saving');
      api
        .patchMap(mapId, { state: toState(ns, es, metaRef.current, groupsRef.current) })
        .then(({ updatedAt }) => {
          remoteUpdatedAt.current = updatedAt;
          saveStateRef.current = 'saved';
          setSaveState('saved');
          scheduleCoverage(mapId);
        })
        .catch(() => {
          saveStateRef.current = 'dirty';
          setSaveState('dirty');
        });
    },
    [mapId, readOnly, fixtureMode, scheduleCoverage]
  );

  const markDirty = useCallback(
    (ns: Node<PersonNodeData>[], es: FlowEdge[]) => {
      if (readOnly) return;
      saveStateRef.current = 'dirty';
      setSaveState('dirty');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => persist(ns, es), 900);
    },
    [persist, readOnly]
  );

  const flushPendingPersist = useCallback(async () => {
    if (
      !mapId ||
      !metaRef.current ||
      readOnly ||
      saveStateRef.current === 'saved'
    ) {
      return;
    }
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveStateRef.current = 'saving';
    setSaveState('saving');
    try {
      const { updatedAt } = await api.patchMap(mapId, {
        state: toState(
          nodesRef.current,
          edgesRef.current,
          metaRef.current,
          groupsRef.current
        ),
      });
      remoteUpdatedAt.current = updatedAt;
      saveStateRef.current = 'saved';
      setSaveState('saved');
    } catch (error) {
      saveStateRef.current = 'dirty';
      setSaveState('dirty');
      throw error;
    }
  }, [mapId, readOnly]);

  const handleRosterMapUpdated = useCallback(
    (updatedMap: LoadedMap) => {
      const flow = toFlow(updatedMap.state, readOnly);
      setMapName(updatedMap.name);
      setDomain(updatedMap.domain);
      setMeta(updatedMap.state.meta);
      groupsRef.current = updatedMap.state.groups ?? [];
      nodesRef.current = flow.nodes;
      edgesRef.current = flow.edges;
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setPast([]);
      setFuture([]);
      setSaveState('saved');
      saveStateRef.current = 'saved';
      remoteUpdatedAt.current = updatedMap.updated_at;
    },
    [readOnly, setEdges, setNodes]
  );

  const recordHistory = useCallback(() => {
    if (readOnly) return;
    setPast((items) => [...items.slice(-49), snapshot(nodes, edges)]);
    setFuture([]);
  }, [readOnly, nodes, edges]);

  const restore = useCallback(
    (next: CanvasSnapshot) => {
      const restored = snapshot(next.nodes, next.edges);
      nodesRef.current = restored.nodes;
      edgesRef.current = restored.edges;
      setNodes(restored.nodes);
      setEdges(restored.edges);
      markDirty(restored.nodes, restored.edges);
      setSelectedId(null);
    },
    [setNodes, setEdges, markDirty, setSelectedId]
  );

  const undo = useCallback(() => {
    if (readOnly || past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [snapshot(nodes, edges), ...items.slice(0, 49)]);
    restore(previous);
  }, [readOnly, past, nodes, edges, restore]);

  const redo = useCallback(() => {
    if (readOnly || future.length === 0) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-49), snapshot(nodes, edges)]);
    restore(next);
  }, [readOnly, future, nodes, edges, restore]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      nodesRef.current = applyNodeChanges(changes, nodesRef.current);
      if (changes.some((ch) => ch.type === 'position' || ch.type === 'remove')) {
        markDirty(nodesRef.current, edgesRef.current);
      }
    },
    [onNodesChange, markDirty]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      edgesRef.current = applyEdgeChanges(changes, edgesRef.current);
      if (changes.some((ch) => ch.type === 'remove')) {
        markDirty(nodesRef.current, edgesRef.current);
      }
    },
    [onEdgesChange, markDirty]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      recordHistory();
      // one formal manager per person
      const next = [
        ...edgesRef.current.filter(
          (e) => !(e.data?.kind === 'reports' && e.target === conn.target)
        ),
        reportsEdge(conn.source!, conn.target!),
      ];
      edgesRef.current = next;
      setEdges(next);
      markDirty(nodesRef.current, next);
    },
    [setEdges, markDirty, recordHistory]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      recordHistory();
      const ids = new Set(deleted.map((n) => n.id));
      const next = edgesRef.current.filter(
        (e) => !ids.has(e.source) && !ids.has(e.target)
      );
      edgesRef.current = next;
      setEdges(next);
      markDirty(
        nodesRef.current.filter((n) => !ids.has(n.id)),
        next
      );
      setSelectedId((sel) => (sel && ids.has(sel) ? null : sel));
    },
    [setEdges, markDirty, recordHistory, setSelectedId]
  );

  const saveName = useCallback(() => {
    if (!mapId || readOnly || fixtureMode) return;
    void api.patchMap(mapId, { name: mapName }).catch(() => {
      saveStateRef.current = 'dirty';
      setSaveState('dirty');
    });
  }, [mapId, mapName, readOnly, fixtureMode]);

  useEffect(() => {
    if (!loaded || !mapId) return;
    void loadCoverage(mapId);
  }, [loaded, mapId, loadCoverage]);

  const workspaceReady = useSession(
    (session) => !!workspaceId && session.workspaceId === workspaceId
  );
  useEffect(() => {
    if (workspaceReady) void loadPersonas();
  }, [workspaceReady, loadPersonas]);


  useEffect(() => {
    if (suggestChart.mapId && suggestChart.mapId !== mapId) {
      clearSuggestion();
    }
  }, [clearSuggestion, mapId, suggestChart.mapId]);

  useEffect(() => {
    const hasGhosts =
      suggestChart.mapId === mapId &&
      Boolean(
        suggestChart.suggestion?.people.some(
          (person) => !suggestChart.declined.has(person.rosterId)
        )
      );
    if (!hasGhosts) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [mapId, suggestChart]);

  const people = useMemo(() => nodes.map((n) => n.data.person), [nodes]);

  return {
    mapName,
    setMapName,
    domain,
    workspaceId,
    meta,
    setMeta,
    metaRef,
    groupsRef,
    role,
    readOnly,
    researchDue,
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    nodesRef,
    edgesRef,
    people,
    rosterCounts,
    setRosterCounts,
    saveState,
    saveStateRef,
    loaded,
    notFound,
    versions,
    presence,
    selfId,
    past,
    future,
    laneGrouping,
    setLaneGrouping,
    remoteUpdatedAt,
    cursorRef,
    dragHistoryRecorded,
    handleNodesChange,
    handleEdgesChange,
    onConnect,
    onNodesDelete,
    openHistory,
    restoreVersion,
    persist,
    markDirty,
    flushPendingPersist,
    handleRosterMapUpdated,
    recordHistory,
    restore,
    undo,
    redo,
    saveName,
  };
}

