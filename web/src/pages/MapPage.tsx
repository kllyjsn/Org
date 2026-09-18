import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
} from 'reactflow';
import type { Connection, EdgeChange, Node, NodeChange } from 'reactflow';
import { influenceEdge, reportsEdge } from '../lib/flowEdges';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { EdgeData, FlowEdge } from '../lib/flowEdges';

function edgeToMap(e: FlowEdge): MapEdge {
  return {
    id: e.id,
    from: e.source,
    to: e.target,
    kind: e.data?.kind ?? 'reports',
    label: e.data?.label ?? null,
    inferred: e.data?.inferred || undefined,
  };
}
import { toPng } from 'html-to-image';
import { AnimatePresence } from 'framer-motion';
import {
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  ArrowLeft,
  BellRing,
  Compass,
  Copy,
  Download,
  FileUp,
  History,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Radar,
  Redo2,
  Search,
  Share2,
  Sparkles,
  Ungroup,
  Undo2,
  Waypoints,
  Group,
  Handshake,
  MessageSquare,
  Network,
  Rows3,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wand2,
} from 'lucide-react';
import { api } from '../api';
import { useSession } from '../store';
import AccountBriefingModal from '../components/AccountBriefingModal';
import AccountStrategyModal from '../components/AccountStrategyModal';
import ChangeAlertsModal from '../components/ChangeAlertsModal';
import CommandPalette from '../components/CommandPalette';
import type { PaletteAction } from '../components/CommandPalette';
import {
  describeGrouping,
  describePersonEdit,
  describeRelationship,
  describeRelationshipView,
} from '../lib/agentCanvas';
import type {
  AgentCommandResult,
  AgentGroupingField,
  AgentRelationshipView,
} from '../lib/agentCanvas';
import DeepResearchModal from '../components/DeepResearchModal';
import FeedbackModal from '../components/FeedbackModal';
import PersonNode from '../components/PersonNode';
import type { PersonNodeData } from '../components/PersonNode';
import LaneHeaderNode from '../components/LaneHeaderNode';
import type { LaneHeaderData } from '../components/LaneHeaderNode';
import MoreNode from '../components/MoreNode';
import type { MoreNodeData } from '../components/MoreNode';
import PersonPanel from '../components/PersonPanel';
import MeetingsImportModal from '../components/MeetingsImportModal';
import RailButton, { RailSeparator } from '../components/RailButton';
import RosterDrawer from '../components/RosterDrawer';
import RosterView from '../components/RosterView';
import ShareModal from '../components/ShareModal';
import {
  applyLanes,
  applyLayout,
  laneKey,
  lanesInterleave,
  LANE_COL_GAP,
  NODE_H,
} from '../lib/layout';
import type { LaneGrouping } from '../lib/layout';
import { computeLaneView } from '../lib/laneView';
import { generateFixtureState } from '../lib/devFixtures';
import { isBigMap } from '../lib/bigMap';
import { planPngExport } from '../lib/pngExport';
import { useIsMobile } from '../lib/useIsMobile';
import { matchesAllTokens } from '../lib/searchText';
import { ROLE_META } from '../lib/colors';
import { parseCsv } from '../lib/csv';
import { personDepartmentToFn, FN_LABELS, SENIORITY_LABELS } from '../lib/taxonomy';
import type { Fn, Seniority } from '../lib/taxonomy';
import {
  corroborationCount,
  evidenceFreshness,
  canonicalPersonName,
} from '../lib/researchQuality';
import type {
  AccountAgentAction,
  AccountAgentMessage,
  AccountStrategyPlan,
  BriefingAction,
  BuyingRole,
  ChartSuggestion,
  LoadedMap,
  MapEdge,
  MapGroup,
  MapPresence,
  MapState,
  MapVersion,
  Persona,
  PersonaCoverage,
  Person,
  ResearchResult,
} from '../types';
import SuggestChartPanel from '../components/SuggestChartPanel';

/**
 * `org:persona-filter` — dispatched on `window` when a user clicks a persona
 * in the coverage popover. Sibling surfaces (roster drawer, suggested org
 * chart) can listen and narrow themselves to the same targeting slice:
 *
 *   window.addEventListener('org:persona-filter', (e) => {
 *     const { functions, minSeniority, personaId } =
 *       (e as CustomEvent<PersonaFilterDetail>).detail;
 *   });
 *
 * `functions` is empty when the persona accepts any function; `minSeniority`
 * is an inclusive floor ('vp' = VP and above).
 */
export const PERSONA_FILTER_EVENT = 'org:persona-filter';
export interface PersonaFilterDetail {
  personaId: string;
  name: string;
  functions: Fn[];
  minSeniority: Seniority;
}

const nodeTypes = { person: PersonNode, lane: LaneHeaderNode, more: MoreNode };

const COMMITTEE_ROLES: BuyingRole[] = [
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_buyer',
  'influencer',
  'blocker',
];

// Tighter column spacing on phones so two lanes fit the viewport.
const MOBILE_COL_GAP = 270;

const MemoMiniMap = memo(MiniMap);

function toFlow(
  state: MapState,
  readOnly = false
): { nodes: Node<PersonNodeData>[]; edges: FlowEdge[] } {
  const nodes: Node<PersonNodeData>[] = (state.people ?? []).map((p) => ({
    id: p.id,
    type: 'person',
    position: { x: p.x, y: p.y },
    data: { person: p, readOnly },
    style: { width: p.width ?? 250, height: p.height },
  }));
  const edges: FlowEdge[] = (state.edges ?? []).map((e) =>
    e.kind === 'reports'
      ? reportsEdge(e.from, e.to, e.id, e.inferred)
      : influenceEdge(e.from, e.to, e.label, e.id)
  );
  return { nodes, edges };
}

function toState(
  nodes: Node<PersonNodeData>[],
  edges: FlowEdge[],
  meta: MapState['meta'],
  groups: MapGroup[]
): MapState {
  return {
    people: nodes.map((n) => ({
      ...n.data.person,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? n.data.person.width,
      height: n.height ?? n.data.person.height,
    })),
    edges: edges.map(edgeToMap),
    meta,
    ...(groups.length > 0 ? { groups } : {}),
  };
}

type SaveState = 'saved' | 'dirty' | 'saving';
type CanvasSnapshot = {
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
};

function snapshot(
  nodes: Node<PersonNodeData>[],
  edges: FlowEdge[]
): CanvasSnapshot {
  return structuredClone({ nodes, edges });
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === 'INPUT' ||
    element?.tagName === 'TEXTAREA' ||
    element?.isContentEditable === true
  );
}

