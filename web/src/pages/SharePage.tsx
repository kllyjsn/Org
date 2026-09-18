import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import type { Edge, Node } from 'reactflow';
import { toPng } from 'html-to-image';
import { AnimatePresence } from 'framer-motion';
import { Download, Loader2 } from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import { influenceEdge, reportsEdge } from '../lib/flowEdges';
import { applyLanes, LANE_COL_GAP } from '../lib/layout';
import PersonNode from '../components/PersonNode';
import type { PersonNodeData } from '../components/PersonNode';
import LaneHeaderNode from '../components/LaneHeaderNode';
import type { LaneHeaderData } from '../components/LaneHeaderNode';
import MoreNode from '../components/MoreNode';
import type { MoreNodeData } from '../components/MoreNode';
import PersonPanel from '../components/PersonPanel';
import { useIsMobile } from '../lib/useIsMobile';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { computeLaneView } from '../lib/laneView';
import type { MapState } from '../types';

const nodeTypes = { person: PersonNode, lane: LaneHeaderNode, more: MoreNode };

interface SharedMap {
  name: string;
  domain: string;
  company_name: string | null;
  updated_at: string;
  state: MapState;
}

function ShareInner() {
  const { token } = useParams<{ token: string }>();
  const [shared, setShared] = useState<SharedMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node<PersonNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const rf = useReactFlow();
  useDocumentTitle(
    `${shared?.company_name || shared?.name || 'Shared map'} (shared) — TopDown`
  );
  const openingFitOptions = isMobile
    ? { padding: 0.1, minZoom: 0.62, maxZoom: 0.9 }
    : { padding: 0.2, minZoom: 0.45 };

  useEffect(() => {
    if (!token) return;
    api
      .shareView(token)
      .then(({ map }) => {
        setShared(map);
        // Normalize to lane positions — saved coordinates may predate the
        // current grouping, which left headers clamped in a cluster.
        const laid = applyLanes(
          map.state.people ?? [],
          isMobile ? 2 : 4,
          'department',
          isMobile ? 270 : LANE_COL_GAP
        );
        const pos = new Map(laid.map((p) => [p.id, { x: p.x, y: p.y }]));
        setNodes(
          (map.state.people ?? []).map((p) => ({
            id: p.id,
            type: 'person',
            position: pos.get(p.id) ?? { x: p.x, y: p.y },
            data: { person: p, readOnly: true },
          }))
        );
        setEdges(
          (map.state.edges ?? []).map((e) =>
            e.kind === 'reports'
              ? reportsEdge(e.from, e.to, e.id, e.inferred)
              : influenceEdge(e.from, e.to, e.label, e.id)
          )
        );
        // Tall maps center on nothing useful when fit to bounds — anchor
        // the top of the chart at a readable zoom instead.
        const people = map.state.people ?? [];
        window.setTimeout(() => {
          if (people.length === 0) return;
          const tallEnough =
            Math.max(...people.map((p) => p.y)) -
              Math.min(...people.map((p) => p.y)) >
            window.innerHeight / 0.8;
          if (!tallEnough) return;
          const minX = Math.min(...people.map((p) => p.x));
          const minY = Math.min(...people.map((p) => p.y));
          const maxX = Math.max(...people.map((p) => p.x));
          const spread = maxX - minX + 250;
          const rail = isMobile ? 48 : 224;
          const zoom = Math.min(
            isMobile ? 0.62 : 0.8,
            (window.innerWidth - rail - 16) / spread
          );
          void rf.setViewport(
            {
              x: (isMobile ? 8 : 32) - minX * zoom,
              y: (isMobile ? 170 : 200) - minY * zoom,
              zoom,
            },
            { duration: 450 }
          );
        }, 50);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'could not load shared map'
        )
      );
  }, [token, isMobile, rf]);

  const selected =
    nodes.find((n) => n.id === selectedId)?.data.person ?? null;

  // Same progressive disclosure as the editor: collapsed lanes show their
  // leaders plus a "+N more" tile so a 200-person share stays readable.
  const [expandedLanes, setExpandedLanes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [showAllLanes, setShowAllLanes] = useState(false);
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

  const laneView = useMemo(() => {
    const view = computeLaneView(
      nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        person: n.data.person,
      })),
      {
        columns: isMobile ? 2 : 4,
        colGap: isMobile ? 270 : LANE_COL_GAP,
        expandedLanes,
        collapsedLanes,
        showAll: showAllLanes,
      }
    );
    // Synthetic nodes must declare their size: React Flow hides nodes until
    // they are measured, and these objects are recreated on every lane
    // recompute, which wipes their measured dimensions and leaves them
    // permanently invisible.
    const headers: Node<LaneHeaderData>[] = view.headers.map((header) => ({
      id: `lane:${header.lane}`,
      type: 'lane',
      position: { x: header.x, y: header.y },
      width: 340,
      height: 34,
      data: {
        label: header.lane,
        count: header.count,
        shown: header.shown,
        expanded: header.expanded,
        onToggle: toggleLane,
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
      height: 52,
      style: { width: 250 },
      data: { count: tile.count, lane: tile.lane, onExpand: toggleLane },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
    }));
    const visibleNodes = nodes
      .filter((node) => view.visibleIds.has(node.id))
      .map((node) => {
        const person = node.data.person;
        const ariaLabel = `${person.name}${person.title ? ', ' + person.title : ''}${person.department ? ', ' + person.department : ''}`;
        const pos = view.posOverride.get(node.id);
        return pos
          ? { ...node, position: pos, ariaLabel }
          : { ...node, ariaLabel };
      });
    return {
      nodes: [...headers, ...tiles, ...visibleNodes],
      shownCount: view.shownCount,
      hiddenCount: view.hiddenCount,
    };
  }, [nodes, isMobile, expandedLanes, collapsedLanes, showAllLanes, toggleLane]);

  const displayEdges = useMemo(() => {
    const nameById = new Map(
      nodes.map((n) => [n.data.person.id, n.data.person.name])
    );
    return edges.map((edge) => {
      const sourceName = nameById.get(edge.source) ?? edge.source;
      const targetName = nameById.get(edge.target) ?? edge.target;
      const ariaLabel =
        edge.data?.kind === 'reports'
          ? `${targetName} reports to ${sourceName}`
          : `${sourceName} influences ${targetName}${edge.data?.label ? ': ' + edge.data.label : ''}`;
      return { ...edge, ariaLabel };
    });
  }, [edges, nodes]);

  const exportPng = useCallback(async () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!el || nodes.length === 0 || !shared) return;
    const bounds = getNodesBounds(nodes);
    const W = 1920;
    const H = Math.max(
      1080,
      Math.ceil((bounds.height * 1920) / Math.max(bounds.width, 1)) + 200
    );
    const vp = getViewportForBounds(bounds, W, H, 0.4, 1.5, 0.08);
    const url = await toPng(el, {
      backgroundColor: '#f8fafc',
      width: W,
      height: H,
      style: {
        width: `${W}px`,
        height: `${H}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${shared.name || 'org-map'}.png`;
    a.click();
  }, [nodes, shared]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
        <p role="alert" className="text-lg font-medium">
          {error}
        </p>
        <p className="text-sm">This share link may have been revoked or expired.</p>
        <Link to="/" className="mt-2 text-sm text-indigo-600 hover:underline">
          TopDown — build your own account maps →
        </Link>
      </div>
    );
  }

  if (!shared) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f6f7f2]">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#101828] px-4 py-2.5 text-white">
        <Wordmark size="sm" inverse />
        <span className="text-sm font-semibold text-white">
          {shared.company_name || shared.name}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[.07] px-2 py-0.5 text-xs text-slate-300">
          {shared.domain}
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline">
          live view · updated{' '}
          {new Date(shared.updated_at).toLocaleDateString()}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => void exportPng()}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.06] px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
        >
          <Download size={15} /> PNG
        </button>
        <Link
          to="/"
          className="rounded-lg bg-[#c9f04b] px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-[#d5f66c]"
        >
          Make your own
        </Link>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="relative min-h-0 flex-1 bg-[#f6f7f2]"
      >
        <h1 className="sr-only">
          {shared.company_name || shared.name || 'Shared map'}
        </h1>
        <ReactFlow
          nodes={laneView.nodes}
          edges={displayEdges}
          nodesFocusable
          onNodeClick={(_, n) => {
            if (n.type !== 'person') return;
            setSelectedId(n.id);
          }}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable
          fitView
          fitViewOptions={openingFitOptions}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={28} size={1} color="#d9ddd4" />
          <Controls
            showInteractive={false}
            fitViewOptions={openingFitOptions}
          />
          <MiniMap pannable zoomable className="!bg-slate-50" />
        </ReactFlow>

        {(laneView.hiddenCount > 0
 || showAllLanes || collapsedLanes.size > 0 || expandedLanes.size > 0) && (
          <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
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
                  Showing {laneView.shownCount} of {nodes.length}
                  <span className="text-[#5b4cf0]">Show all</span>
                </>
              )}
            </button>
          </div>
        )}

        <AnimatePresence>
          {selected && (
            <PersonPanel
              key={selected.id}
              mapId=""
              person={selected}
              people={nodes.map((n) => n.data.person)}
              edges={edges.map((e) => ({
                id: e.id,
                from: e.source,
                to: e.target,
                kind: (e.data?.kind ?? 'reports') as 'reports' | 'influence',
                label: e.data?.label ?? null,
              }))}
              initiatives={shared.state.meta?.initiatives ?? []}
              readOnly
              onChange={() => {}}
              onSetManager={() => {}}
              onAddInfluence={() => {}}
              onDelete={() => {}}
              onClose={() => setSelectedId(null)}
              onNavigate={(id) => setSelectedId(id)}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function SharePage() {
  return (
    <ReactFlowProvider>
      <ShareInner />
    </ReactFlowProvider>
  );
}
