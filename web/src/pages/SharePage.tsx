import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
} from 'reactflow';
import type { Edge, Node } from 'reactflow';
import { toPng } from 'html-to-image';
import { AnimatePresence } from 'framer-motion';
import { Download, Loader2 } from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import PersonNode from '../components/PersonNode';
import type { PersonNodeData } from '../components/PersonNode';
import PersonPanel from '../components/PersonPanel';
import type { MapState } from '../types';

const nodeTypes = { person: PersonNode };

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

  useEffect(() => {
    if (!token) return;
    api
      .shareView(token)
      .then(({ map }) => {
        setShared(map);
        setNodes(
          map.state.people.map((p) => ({
            id: p.id,
            type: 'person',
            position: { x: p.x, y: p.y },
            data: { person: p },
          }))
        );
        setEdges(
          map.state.edges.map((e) =>
            e.kind === 'reports'
              ? {
                  id: e.id,
                  source: e.from,
                  target: e.to,
                  type: 'smoothstep',
                  data: { kind: 'reports' },
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
                  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
                }
              : {
                  id: e.id,
                  source: e.from,
                  target: e.to,
                  data: { kind: 'influence', label: e.label },
                  label: e.label ?? undefined,
                  labelStyle: { fontSize: 10, fill: '#7c3aed' },
                  style: {
                    stroke: '#8b5cf6',
                    strokeWidth: 1.5,
                    strokeDasharray: '6 4',
                  },
                }
          )
        );
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'could not load shared map'
        )
      );
  }, [token]);

  const selected =
    nodes.find((n) => n.id === selectedId)?.data.person ?? null;

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
        <p className="text-lg font-medium">{error}</p>
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
    <div className="flex h-full flex-col bg-[#f6f7f2]">
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

      <div className="relative flex-1 bg-[#f6f7f2]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={28} size={1} color="#d9ddd4" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-slate-50" />
        </ReactFlow>

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
              initiatives={shared.state.meta.initiatives}
              readOnly
              onChange={() => {}}
              onSetManager={() => {}}
              onAddInfluence={() => {}}
              onDelete={() => {}}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>
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