function MapInner() {
  const { mapId } = useParams<{ mapId: string }>();
  const [searchParams] = useSearchParams();
  const mapViewEntry = useRef<'dashboard' | 'direct'>(
    searchParams.get('briefing') === '1' ? 'dashboard' : 'direct'
  );
  const fixtureCount = import.meta.env.DEV
    ? Number(searchParams.get('fixture')) || 0
    : 0;
  const fixtureMode = fixtureCount > 0;
  const rf = useReactFlow();
  const viewport = useViewport();
  const isMobile = useIsMobile();
  const [mapName, setMapName] = useState('');
  const [domain, setDomain] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const sellerProfile = useSession(
    (session) =>
      session.workspaces.find((workspace) => workspace.id === workspaceId)
        ?.seller_profile ?? null
  );
  const personas = useSession((session) => session.personas);
  const loadPersonas = useSession((session) => session.loadPersonas);
  const loadCoverage = useSession((session) => session.loadCoverage);
  const scheduleCoverage = useSession((session) => session.scheduleCoverage);
  const personaCoverage = useSession((session) =>
    session.coverage && session.coverage.mapId === mapId
      ? session.coverage.data
      : null
  );
  const [meta, setMeta] = useState<MapState['meta'] | null>(null);
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member');
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'roster'>('canvas');
  const [viewModeTouched, setViewModeTouched] = useState(false);
  useDocumentTitle(`${mapName || 'Map'} — TopDown`);
  const [showMeetings, setShowMeetings] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestChart = useSession((session) => session.suggestChart);
  const confirmSuggestion = useSession((session) => session.confirm);
  const declineSuggestion = useSession((session) => session.decline);
  const confirmHighOnly = useSession((session) => session.confirmHighOnly);
  const applySuggestion = useSession((session) => session.applySuggestion);
  const clearSuggestion = useSession((session) => session.clearSuggestion);
  const suggestionMapId = suggestChart.mapId;
  const suggestion = suggestChart.suggestion;
  const confirmedSuggestions = suggestChart.confirmed;
  const declinedSuggestions = suggestChart.declined;
  const [rosterCounts, setRosterCounts] = useState<{
    suggested: number;
    added: number;
    dismissed: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loaded, setLoaded] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showInitiatives, setShowInitiatives] = useState(false);
  const historyTrapRef = useRef<HTMLDivElement>(null);
  const initiativesTrapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(historyTrapRef, showHistory);
  useFocusTrap(initiativesTrapRef, showInitiatives);
  const [showStrategy, setShowStrategy] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingEntry, setBriefingEntry] = useState<
    'dashboard' | 'direct' | 'spotlight' | 'toolbar'
  >('direct');
  const [showChanges, setShowChanges] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showDeepResearch, setShowDeepResearch] = useState(false);
  const [deepResearchFocus, setDeepResearchFocus] = useState('');
  const [versions, setVersions] = useState<MapVersion[]>([]);
  const [presence, setPresence] = useState<MapPresence[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [past, setPast] = useState<CanvasSnapshot[]>([]);
  const [future, setFuture] = useState<CanvasSnapshot[]>([]);
  const saveTimer = useRef<number | null>(null);
  const editTimer = useRef<number | null>(null);
  const dragHistoryRecorded = useRef(false);
  const clipboard = useRef<CanvasSnapshot | null>(null);
  const crmInput = useRef<HTMLInputElement | null>(null);
  const metaRef = useRef<MapState['meta'] | null>(null);
  const groupsRef = useRef<MapGroup[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const remoteUpdatedAt = useRef('');
  const saveStateRef = useRef<SaveState>('saved');
  const pendingFocus = useRef<{ ids: Set<string>; single: boolean } | null>(
    null
  );
  // Mirror of the latest canvas arrays. Handlers persist post-update state
  // through these refs instead of running side effects inside state
  // updaters, which StrictMode double-invokes in dev.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  const readOnly = role === 'viewer';
  // Phone viewports fit an entire org to ~20% zoom, which renders cards
  // unreadable, so open on the top of the hierarchy at a legible scale.
  const openingFitOptions = useMemo(
    () =>
      isMobile
        ? { padding: 0.1, minZoom: 0.62, maxZoom: 0.9 }
        : { padding: 0.2, minZoom: 0.45 },
    [isMobile]
  );
  // Anchoring the first card near the top-left at a legible zoom keeps tall
  // department lanes usable; centering a tall map can leave no whole card in
  // view on a phone.
  const anchorTopLeft = useCallback(
    (positions: { x: number; y: number }[]) => {
      if (positions.length === 0) return;
      const minX = Math.min(...positions.map((point) => point.x));
      const minY = Math.min(...positions.map((point) => point.y));
      const maxX = Math.max(...positions.map((point) => point.x));
      const spread = maxX - minX + 250;
      const rail = isMobile ? 48 : 224;
      const zoom = Math.min(
        isMobile ? 0.62 : 0.8,
        (window.innerWidth - rail - 16) / spread
      );
      rf.setViewport(
        {
          x: (isMobile ? 8 : 32) - minX * zoom,
          y: (isMobile ? 170 : 200) - minY * zoom,
          zoom,
        },
        { duration: 450 }
      );
    },
    [isMobile, rf]
  );
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
  }, [searchParams]);

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
  }, [mapId, fixtureMode]);

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
    [mapId, readOnly, setNodes, setEdges, fixtureMode]
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

  const updateStrategyPlan = useCallback(
    (plan: AccountStrategyPlan) => {
      if (readOnly || !metaRef.current) return;
      const nextMeta = { ...metaRef.current, strategy: plan };
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      markDirty(nodes, edges);
    },
    [edges, markDirty, nodes, readOnly]
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
    [setNodes, setEdges, markDirty]
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
    [setEdges, markDirty, recordHistory]
  );

  const selected = nodes.find((n) => n.id === selectedId)?.data.person ?? null;
  const people = useMemo(() => nodes.map((n) => n.data.person), [nodes]);
  const bigMap = isBigMap(people.length);
  useEffect(() => {
    if (loaded && isMobile && bigMap && !viewModeTouched) {
      setViewMode('roster');
    }
  }, [loaded, isMobile, bigMap, viewModeTouched]);
  const managerOf = useMemo(() => {
    const nameById = new Map(people.map((person) => [person.id, person.name]));
    const map = new Map<string, string>();
    for (const edge of edges) {
      if (edge.data?.kind !== 'reports') continue;
      const manager = nameById.get(edge.source);
      if (manager && !map.has(edge.target)) map.set(edge.target, manager);
    }
    return map;
  }, [people, edges]);

  // Progressive disclosure for large accounts: each lane shows its most
  // senior people plus a "+N more" tile; expanding reveals the full bench.
  // All of it is derived at render time — expansion state, packed positions,
  // headers, and tiles never enter MapState, undo history, or saved maps.
  const [expandedLanes, setExpandedLanes] = useState<Set<string>>(new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [showAllLanes, setShowAllLanes] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [laneGrouping, setLaneGrouping] = useState<LaneGrouping>('department');
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
        style: { width: 250, height: 96 },
        width: 250,
        height: 96,
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

  const knownSourceUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const p of people) {
      for (const url of p.sources ?? []) if (url) urls.add(url);
      for (const s of p.sourceDetails ?? []) if (s.url) urls.add(s.url);
    }
    for (const initiative of meta?.initiatives ?? []) {
      for (const url of initiative.evidence ?? []) if (url) urls.add(url);
      for (const s of initiative.evidenceDetails ?? []) if (s.url) urls.add(s.url);
    }
    return Array.from(urls).slice(0, 96);
  }, [people, meta]);

  const coverage = useMemo(() => {
    const counts = new Map<BuyingRole, number>();
    for (const p of people) {
      if (p.role === 'none') continue;
      counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
    }
    return counts;
  }, [people]);
  const committeeCovered = COMMITTEE_ROLES.filter(
    (r) => (coverage.get(r) ?? 0) > 0
  ).length;

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
  const personaById = useMemo(
    () => new Map<string, Persona>(personas.map((p) => [p.id, p])),
    [personas]
  );

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
    [setNodes, markDirty, recordHistory, laneGrouping, relayLanes]
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
    [setEdges, markDirty, recordHistory]
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
    [setEdges, markDirty, recordHistory]
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
  }, [rf, nodes, setNodes, markDirty, recordHistory]);

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
    [setNodes, laneOf]
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
    [personaById, people, nodes, rf, laneOf, focusPeople]
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
    [setNodes, setEdges, markDirty, recordHistory]
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
      nodes,
      edges,
      setNodes,
      markDirty,
      rf,
      recordHistory,
      anchorTopLeft,
      isMobile,
    ]
  );

  const handleSuggestedApplied = useCallback(
    (updatedMap: LoadedMap) => {
      handleRosterMapUpdated(updatedMap);
      setShowSuggest(false);
      window.setTimeout(() => autoLayout(laneGrouping), 0);
      if (mapId) {
        void api
          .getRoster(mapId, { pageSize: 1 })
          .then(({ counts }) => setRosterCounts(counts))
          .catch(() => undefined);
      }
    },
    [autoLayout, handleRosterMapUpdated, laneGrouping, mapId]
  );

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

  const selectedNodes = useMemo(
    () => nodes.filter((node) => node.selected),
    [nodes]
  );

  const alignTop = useCallback(() => {
    if (selectedNodes.length < 2) return;
    recordHistory();
    const y = Math.min(...selectedNodes.map((node) => node.position.y));
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const next = nodesRef.current.map((node) =>
      selectedIds.has(node.id)
        ? { ...node, position: { ...node.position, y } }
        : node
    );
    nodesRef.current = next;
    setNodes(next);
    markDirty(next, edgesRef.current);
  }, [selectedNodes, recordHistory, setNodes, markDirty]);

  const assignRole = useCallback(
    (role: BuyingRole) => {
      if (selectedNodes.length === 0) return;
      recordHistory();
      const selectedIds = new Set(selectedNodes.map((node) => node.id));
      const next = nodesRef.current.map((node) =>
        selectedIds.has(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                person: { ...node.data.person, role },
              },
            }
          : node
      );
      nodesRef.current = next;
      setNodes(next);
      markDirty(next, edgesRef.current);
    },
    [selectedNodes, recordHistory, setNodes, markDirty]
  );

  const deleteSelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    recordHistory();
    const ids = new Set(selectedNodes.map((node) => node.id));
    const nextNodes = nodesRef.current.filter((node) => !ids.has(node.id));
    const nextEdges = edgesRef.current.filter(
      (edge) => !ids.has(edge.source) && !ids.has(edge.target)
    );
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    markDirty(nextNodes, nextEdges);
    setSelectedId(null);
  }, [selectedNodes, recordHistory, setNodes, setEdges, markDirty]);

  const distributeHorizontally = useCallback(() => {
    if (selectedNodes.length < 3) return;
    const ordered = [...selectedNodes].sort(
      (a, b) => a.position.x - b.position.x
    );
    const first = ordered[0].position.x;
    const last = ordered[ordered.length - 1].position.x;
    const step = (last - first) / (ordered.length - 1);
    const xById = new Map(
      ordered.map((node, index) => [node.id, first + step * index])
    );
    recordHistory();
    const next = nodesRef.current.map((node) => {
      const x = xById.get(node.id);
      return x === undefined
        ? node
        : { ...node, position: { ...node.position, x } };
    });
    nodesRef.current = next;
    setNodes(next);
    markDirty(next, edgesRef.current);
  }, [selectedNodes, recordHistory, setNodes, markDirty]);

  const groupSelection = useCallback(() => {
    if (selectedNodes.length < 2) return;
    recordHistory();
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const groupId = crypto.randomUUID();
    const next = nodesRef.current.map((node) =>
      selectedIds.has(node.id)
        ? {
            ...node,
            data: {
              ...node.data,
              person: { ...node.data.person, groupId },
            },
          }
        : node
    );
    nodesRef.current = next;
    setNodes(next);
    markDirty(next, edgesRef.current);
  }, [selectedNodes, recordHistory, setNodes, markDirty]);

  const ungroupSelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    recordHistory();
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const next = nodesRef.current.map((node) =>
      selectedIds.has(node.id)
        ? {
            ...node,
            data: {
              ...node.data,
              person: { ...node.data.person, groupId: undefined },
            },
          }
        : node
    );
    nodesRef.current = next;
    setNodes(next);
    markDirty(next, edgesRef.current);
  }, [selectedNodes, recordHistory, setNodes, markDirty]);

  const semanticGroup = useCallback(
    (
      field: AgentGroupingField,
      scope: 'map' | 'selection',
      explicitIds?: Set<string>
    ) => {
      const ids =
        explicitIds && explicitIds.size > 0
          ? explicitIds
          : new Set(
              scope === 'selection'
                ? selectedNodes.map((node) => node.id)
                : nodes.map((node) => node.id)
            );
      if (ids.size === 0) return 'There are no people to group yet.';
      recordHistory();
      const sorted = nodes
        .filter((node) => ids.has(node.id))
        .sort(
          (a, b) =>
            a.position.y - b.position.y || a.position.x - b.position.x
        );
      const clusters = new Map<string, Node<PersonNodeData>[]>();
      for (const node of sorted) {
        const person = node.data.person;
        const value =
          field === 'businessUnit'
            ? person.department
            : (person[field] ?? person.department);
        const key = value ?? 'Unassigned';
        clusters.set(key, [...(clusters.get(key) ?? []), node]);
      }
      const groupIds = new Map<string, string>();
      const positions = new Map<string, { x: number; y: number }>();
      let column = 0;
      for (const [name, members] of clusters) {
        const groupId = crypto.randomUUID();
        groupIds.set(name, groupId);
        const positionsByGroup = members.map((member) => ({
          ...member.data.person,
          x: 0,
          y: 0,
        }));
        const scopedEdges = edges
          .map(edgeToMap)
          .filter(
            (edge) =>
              ids.has(edge.from) &&
              ids.has(edge.to) &&
              members.some((member) => member.id === edge.from) &&
              members.some((member) => member.id === edge.to)
          );
        const laid = applyLayout(positionsByGroup, scopedEdges);
        const baseX = column * 1_380;
        laid.forEach((person) =>
          positions.set(person.id, { x: baseX + person.x, y: person.y })
        );
        column += 1;
      }
      const next = nodesRef.current.map((node) => {
        if (!ids.has(node.id)) return node;
        const person = node.data.person;
        const key =
          (field === 'businessUnit'
            ? person.department
            : (person[field] ?? person.department)) ?? 'Unassigned';
        return {
          ...node,
          selected: true,
          position: positions.get(node.id) ?? node.position,
          data: {
            ...node.data,
            person: { ...person, groupId: groupIds.get(key) },
          },
        };
      });
      nodesRef.current = next;
      setNodes(next);
      markDirty(next, edgesRef.current);
      setSelectedId(null);
      window.setTimeout(
        () => void rf.fitView({ padding: 0.22, duration: 450 }),
        50
      );
      return `Grouped ${ids.size} people into ${clusters.size} ${clusters.size === 1 ? 'lane' : 'lanes'}.`;
    },
    [nodes, selectedNodes, edges, recordHistory, setNodes, markDirty, rf]
  );

  const setRelationshipView = useCallback(
    (view: AgentRelationshipView) => {
      recordHistory();
      const next = edgesRef.current.map((edge) => ({
        ...edge,
        hidden:
          view === 'all' ? false : (edge.data?.kind ?? 'reports') !== view,
      }));
      edgesRef.current = next;
      setEdges(next);
      markDirty(nodesRef.current, next);
      return view === 'all'
        ? 'Showing all relationships.'
        : view === 'reports'
          ? 'Showing reporting relationships only.'
          : 'Showing influence relationships only.';
    },
    [recordHistory, setEdges, markDirty]
  );

  const previewGroup = useCallback(
    (
      field: AgentGroupingField,
      scope: 'map' | 'selection',
      explicitIds?: Set<string>
    ) => {
      const scopedPeople =
        explicitIds && explicitIds.size > 0
          ? people.filter((person) => explicitIds.has(person.id))
          : scope === 'selection'
            ? selectedNodes.map((node) => node.data.person)
            : people;
      return describeGrouping(scopedPeople, field, scope, () =>
        semanticGroup(field, scope, explicitIds)
      );
    },
    [people, selectedNodes, semanticGroup]
  );

  const copySelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    clipboard.current = snapshot(
      selectedNodes,
      edges.filter(
        (edge) =>
          selectedIds.has(edge.source) && selectedIds.has(edge.target)
      )
    );
  }, [selectedNodes, edges]);

  const pasteSelection = useCallback(() => {
    if (readOnly || !clipboard.current) return;
    recordHistory();
    const ids = new Map<string, string>();
    for (const node of clipboard.current.nodes) {
      ids.set(node.id, crypto.randomUUID());
    }
    const pastedNodes = clipboard.current.nodes.map((node) => {
      const id = ids.get(node.id)!;
      return {
        ...node,
        id,
        selected: true,
        position: { x: node.position.x + 32, y: node.position.y + 32 },
        data: {
          person: {
            ...node.data.person,
            id,
            x: node.position.x + 32,
            y: node.position.y + 32,
          },
        },
      };
    });
    const pastedEdges = clipboard.current.edges.map((edge) => ({
      ...edge,
      id: crypto.randomUUID(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
      selected: false,
    }));
    const next = [
      ...nodesRef.current.map((node) => ({ ...node, selected: false })),
      ...pastedNodes,
    ];
    const nextEdges = [
      ...edgesRef.current.map((edge) => ({ ...edge, selected: false })),
      ...pastedEdges,
    ];
    nodesRef.current = next;
    edgesRef.current = nextEdges;
    setNodes(next);
    setEdges(nextEdges);
    markDirty(next, nextEdges);
    clipboard.current = snapshot(pastedNodes, pastedEdges);
  }, [
    readOnly,
    recordHistory,
    setNodes,
    setEdges,
    markDirty,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommands(true);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (command && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, copySelection, pasteSelection]);

  // Escape closes the topmost open surface — every modal and the person panel.
  useEffect(() => {
    const closers: [boolean, () => void][] = [
      [showFeedback, () => setShowFeedback(false)],
      [showDeepResearch, () => setShowDeepResearch(false)],
      [showMeetings, () => setShowMeetings(false)],
      [showShare, () => setShowShare(false)],
      [showHistory, () => setShowHistory(false)],
      [showInitiatives, () => setShowInitiatives(false)],
      [showStrategy, () => setShowStrategy(false)],
      [showBriefing, () => setShowBriefing(false)],
      [showChanges, () => setShowChanges(false)],
      [committeeOpen, () => setCommitteeOpen(false)],
      [selectedId !== null, () => setSelectedId(null)],
    ];
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const [open, close] of closers) {
        if (open) {
          close();
          return;
        }
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    showFeedback,
    showDeepResearch,
    showMeetings,
    showShare,
    showHistory,
    showInitiatives,
    showStrategy,
    showBriefing,
    showChanges,
    committeeOpen,
    selectedId,
  ]);

  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      if (action === 'layout') autoLayout();
      if (action === 'briefing') {
        setBriefingEntry('spotlight');
        setShowBriefing(true);
      }
      if (action === 'overview') {
        setSelectedId(null);
        void rf.fitView({ padding: 0.2, duration: 450 });
      }
      if (action === 'strategy') setShowStrategy(true);
      if (action === 'changes') setShowChanges(true);
      if (action === 'initiatives') setShowInitiatives(true);
      if (action === 'share') setShowShare(true);
    },
    [autoLayout, rf]
  );

  const runAgentCommand = useCallback(
    (raw: string): AgentCommandResult | null => {
      const say = (message: string): AgentCommandResult => ({ message });
      const query = raw.trim();
      const lower = query.toLowerCase();
      if (!query) return say('I couldn’t find a command to run.');

      // Lane re-arrangement by team or met-status — map-wide phrasing goes to
      // the lane layout; selection-scoped phrasing stays on preview grouping.
      const laneVerb =
        /\b(arrange|organize|organise|separate|split|divide|layout|tidy|bucket|break|group)\b/.test(
          lower
        );
      const wantsMetLanes =
        (laneVerb || /\b(show|view|filter|who)\b/.test(lower)) &&
        /\b(met|unmet)\b/.test(lower);
      const wantsTeamLanes = laneVerb && /\bteams?\b/.test(lower);
      if (
        (wantsTeamLanes || wantsMetLanes) &&
        !/\b(this|these|selected|selection)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        autoLayout(wantsMetLanes ? 'met' : 'team');
        return say(
          wantsMetLanes
            ? 'I split the map into Met with and Haven’t met lanes by team.'
            : 'I arranged the org chart into team lanes.'
        );
      }

      const groupField: AgentGroupingField = /\bproduct/.test(lower)
        ? 'productLine'
        : /\b(team|sub-?team)s?\b/.test(lower)
          ? 'team'
          : 'businessUnit';
      const wantsGrouping =
        /\b(split|group|cluster|reorganize|reorganise|break|divide|organize|organise|arrange|sort|bucket)\b/.test(
          lower
        ) &&
        (/\b(by|into|using)\s+(department|departments|function|functions|business units?|teams?|sub-?teams?|products?|product lines?|orgs?|org chart)\b/.test(
          lower
        ) ||
          /\b(group|teams?|products?|business units?|departments?|functions?|lanes?)\b/.test(
            lower
          ));
      if (wantsGrouping) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const selectionIds = new Set(
          /\b(this|these|selected|selection|current group)\b/.test(lower)
            ? selectedNodes.map((node) => node.id)
            : []
        );
        const selectedGroup = selectedId
          ? nodes.find(
              (node) =>
                node.id === selectedId && Boolean(node.data.person.groupId)
            )?.data.person.groupId
          : undefined;
        if (selectedGroup && /\b(this|these|selected|selection|current group)\b/.test(lower)) {
          nodes.forEach((node) => {
            if (node.data.person.groupId === selectedGroup) {
              selectionIds.add(node.id);
            }
          });
        }
        const scope = selectionIds.size > 0 ? 'selection' : 'map';
        return previewGroup(groupField, scope, selectionIds);
      }
      if (
        /\b(show|display|filter|view|use|switch to)\b/.test(lower) &&
        /\b(influence|influences|reporting|reports|hierarchy|managerial|all relationships)\b/.test(lower)
      ) {
        const view: AgentRelationshipView = /influence/.test(lower)
          ? 'influence'
          : /all/.test(lower)
            ? 'all'
            : 'reports';
        return describeRelationshipView(view, () => setRelationshipView(view));
      }
      if (/(arrange|organize|layout|tidy)/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const hierarchy = /\b(reporting|reports|hierarchy|tree|manager)\b/.test(
          lower
        );
        autoLayout(hierarchy ? 'hierarchy' : 'department');
        return say(
          hierarchy
            ? 'I arranged the org chart by reporting line.'
            : 'I arranged the org chart into department lanes.'
        );
      }
      if (
        /\b(overview|show all|whole (account|map|chart|canvas|org)|zoom out|one view|single view|see (everyone|everything|the whole)|fit)\b/.test(
          lower
        )
      ) {
        setSelectedId(null);
        setShowAllLanes(true);
        setExpandedLanes(new Set());
        setCollapsedLanes(new Set());
        window.setTimeout(
          () => void rf.fitView({ padding: 0.2, duration: 450 }),
          80
        );
        return say('Showing the whole account.');
      }
      if (/\b(research|enrich|find more people)\b/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        setDeepResearchFocus(
          query
            .replace(/\b(deep research|research|enrich|find more people)\b/gi, '')
            .replace(/\b(for|about|on|in)\b/gi, '')
            .trim()
        );
        setShowDeepResearch(true);
        return say('Opening targeted deep research.');
      }
      if (
        /\b(brief me|daily brief|account pulse|next best action|what should i do|what matters now)\b/.test(
          lower
        )
      ) {
        setBriefingEntry('spotlight');
        setShowBriefing(true);
        return say('Opening the account briefing.');
      }
      if (
        /\b(build|open|show|create|generate|view)\b.*\b(account brief|relationship path|deal plan|account strategy|path in)\b/.test(
          lower
        ) ||
        /^(account brief|relationship path|deal plan|account strategy)$/.test(lower)
      ) {
        setShowStrategy(true);
        return say('Opening the account strategy.');
      }
      if (
        /\b(what changed|show changes|show account changes|change alerts?|account movement)\b/.test(
          lower
        )
      ) {
        setShowChanges(true);
        return say('Opening account change alerts.');
      }
      if (
        /\b(open|show|view|review)\b.*\b(initiative|strategic priorities|why now)\b/.test(
          lower
        ) ||
        lower === 'why now'
      ) {
        setShowInitiatives(true);
        return say('Opening initiative intelligence.');
      }
      if (/\bshare\b/.test(lower)) {
        setShowShare(true);
        return say('Opening sharing controls.');
      }

      const matchedPeople = [...people]
        .sort((a, b) => b.name.length - a.name.length)
        .filter((person) => lower.includes(person.name.toLowerCase()));
      const matchedPerson = matchedPeople[0];

      if (lower.includes('reports to') && matchedPeople.length >= 2) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const divider = lower.indexOf('reports to');
        const subordinate = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) < divider
        );
        const manager = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) > divider
        );
        if (subordinate && manager) {
          return describeRelationship(manager, subordinate, 'reports', false, () => {
            setManager(subordinate.id, manager.id);
            focusPeople([subordinate, manager]);
            return `${subordinate.name} now reports to ${manager.name}.`;
          });
        }
      }

      if (matchedPeople.length >= 2 && /\binfluences?\b/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const divider = lower.search(/\binfluences?\b/);
        const from = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) < divider
        );
        const to = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) > divider
        );
        if (from && to) {
          return describeRelationship(from, to, 'influence', false, () => {
            addInfluence(from.id, to.id, 'influences');
            focusPeople([from, to]);
            return `Added an influence link from ${from.name} to ${to.name}.`;
          });
        }
      }

      const roles: { terms: string[]; role: BuyingRole; label: string }[] = [
        { terms: ['economic buyer', 'budget owner'], role: 'economic_buyer', label: 'economic buyer' },
        { terms: ['decision maker'], role: 'decision_maker', label: 'decision maker' },
        { terms: ['technical buyer'], role: 'technical_buyer', label: 'technical buyer' },
        { terms: ['champion'], role: 'champion', label: 'champion' },
        { terms: ['influencer'], role: 'influencer', label: 'influencer' },
        { terms: ['blocker'], role: 'blocker', label: 'blocker' },
      ];
      const matchedRole = roles.find(({ terms }) =>
        terms.some((term) => lower.includes(term))
      );
      if (
        matchedPerson &&
        matchedRole &&
        /\b(make|mark|set|assign)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        return describePersonEdit(
          matchedPerson,
          [{ label: 'buying role', value: matchedRole.label }],
          () => {
            updatePerson({ ...matchedPerson, role: matchedRole.role });
            focusPeople([matchedPerson]);
            return `${matchedPerson.name} is now marked as ${matchedRole.label}.`;
          }
        );
      }

      const titleMatch = query.match(/\btitle\s+to\s+(.+)$/i);
      if (
        matchedPerson &&
        titleMatch &&
        /\b(set|change|update)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const title = titleMatch[1].trim();
        return describePersonEdit(
          matchedPerson,
          [{ label: 'title', value: title }],
          () => {
            updatePerson({ ...matchedPerson, title });
            focusPeople([matchedPerson]);
            return `Updated ${matchedPerson.name}’s title to ${title}.`;
          }
        );
      }

      const teamMove = lower.match(
        /^(?:move|put) .+? (?:to|on|in) (?:the )?(.+?)(?: team)?$/
      );
      if (matchedPerson && teamMove) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const team = query
          .slice(query.toLowerCase().lastIndexOf(teamMove[1]))
          .replace(/\s+team$/i, '');
        return describePersonEdit(
          matchedPerson,
          [{ label: 'team', value: team, inferred: true }],
          () => {
            updatePerson({
              ...matchedPerson,
              team,
              teamEvidence: 'inferred',
            });
            focusPeople([matchedPerson]);
            return `Moved ${matchedPerson.name} to the ${team} team as an inferred assignment.`;
          }
        );
      }

      const addMatch = query.match(
        /^(?:add|create)\s+(.+?)(?:\s+(?:as|,)\s+(.+))?$/i
      );
      if (addMatch) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const name = addMatch[1].trim();
        const title = addMatch[2]?.trim() ?? '';
        addPerson({ name, title });
        return say(`Added ${name}${title ? ` as ${title}` : ''}.`);
      }

      if (matchedPerson) {
        focusPeople([matchedPerson]);
        return say(`Found ${matchedPerson.name}.`);
      }

      const searchQuery = lower
        .replace(
          /\b(show|find|open|focus|take me to|filter|people|person|everyone|everybody|folks|members?|anyone|the|a|an|teams?|departments?|products?|in|of|to|for|me|my|all|any|from|with|at|on|by|who|whom|is|are|list|display|view|only|into|working|work|us|now|please|and|or)\b/g,
          ' '
        )
        .trim();
      const matches = people.filter((person) => {
        const text = [
          person.name,
          person.title,
          person.department,
          person.team,
          person.productLine,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return matchesAllTokens(text, searchQuery);
      });
      if (matches.length > 0) {
        focusPeople(matches);
        return say(
          `Found ${matches.length} ${matches.length === 1 ? 'person' : 'people'}.`
        );
      }

      return null;
    },
    [
      people,
      readOnly,
      autoLayout,
      rf,
      updatePerson,
      focusPeople,
      addPerson,
      setManager,
      addInfluence,
      selectedId,
      selectedNodes,
      nodes,
      previewGroup,
      setRelationshipView,
    ]
  );

  const runAccountAgentAction = useCallback(
    (action: AccountAgentAction) => {
      if (action.type === 'focus_people') {
        const matches = people.filter((person) =>
          action.personIds?.includes(person.id)
        );
        if (matches.length > 0) focusPeople(matches);
      }
      if (action.type === 'open_strategy') setShowStrategy(true);
      if (action.type === 'open_initiatives') setShowInitiatives(true);
      if (action.type === 'deep_research' && !readOnly) {
        setDeepResearchFocus(action.focus ?? '');
        setShowDeepResearch(true);
      }
    },
    [focusPeople, people, readOnly]
  );

  const exportPng = useCallback(async () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement;
    // displayNodes is exactly what's rendered: packed collapsed lanes,
    // lane headers, +N tiles, and the active grouping — so the PNG is 1:1
    // with the canvas instead of the raw saved positions.
    if (!el || displayNodes.length === 0) return;
    try {
      const bounds = getNodesBounds(displayNodes);
      const plan = planPngExport(bounds);
      const flow = document.querySelector('.react-flow') as HTMLElement | null;
      if (plan.mode === 'viewport') {
        if (!flow) return;
        const current = rf.getViewport();
        const width = flow.clientWidth;
        const height = flow.clientHeight;
        const url = await toPng(el, {
          backgroundColor: '#f8fafc',
          width,
          height,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${current.x}px, ${current.y}px) scale(${current.zoom})`,
          },
        });
        const a = document.createElement('a');
        a.href = url;
        a.download = `${mapName || 'org-map'}.png`;
        a.click();
        setImportNotice(plan.reason);
        window.setTimeout(() => setImportNotice(''), 5_000);
        return;
      }
      const vp = getViewportForBounds(
        bounds,
        plan.width,
        plan.height,
        plan.zoom,
        plan.zoom,
        0.08
      );
      const url = await toPng(el, {
        backgroundColor: '#f8fafc',
        width: plan.width,
        height: plan.height,
        style: {
          width: `${plan.width}px`,
          height: `${plan.height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${plan.zoom})`,
        },
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mapName || 'org-map'}.png`;
      a.click();
      if (plan.zoom < 0.6) {
        setImportNotice(
          `Large map — exported at ${Math.round(plan.zoom * 100)}% scale`
        );
        window.setTimeout(() => setImportNotice(''), 5_000);
      }
    } catch {
      setImportNotice('PNG export failed — try again.');
      window.setTimeout(() => setImportNotice(''), 5_000);
    }
  }, [displayNodes, mapName, rf]);

  const saveName = useCallback(() => {
    if (!mapId || readOnly || fixtureMode) return;
    void api.patchMap(mapId, { name: mapName }).catch(() => {
      saveStateRef.current = 'dirty';
      setSaveState('dirty');
    });
  }, [mapId, mapName, readOnly, fixtureMode]);

  const importCrmCsv = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || readOnly) return;
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        setImportNotice('No CRM contacts found in that CSV.');
        return;
      }
      recordHistory();
      let updated = 0;
      let added = 0;
      let skipped = 0;
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const pick = (
        row: Record<string, string>,
        ...keys: string[]
      ): string => {
        for (const key of keys) {
          const value = row[key]?.trim();
          if (value) return value;
        }
        return '';
      };
      const items = nodesRef.current;
      const next = [...items];
      const baseX = items.length
        ? Math.min(...items.map((n) => n.position.x))
        : center.x;
      const baseY = items.length
        ? Math.max(...items.map((n) => n.position.y)) + 240
        : center.y;
      for (const row of rows) {
        const name =
          pick(
            row,
            'name',
            'fullname',
            'contactname',
            'contact',
            'employeename',
            'person',
            'displayname'
          ) ||
          [
            pick(row, 'firstname', 'givenname'),
            pick(row, 'lastname', 'surname', 'familyname'),
          ]
            .filter(Boolean)
            .join(' ');
        const email = pick(row, 'email', 'emailaddress', 'mail');
        if (!name && !email) {
          skipped += 1;
          continue;
        }

        const title = pick(
          row,
          'title',
          'jobtitle',
          'position',
          'role',
          'jobrole',
          'designation'
        );
        const department = pick(
          row,
          'department',
          'dept',
          'function',
          'division',
          'businessunit',
          'bu'
        );
        const team = pick(row, 'team', 'subteam', 'squad');
        const productLine = pick(row, 'productline', 'product', 'segment');
        const linkedin = pick(
          row,
          'linkedin',
          'linkedinurl',
          'linkedinprofile',
          'profile',
          'url'
        );
        const notes = pick(row, 'notes', 'note', 'comments', 'description');
        const matchIndex = next.findIndex((node) => {
          const person = node.data.person;
          return (
            (!!email &&
              !!person.email &&
              person.email.toLowerCase() === email.toLowerCase()) ||
            (!!name && person.name.toLowerCase() === name.toLowerCase())
          );
        });
        const enrichment = {
          ...(title ? { title } : {}),
          ...(department ? { department } : {}),
          ...(team ? { team, teamEvidence: 'sourced' as const } : {}),
          ...(productLine ? { productLine } : {}),
          ...(email ? { email } : {}),
          ...(linkedin ? { linkedin } : {}),
        };
        if (matchIndex >= 0) {
          const node = next[matchIndex];
          const person = node.data.person;
          next[matchIndex] = {
            ...node,
            data: {
              ...node.data,
              person: {
                ...person,
                ...enrichment,
                notes: [person.notes, notes].filter(Boolean).join('\n'),
                sources: Array.from(new Set([...(person.sources ?? []), 'CRM CSV'])),
              },
            },
          };
          updated += 1;
          continue;
        }
        const x = baseX + (added % 6) * 300;
        const y = baseY + Math.floor(added / 6) * 260;
        const person: Person = {
          id: crypto.randomUUID(),
          name: name || email,
          title: title || 'CRM contact',
          department: department || null,
          team: team || null,
          productLine: productLine || null,
          teamEvidence: team ? 'sourced' : null,
          role: 'none',
          confidence: 'high',
          sources: ['CRM CSV'],
          researchStatus: 'verified',
          notes,
          email: email || null,
          linkedin: linkedin || null,
          x,
          y,
        };
        next.push({
          id: person.id,
          type: 'person',
          position: { x, y },
          data: { person, readOnly: false },
          style: { width: 250 },
        });
        added += 1;
      }
      const finalNodes =
        added > 0 || lanesChanged(items, next) ? relayLanes(next) : next;
      nodesRef.current = finalNodes;
      setNodes(finalNodes);
      markDirty(finalNodes, edgesRef.current);
      setImportNotice(
        updated + added === 0
          ? 'No usable contacts — the CSV needs a Name or Email column.'
          : `CRM import: ${updated} enriched, ${added} added${skipped ? `, ${skipped} skipped` : ''}.`
      );
      window.setTimeout(() => setImportNotice(''), 5_000);
    },
    [readOnly, recordHistory, rf, setNodes, markDirty, relayLanes, lanesChanged]
  );

  const mergeResearch = useCallback(
    (result: ResearchResult) => {
      if (readOnly) return { added: 0, enriched: 0 };
      recordHistory();
      const dead = new Set(result.deadSources ?? []);
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const normalizeName = canonicalPersonName;
      const nextNodes = [...nodes];
      let added = 0;
      let enriched = 0;
      const bounds =
        nextNodes.length > 0
          ? {
              minX: Math.min(...nextNodes.map((n) => n.position.x)),
              maxY: Math.max(...nextNodes.map((n) => n.position.y)),
            }
          : null;
      const gridX = bounds ? bounds.minX : center.x;
      const gridY = bounds ? bounds.maxY + 240 : center.y;

      for (const researched of result.people) {
        const matchIndex = nextNodes.findIndex(
          (node) =>
            normalizeName(node.data.person.name) ===
            normalizeName(researched.name)
        );
        if (matchIndex >= 0) {
          const node = nextNodes[matchIndex];
          const person = node.data.person;
          const mergedSourceDetails = Array.from(
            new Map(
              [
                ...(person.sourceDetails ?? []),
                ...researched.sourceDetails,
              ].map((source) => [source.url, source])
            ).values()
          ).filter((s) => !dead.has(s.url));
          const mergedFreshness =
            mergedSourceDetails.length > 0
              ? evidenceFreshness(mergedSourceDetails)
              : researched.freshness;
          nextNodes[matchIndex] = {
            ...node,
            data: {
              ...node.data,
              person: {
                ...person,
                title:
                  !person.title || (person.sources ?? []).length === 0
                    ? researched.title
                    : person.title,
                department: person.department ?? researched.department,
                team: person.team ?? researched.team,
                productLine: person.productLine ?? researched.productLine,
                teamEvidence:
                  person.teamEvidence ?? researched.teamEvidence,
                confidence: researched.confidence,
                sources: Array.from(
                  new Set([
                    ...(person.sources ?? []),
                    ...(researched.sources ?? []),
                    ...(researched.source ? [researched.source] : []),
                  ])
                ).filter((url) => !dead.has(url)),
                sourceDetails: mergedSourceDetails,
                freshness: mergedFreshness,
                corroborationCount:
                  mergedSourceDetails.length > 0
                    ? corroborationCount(mergedSourceDetails)
                    : researched.corroborationCount,
                lastVerifiedAt: researched.lastVerifiedAt,
                conflictingTitles: Array.from(
                  new Set([
                    ...(person.conflictingTitles ?? []),
                    ...researched.conflictingTitles,
                  ])
                ),
                researchStatus:
                  mergedFreshness === 'stale' &&
                  researched.researchStatus === 'verified'
                    ? 'possibly_stale'
                    : researched.researchStatus,
              },
            },
          };
          enriched += 1;
          continue;
        }

        const person: Person = {
          id: crypto.randomUUID(),
          name: researched.name,
          title: researched.title,
          department: researched.department,
          team: researched.team,
          productLine: researched.productLine,
          teamEvidence: researched.teamEvidence,
          role: 'none',
          confidence: researched.confidence,
          sources:
            (researched.sources ?? []).length > 0
              ? (researched.sources ?? [])
              : researched.source
                ? [researched.source]
                : [],
          sourceDetails: researched.sourceDetails,
          freshness: researched.freshness,
          corroborationCount: researched.corroborationCount,
          lastVerifiedAt: researched.lastVerifiedAt,
          conflictingTitles: researched.conflictingTitles,
          researchStatus: researched.researchStatus,
          notes: '',
          email: null,
          linkedin: null,
          x: gridX + (added % 3) * 280,
          y: gridY + Math.floor(added / 3) * 180,
        };
        nextNodes.push({
          id: person.id,
          type: 'person',
          position: { x: person.x, y: person.y },
          data: { person, readOnly: false },
          style: { width: 250 },
        });
        added += 1;
      }

      const idByName = new Map(
        nextNodes.map((node) => [
          normalizeName(node.data.person.name),
          node.id,
        ])
      );
      const nextEdges = [...edges];
      for (const researched of result.people) {
        if (!researched.reportsToName) continue;
        const from = idByName.get(normalizeName(researched.reportsToName));
        const to = idByName.get(normalizeName(researched.name));
        if (
          !from ||
          !to ||
          from === to ||
          nextEdges.some(
            (edge) => edge.data?.kind === 'reports' && edge.target === to
          )
        ) {
          continue;
        }
        nextEdges.push(reportsEdge(from, to));
      }

      const nextMeta = meta
        ? {
            ...meta,
            researchedAt: new Date().toISOString(),
            provider: result.provider,
            refreshCadence: meta.refreshCadence ?? 'weekly',
            nextRefreshAt: new Date(
              Date.now() +
                (meta.refreshCadence === 'monthly' ? 30 : 7) * 86_400_000
            ).toISOString(),
            initiatives: (
              result.initiatives.length > 0
                ? result.initiatives
                : (meta.initiatives ?? [])
            ).map((initiative) => ({
              ...initiative,
              evidence: (initiative.evidence ?? []).filter(
                (url) => !dead.has(url)
              ),
              evidenceDetails: (initiative.evidenceDetails ?? []).filter(
                (source) => !dead.has(source.url)
              ),
            })),
          }
        : meta;
      // Drop stored citations the server verified as dead, then recompute the
      // displayed provenance for every card — including ones this pass did not
      // return — and clamp evidence labels on people left with no sources.
      for (let i = 0; i < nextNodes.length; i++) {
        const person = nextNodes[i].data.person;
        const sourceDetails = (person.sourceDetails ?? []).filter(
          (s) => !dead.has(s.url)
        );
        const sources = (person.sources ?? []).filter((url) => !dead.has(url));
        const removed =
          sourceDetails.length !== (person.sourceDetails?.length ?? 0) ||
          sources.length !== (person.sources ?? []).length;
        const needsClamp =
          sources.length === 0 &&
          (person.researchStatus === 'verified' ||
            person.confidence === 'high' ||
            person.teamEvidence === 'sourced');
        if (!removed && !needsClamp) continue;
        const freshness = evidenceFreshness(sourceDetails);
        nextNodes[i] = {
          ...nextNodes[i],
          data: {
            ...nextNodes[i].data,
            person: {
              ...person,
              sources,
              sourceDetails,
              freshness,
              corroborationCount: corroborationCount(sourceDetails),
              lastVerifiedAt:
                sources.length > 0 ? new Date().toISOString() : null,
              confidence:
                person.confidence === 'high' && sources.length === 0
                  ? 'medium'
                  : person.confidence,
              teamEvidence:
                person.teamEvidence === 'sourced' && sources.length === 0
                  ? 'inferred'
                  : person.teamEvidence,
              researchStatus:
                person.researchStatus === 'conflicting'
                  ? 'conflicting'
                  : sources.length === 0 || freshness === 'stale'
                    ? 'possibly_stale'
                    : person.researchStatus,
            },
          },
        };
      }
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      const finalNodes =
        added > 0 || lanesChanged(nodes, nextNodes)
          ? relayLanes(nextNodes)
          : nextNodes;
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;
      setNodes(finalNodes);
      setEdges(nextEdges);
      markDirty(finalNodes, nextEdges);
      const addedIds = finalNodes.slice(nodes.length).map((node) => node.id);
      if (addedIds.length > 0) {
        window.setTimeout(() => {
          void rf.fitView({
            nodes: finalNodes.filter((node) => addedIds.includes(node.id)),
            padding: 0.5,
            duration: 450,
          });
        }, 50);
      }
      return { added, enriched };
    },
    [
      edges,
      markDirty,
      meta,
      nodes,
      readOnly,
      recordHistory,
      relayLanes,
      lanesChanged,
      rf,
      setEdges,
      setNodes,
    ]
  );

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
        <p>Map not found or you don&apos;t have access.</p>
        <Link to="/app" className="text-indigo-600 hover:underline">
          ← Back to maps
        </Link>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f6f7f2]">
      <nav
        aria-label="Map tools"
        className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto bg-[#101828] py-2 sm:w-56 sm:items-stretch sm:px-3"
      >
        <Link
          to="/app"
          title="Back to accounts"
          aria-label="Back to accounts"
          className="flex h-11 w-11 shrink-0 items-center justify-center gap-2.5 rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white sm:h-9 sm:w-full sm:justify-start sm:px-3"
        >
          <ArrowLeft size={17} className="shrink-0" />
          <span className="hidden truncate text-[13px] font-medium sm:block">
            Accounts
          </span>
        </Link>
        <RailSeparator />
        <RailButton
          icon={<Waypoints size={16} />}
          label={isMobile && viewMode === 'roster' ? 'Show canvas' : 'Canvas'}
          active={viewMode === 'canvas'}
          onClick={() => {
            setViewModeTouched(true);
            setViewMode('canvas');
          }}
        />
        <RailButton
          icon={<Rows3 size={16} />}
          label="Roster"
          active={viewMode === 'roster'}
          onClick={() => {
            setViewModeTouched(true);
            setViewMode('roster');
          }}
        />
        <RailButton
          icon={<Users size={16} />}
          label={
            rosterCounts === null
              ? 'Suggested'
              : `Suggested (${rosterCounts.suggested})`
          }
          active={showRoster}
          onClick={() => {
            setSelectedId(null);
            setShowSuggest(false);
            setShowRoster((value) => !value);
          }}
        />
        {!readOnly && (
          <>
            <RailSeparator />
            <RailButton
              icon={<Wand2 size={16} />}
              label="Suggest org chart"
              active={showSuggest}
              onClick={() => {
                setShowRoster(false);
                setShowSuggest((value) => !value);
              }}
            />
            <RailButton
              icon={<Sparkles size={16} />}
              label="Deep research"
              onClick={() => {
                setDeepResearchFocus('');
                setShowDeepResearch(true);
              }}
            />
            <RailButton
              icon={<Radar size={16} />}
              label="Briefing"
              onClick={() => {
                setBriefingEntry('toolbar');
                setShowBriefing(true);
              }}
            />
            <RailButton
              icon={<Compass size={16} />}
              label="Strategy"
              onClick={() => setShowStrategy(true)}
            />
            <RailButton
              icon={<UserCheck size={16} />}
              label="Meetings"
              onClick={() => setShowMeetings(true)}
            />
            <RailSeparator />
            <RailButton
              icon={<Undo2 size={16} />}
              label="Undo"
              onClick={undo}
              disabled={past.length === 0}
            />
            <RailButton
              icon={<Redo2 size={16} />}
              label="Redo"
              onClick={redo}
              disabled={future.length === 0}
            />
            <RailButton
              icon={<UserPlus size={16} />}
              label="Add person"
              onClick={() => addPerson()}
            />
            <RailButton
              icon={<LayoutGrid size={16} />}
              label="Arrange by department"
              active={laneGrouping === 'department'}
              onClick={() => autoLayout('department')}
            />
            <RailButton
              icon={<Network size={16} />}
              label="Arrange by team"
              active={laneGrouping === 'team'}
              onClick={() => autoLayout('team')}
            />
            <RailButton
              icon={<Handshake size={16} />}
              label="Met vs unmet by team"
              active={laneGrouping === 'met'}
              onClick={() => autoLayout('met')}
            />
            <RailButton
              icon={<FileUp size={16} />}
              label="Import CRM"
              onClick={() => crmInput.current?.click()}
            />
            <input
              ref={crmInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="Import CRM CSV"
              className="hidden"
              onChange={(event) => void importCrmCsv(event)}
            />
            <RailButton
              icon={<History size={16} />}
              label="History"
              onClick={openHistory}
            />
            <RailButton
              icon={<BellRing size={16} />}
              label="Changes"
              onClick={() => setShowChanges(true)}
            />
            {(meta?.initiatives?.length ?? 0) > 0 && (
              <RailButton
                icon={<Lightbulb size={16} />}
                label="Initiatives"
                onClick={() => setShowInitiatives(true)}
              />
            )}
          </>
        )}
        <RailSeparator />
        <RailButton
          icon={<Download size={16} />}
          label="Export PNG"
          onClick={() => void exportPng()}
        />
        <RailButton
          icon={<MessageSquare size={16} />}
          label="Send feedback"
          onClick={() => setShowFeedback(true)}
        />
        <div className="flex-1" />
        {!readOnly && (
          <RailButton
            icon={<Share2 size={16} />}
            label="Share"
            accent
            onClick={() => setShowShare(true)}
          />
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/85 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
          <h1 className="sr-only">{mapName || 'Account map'}</h1>
          <input
            aria-label="Map name"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-900 outline-none hover:border-slate-300 focus:border-[#5b4cf0] sm:w-56 sm:flex-none"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            onBlur={saveName}
            disabled={readOnly}
          />
          <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500 sm:inline">
            {domain}
          </span>
          {meta?.provider && (
            <span className="hidden rounded-full bg-[#c9f04b] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-950 md:inline">
              {meta.tier} · {meta.provider}
            </span>
          )}
          {meta?.researchedAt && (
            <button
              onClick={() => {
                if (readOnly) return;
                setDeepResearchFocus('');
                setShowDeepResearch(true);
              }}
              disabled={readOnly}
              title={
                meta.nextRefreshAt
                  ? `Next research check ${new Date(meta.nextRefreshAt).toLocaleDateString()}`
                  : 'Refresh research'
              }
              className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide md:inline ${
                researchDue
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {researchDue ? 'Refresh due' : 'Research current'}
            </button>
          )}
          <div className="hidden flex-1 sm:block" />
          <span
            role="status"
            className="hidden text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline"
          >
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'dirty'
                ? 'Unsaved changes'
                : 'Saved'}
          </span>
          <div className="flex -space-x-1">
            {presence.slice(0, 4).map((person) => (
              <span
                key={person.id}
                title={`${person.name} is viewing`}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#5b4cf0] text-[10px] font-semibold text-white"
              >
                {person.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            ))}
          </div>
        </header>

      <main
        id="main"
        tabIndex={-1}
        className="relative min-h-0 flex-1 bg-[#f6f7f2]"
      >
        {importNotice && (
          <div
            role="status"
            className="absolute right-3 top-3 z-40 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
          >
            {importNotice}
          </div>
        )}
        {viewMode === 'roster' ? (
          <RosterView
            people={people}
            managerOf={managerOf}
            selectedId={selectedId}
            onSelect={(person) => setSelectedId(person.id)}
            fileName={mapName || 'roster'}
          />
        ) : (
        <>
        <button
          onClick={() => setShowCommands(true)}
          className="absolute left-1/2 top-3 z-30 flex w-[calc(100%_-_7rem)] max-w-md -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-white/90 bg-white/90 px-3.5 py-2.5 text-left text-sm text-slate-500 shadow-[0_12px_40px_rgba(15,23,42,.12)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_45px_rgba(15,23,42,.16)] sm:top-4 sm:px-4"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eeecff] text-[#5b4cf0]">
            <Search size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            Search or ask TopDown
          </span>
          <Sparkles size={14} className="shrink-0 text-[#5b4cf0]" />
          <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 sm:block">
            ⌘K
          </kbd>
        </button>
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodesFocusable
          edgesFocusable
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onNodeDragStart={() => {
            if (!dragHistoryRecorded.current) {
              recordHistory();
              dragHistoryRecorded.current = true;
            }
          }}
          onNodeDragStop={() => {
            dragHistoryRecorded.current = false;
          }}
          onNodeClick={(_, n) => {
            if (n.type !== 'person') return;
            setSelectedId(n.id);
            const groupId = n.data.person.groupId;
            if (groupId) {
              const next = nodesRef.current.map((node) => ({
                ...node,
                selected: node.data.person.groupId === groupId,
              }));
              nodesRef.current = next;
              setNodes(next);
            }
          }}
          onPaneClick={() => setSelectedId(null)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const nodeEl = (event.target as HTMLElement).closest<HTMLElement>(
              '.react-flow__node'
            );
            const id = nodeEl?.dataset.id;
            if (!id || id.startsWith('lane:') || id.startsWith('more:')) return;
            const person = people.find((p) => p.id === id);
            if (!person) return;
            event.preventDefault();
            setSelectedId(id);
            if (person.groupId) {
              setNodes((items) =>
                items.map((node) => ({
                  ...node,
                  selected: node.data.person.groupId === person.groupId,
                }))
              );
            }
          }}
          onPointerMove={(event) => {
            cursorRef.current = rf.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
          }}
          nodeTypes={nodeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          selectionOnDrag={false}
          selectionKeyCode={readOnly ? null : 'Shift'}
          panOnDrag
          multiSelectionKeyCode={['Meta', 'Control']}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitView
          fitViewOptions={openingFitOptions}
          minZoom={0.2}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={28} size={1} color="#d9ddd4" />
          <Controls
            showInteractive={false}
            fitViewOptions={openingFitOptions}
            className="max-sm:!hidden !bottom-4 !left-4"
          />
          {!isMobile && !laneItems.some((node) => node.dragging) && (
            <MemoMiniMap
              pannable
              zoomable
              nodeStrokeWidth={3}
              nodeColor={bigMap ? () => '#cbd5e1' : undefined}
              maskColor={bigMap ? 'rgba(241,245,249,0.72)' : undefined}
              className="!bg-slate-50"
            />
          )}
        </ReactFlow>

        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          {presence
            .filter(
              (person) =>
                person.id !== selfId &&
                person.cursor_x !== null &&
                person.cursor_y !== null
            )
            .map((person) => (
              <div
                key={person.id}
                className="absolute transition-all duration-300"
                style={{
                  left: person.cursor_x! * viewport.zoom + viewport.x,
                  top: person.cursor_y! * viewport.zoom + viewport.y,
                }}
              >
                <div className="h-0 w-0 border-b-[10px] border-l-[6px] border-r-[6px] border-b-indigo-600 border-l-transparent border-r-transparent [transform:rotate(-35deg)]" />
                <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
                  {person.name}
                </span>
              </div>
            ))}
        </div>

        {!readOnly && selectedNodes.length > 1 && (
          <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg sm:bottom-5">
            <span className="px-2 text-xs font-medium text-slate-500">
              {selectedNodes.length} selected
            </span>
            <button
              onClick={alignTop}
              title="Align top"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            >
              <AlignStartHorizontal size={16} />
            </button>
            <button
              onClick={distributeHorizontally}
              disabled={selectedNodes.length < 3}
              title="Distribute horizontally"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:text-slate-300"
            >
              <AlignHorizontalDistributeCenter size={16} />
            </button>
            <button
              onClick={groupSelection}
              title="Group selection"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            >
              <Group size={16} />
            </button>
            <button
              onClick={ungroupSelection}
              title="Ungroup selection"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            >
              <Ungroup size={16} />
            </button>
            <button
              onClick={() => {
                copySelection();
                window.setTimeout(pasteSelection, 0);
              }}
              title="Duplicate selection"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            >
              <Copy size={16} />
            </button>
            <select
              aria-label="Assign buying role to selection"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) {
                  assignRole(event.target.value as BuyingRole);
                  event.currentTarget.value = '';
                }
              }}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 sm:min-h-0"
            >
              <option value="" disabled>
                Assign role
              </option>
              {(['none', ...COMMITTEE_ROLES] as BuyingRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_META[role].label ||
                    role.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase())}
                </option>
              ))}
            </select>
            <button
              onClick={deleteSelection}
              title="Delete selection"
              className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:min-w-0"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {ghostPeople.length > 0 && (
          <div className={`pointer-events-auto absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/80 bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl ${isMobile ? 'bottom-20' : 'top-16'}`}>
            <span className="font-semibold">{ghostPeople.length} suggested</span>
            <button
              type="button"
              disabled={suggestChart.applying || !mapId}
              onClick={() => {
                if (!mapId) return;
                void applySuggestion(mapId, 'all', flushPendingPersist).then(
                  (result) => {
                    if (result) handleSuggestedApplied(result.map);
                  }
                );
              }}
              className="font-semibold text-[#5144d7] disabled:opacity-40"
            >
              Confirm all
            </button>
            <button
              type="button"
              disabled={suggestChart.applying}
              onClick={() => {
                confirmHighOnly();
                setShowSuggest(true);
              }}
              className="font-semibold text-[#5144d7] disabled:opacity-40"
            >
              High-confidence
            </button>
            <button
              type="button"
              disabled={suggestChart.applying || !mapId}
              onClick={() => {
                if (!mapId) return;
                void applySuggestion(
                  mapId,
                  'declineAll',
                  flushPendingPersist
                ).then((result) => {
                  if (result) handleSuggestedApplied(result.map);
                });
              }}
              className="font-semibold text-red-600 disabled:opacity-40"
            >
              Decline all
            </button>
            <button type="button" onClick={() => setShowSuggest(true)} className="font-semibold text-slate-500">
              Open panel
            </button>
          </div>
        )}

        {/* density control — collapse/expand every lane at once */}
        {(laneView.hiddenCount > 0 || showAllLanes || collapsedLanes.size > 0 || expandedLanes.size > 0) && (
          <div className={`pointer-events-auto absolute left-1/2 z-10 -translate-x-1/2 ${!readOnly && selectedNodes.length > 1 ? 'bottom-16' : 'bottom-3'}`}>
            <button
              type="button"
              onClick={() => {
                setShowAllLanes(laneView.hiddenCount > 0);
                setExpandedLanes(new Set());
                setCollapsedLanes(new Set());
              }}
              className="flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-slate-600 shadow-[0_10px_35px_rgba(15,23,42,.1)] backdrop-blur-xl transition hover:text-[#5b4cf0]"
            >
              {laneView.hiddenCount === 0 ? (
                <>Collapse lanes</>
              ) : (
                <>
                  Showing {laneView.shownCount} of {people.length + ghostPeople.length}
                  <span className="text-[#5b4cf0]">Show all</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* buying-committee coverage: a quiet pill with a segmented coverage bar. Persona-aware once
            workspace personas load; falls back to the buying-role breakdown otherwise. */}
        {people.length > 0 && (
          <div className={`absolute right-2 z-10 flex flex-col items-end gap-2 sm:bottom-auto sm:right-4 sm:top-20 ${!readOnly && selectedNodes.length > 1 ? 'bottom-28' : (laneView.hiddenCount > 0 || showAllLanes || collapsedLanes.size > 0 || expandedLanes.size > 0) ? 'bottom-14' : 'bottom-2'}`}>
            <button
              type="button"
              onClick={() => setCommitteeOpen((open) => !open)}
              aria-expanded={committeeOpen}
              aria-controls="committee-coverage"
              title={
                personaCoverage
                  ? `${personaCoverage.coveredCount} of ${personaCoverage.requiredCount} required personas covered`
                  : `${committeeCovered} of ${COMMITTEE_ROLES.length} buying roles covered`
              }
              className={`flex items-center gap-3 rounded-full border bg-white/90 py-1.5 pl-3.5 pr-3 text-xs shadow-[0_10px_35px_rgba(15,23,42,.08)] backdrop-blur-xl transition hover:bg-white ${committeeOpen ? 'border-slate-300 text-slate-800' : 'border-white/80 text-slate-600 hover:text-slate-800'}`}
            >
              <span className="font-semibold">Buying committee</span>
              <span className="flex items-center gap-[3px]" aria-hidden>
                {personaCoverage
                  ? personaCoverage.personas.map((entry) => (
                      <span
                        key={entry.personaId}
                        className={`h-1.5 w-3 rounded-full ${
                          entry.covered
                            ? 'bg-[#5b4cf0]'
                            : entry.required
                              ? 'bg-slate-200'
                              : 'bg-slate-100'
                        }`}
                      />
                    ))
                  : COMMITTEE_ROLES.map((r) => (
                      <span
                        key={r}
                        className={`h-1.5 w-3 rounded-full ${(coverage.get(r) ?? 0) > 0 ? ROLE_META[r].dot : 'bg-slate-200'}`}
                      />
                    ))}
              </span>
              <span className="tabular-nums text-slate-500">
                {personaCoverage ? (
                  <>
                    {personaCoverage.coveredCount}
                    <span className="text-slate-400">/{personaCoverage.requiredCount}</span>
                  </>
                ) : (
                  <>
                    {committeeCovered}
                    <span className="text-slate-400">/{COMMITTEE_ROLES.length}</span>
                  </>
                )}
              </span>
            </button>
            {committeeOpen && personaCoverage && (
              <div
                id="committee-coverage"
                data-testid="persona-coverage"
                className="w-80 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl"
              >
                <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-slate-400">
                    Persona coverage
                  </span>
                  <span className="text-xs text-slate-500">
                    {personaCoverage.coveredCount} of {personaCoverage.requiredCount} required
                    {personaCoverage.personas.length > personaCoverage.requiredCount
                      ? ` · ${personaCoverage.totalCovered}/${personaCoverage.personas.length} total`
                      : ''}
                  </span>
                </div>
                <ul className="max-h-[50vh] overflow-auto px-2 pb-2">
                  {personaCoverage.personas.map((entry) => {
                    const persona = personaById.get(entry.personaId);
                    const shown = entry.matches.slice(0, 3);
                    const extra = entry.matches.length - shown.length;
                    return (
                      <li key={entry.personaId}>
                        <button
                          type="button"
                          onClick={() => focusPersona(entry)}
                          title={
                            entry.covered
                              ? 'Select the matched people'
                              : 'Filter the canvas to this function'
                          }
                          className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left text-[13px] transition hover:bg-slate-50"
                        >
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              entry.covered
                                ? 'bg-[#5b4cf0]'
                                : 'border border-dashed border-slate-300 bg-transparent'
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={`truncate ${entry.covered ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                                {entry.name}
                              </span>
                              {!entry.required && (
                                <span className="rounded bg-slate-100 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                  optional
                                </span>
                              )}
                            </span>
                            {persona && (
                              <span className="block truncate text-[11px] text-slate-400">
                                {SENIORITY_LABELS[persona.minSeniority]}
                                {persona.minSeniority !== 'c_level' ? '+' : ''} ·{' '}
                                {persona.functions.length > 0
                                  ? persona.functions.map((fn) => FN_LABELS[fn]).join(', ')
                                  : 'any function'}
                              </span>
                            )}
                            {entry.covered ? (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {shown.map((m) => m.name).join(', ')}
                                {extra > 0 ? ` +${extra} more` : ''}
                              </span>
                            ) : (
                              <span className="mt-0.5 block text-[11px] text-amber-600">
                                Missing — click to focus the lane
                              </span>
                            )}
                          </span>
                          {entry.covered && (
                            <span className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#4d3fe0]">
                              {entry.matches.length}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
                  Personas are set per workspace under <b>Personas</b> on the accounts page.
                  {' '}Buying roles tagged: {committeeCovered}/{COMMITTEE_ROLES.length}.
                </p>
              </div>
            )}
            {committeeOpen && !personaCoverage && (
              <div
                id="committee-coverage"
                className="w-64 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl"
              >
                <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-slate-400">
                    Coverage
                  </span>
                  <span className="text-xs text-slate-500">
                    {people.length} {people.length === 1 ? 'person' : 'people'} · {committeeCovered} of {COMMITTEE_ROLES.length} roles
                  </span>
                </div>
                <ul className="px-2 pb-2">
                  {COMMITTEE_ROLES.map((r) => {
                    const count = coverage.get(r) ?? 0;
                    const covered = count > 0;
                    return (
                      <li
                        key={r}
                        className="flex items-center gap-3 rounded-xl px-2 py-2 text-[13px]"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${covered ? ROLE_META[r].dot : 'border border-dashed border-slate-300 bg-transparent'}`}
                        />
                        <span className={`flex-1 ${covered ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                          {ROLE_META[r].label}
                        </span>
                        {covered ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${ROLE_META[r].chip}`}>
                            {count}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Not identified</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {committeeCovered < COMMITTEE_ROLES.length && (
                  <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
                    Set a person’s buying role from their profile to fill the gaps.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {people.length === 0 && ghostPeople.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 text-center text-sm text-slate-500 shadow-sm">
              This map is empty.
              {!readOnly && (
                <>
                  {' '}
                  Add people with <b>+ Person</b> or drag a connection between
                  nodes to build reporting lines.
                  <button
                    type="button"
                    onClick={() => {
                      setShowRoster(false);
                      setShowSuggest(true);
                    }}
                    className="pointer-events-auto mt-3 block w-full rounded-xl bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white hover:bg-[#6b5cf8]"
                  >
                    Suggest org chart
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        </>
        )}

        <AnimatePresence>
          {showRoster && mapId && (
            <RosterDrawer
              mapId={mapId}
              domain={domain}
              readOnly={readOnly}
              onClose={() => setShowRoster(false)}
              onMapUpdated={handleRosterMapUpdated}
              onCountsChange={setRosterCounts}
              beforeAdd={flushPendingPersist}
            />
          )}
          {showSuggest && mapId && (
            <SuggestChartPanel
              mapId={mapId}
              readOnly={readOnly}
              peopleCount={people.length}
              onClose={() => setShowSuggest(false)}
              onApplied={handleSuggestedApplied}
              beforeApply={flushPendingPersist}
            />
          )}
          {selected && mapId && (
            <PersonPanel
              key={selected.id}
              mapId={mapId}
              person={selected}
              people={people}
              edges={edges.map(edgeToMap)}
              initiatives={meta?.initiatives}
              readOnly={readOnly}
              onChange={updatePerson}
              onSetManager={setManager}
              onAddInfluence={addInfluence}
              onDelete={deletePerson}
              onClose={() => setSelectedId(null)}
              onNavigate={(id) => setSelectedId(id)}
            />
          )}
        </AnimatePresence>
      </main>
      </div>

      {showShare && mapId && (
        <ShareModal mapId={mapId} onClose={() => setShowShare(false)} />
      )}
      {showMeetings && (
        <MeetingsImportModal
          people={people}
          onApply={applyMeetings}
          onClose={() => setShowMeetings(false)} />
      )}
      {showDeepResearch && (
        <DeepResearchModal
          domain={domain}
          mapId={mapId}
          workspaceId={workspaceId}
          people={people}
          selected={selected}
          initialFocus={deepResearchFocus}
          knownSources={knownSourceUrls}
          onClose={() => {
            setShowDeepResearch(false);
            setDeepResearchFocus('');
          }}
          onMerge={mergeResearch}
        />
      )}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
          <div
            ref={historyTrapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-modal-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id="history-modal-title" className="font-semibold text-slate-900">
                  Version history
                </h2>
                <p className="text-xs text-slate-500">
                  Restore an earlier collaborative save.
                </p>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {versions.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">
                  No earlier versions yet.
                </p>
              )}
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {version.author_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(version.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => void restoreVersion(version.id)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showInitiatives && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            ref={initiativesTrapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="initiatives-modal-title"
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:max-w-3xl sm:rounded-3xl sm:p-7"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
                  <Lightbulb size={13} />
                  Why this account changes now
                </div>
                <h2
                  id="initiatives-modal-title"
                  className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
                >
                  Initiative intelligence
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
                  Recent company signals, the people accountable for them, and
                  evidence-backed ways your solution may fit.
                </p>
              </div>
              <button
                onClick={() => setShowInitiatives(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {meta?.initiatives?.map((initiative, index) => (
                <article
                  key={initiative.name}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow"
                >
                  <div className="absolute right-3 top-2 text-4xl font-semibold tracking-tighter text-slate-100">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="relative pr-10 font-semibold tracking-tight text-slate-900">
                      {initiative.name}
                    </h3>
                    <span className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#5144d7]">
                      {initiative.category}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{initiative.summary}</p>
                  {((initiative.relevantTeams ?? []).length > 0 ||
                    (initiative.relevantPeople ?? []).length > 0) && (
                    <p className="mt-2 text-xs text-slate-500">
                      <b>Relevant:</b>{' '}
                      {[
                        ...(initiative.relevantTeams ?? []),
                        ...(initiative.relevantPeople ?? []),
                      ].join(' · ')}
                    </p>
                  )}
                  {(initiative.salesAngles ?? []).length > 0 && (
                    <div className="mt-3 rounded-xl bg-slate-950 p-3 text-white">
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[.14em] text-[#c9f04b]">
                        Conversation opening
                      </div>
                      <ul className="space-y-1.5 text-xs leading-5 text-slate-200">
                        {(initiative.salesAngles ?? []).map((angle) => (
                          <li key={angle}>• {angle}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(initiative.evidence ?? []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {(initiative.evidence ?? []).map((source) =>
                        source.startsWith('http') ? (
                          <a
                            key={source}
                            href={source}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                              if (mapId && !fixtureMode) {
                                void api
                                  .trackEvent(mapId, 'source_opened', {
                                    surface: 'initiative',
                                  })
                                  .catch(() => undefined);
                              }
                            }}
                            className="max-w-full truncate text-indigo-600 hover:underline"
                          >
                            Source
                          </a>
                        ) : (
                          <span key={source} className="text-slate-400">
                            {source}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
      {showStrategy && meta && (
        <AccountStrategyModal
          mapId={mapId ?? null}
          readOnly={readOnly}
          companyName={meta.companyName}
          domain={domain}
          people={people}
          edges={edges.map(edgeToMap)}
          initiatives={meta.initiatives ?? []}
          sellerProfile={sellerProfile}
          plan={meta.strategy ?? { stakeholders: {}, tasks: [], updatedAt: '' }}
          onUpdatePlan={updateStrategyPlan}
          onClose={() => setShowStrategy(false)}
          onFocusPeople={(matches) => {
            setShowStrategy(false);
            focusPeople(matches);
          }}
          onOpenDeepResearch={(focus) => {
            if (readOnly) return;
            setShowStrategy(false);
            setDeepResearchFocus(focus);
            setShowDeepResearch(true);
          }}
          onOpenInitiatives={() => {
            setShowStrategy(false);
            setShowInitiatives(true);
          }}
        />
      )}
      {showBriefing && mapId && (
        <AccountBriefingModal
          mapId={mapId}
          readOnly={readOnly}
          entry={briefingEntry}
          onClose={() => setShowBriefing(false)}
          onRunAction={(action: BriefingAction) => {
            setShowBriefing(false);
            if (action.type === 'focus_people') {
              const matches = people.filter((person) =>
                action.personIds?.includes(person.id)
              );
              if (matches.length > 0) focusPeople(matches);
            }
            if (action.type === 'open_strategy') setShowStrategy(true);
            if (action.type === 'open_initiatives') setShowInitiatives(true);
            if (action.type === 'deep_research' && !readOnly) {
              setDeepResearchFocus(action.focus ?? '');
              setShowDeepResearch(true);
            }
          }}
        />
      )}
      {showFeedback && (
        <FeedbackModal
          workspaceId={workspaceId || null}
          onClose={() => setShowFeedback(false)}
        />
      )}
      {showChanges && mapId && (
        <ChangeAlertsModal
          mapId={mapId}
          people={people}
          onClose={() => setShowChanges(false)}
          onFocusPerson={(person) => {
            setShowChanges(false);
            focusPeople([person]);
          }}
        />
      )}
      <AnimatePresence>
        {showCommands && (
          <CommandPalette
            people={people}
            readOnly={readOnly}
            hasInitiatives={(meta?.initiatives?.length ?? 0) > 0}
            onClose={() => setShowCommands(false)}
            onFocusPerson={(person) => focusPeople([person])}
            onRunAction={runPaletteAction}
            onRunCommand={runAgentCommand}
            onAskAgent={(messages: AccountAgentMessage[]) => {
              if (!mapId) throw new Error('Map not loaded');
              return api.askMap(mapId, messages);
            }}
            onRunAgentAction={runAccountAgentAction}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MapPage() {
  return (
    <ReactFlowProvider>
      <MapInner />
    </ReactFlowProvider>
  );
}
