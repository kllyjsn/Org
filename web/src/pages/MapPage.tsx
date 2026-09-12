import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import type { Connection, Edge, EdgeChange, Node, NodeChange } from 'reactflow';

type EdgeData = { kind: 'reports' | 'influence'; label?: string | null };
type FlowEdge = Edge<EdgeData>;

function edgeToMap(e: FlowEdge): MapEdge {
  return {
    id: e.id,
    from: e.source,
    to: e.target,
    kind: e.data?.kind ?? 'reports',
    label: e.data?.label ?? null,
  };
}
import { toPng } from 'html-to-image';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  LayoutGrid,
  Loader2,
  Share2,
  UserPlus,
} from 'lucide-react';
import { api } from '../api';
import PersonNode from '../components/PersonNode';
import type { PersonNodeData } from '../components/PersonNode';
import PersonPanel from '../components/PersonPanel';
import ShareModal from '../components/ShareModal';
import { applyLayout } from '../lib/layout';
import { ROLE_META } from '../lib/colors';
import type { BuyingRole, MapEdge, MapState, Person } from '../types';

const nodeTypes = { person: PersonNode };

function reportsEdge(from: string, to: string, id?: string): FlowEdge {
  return {
    id: id ?? crypto.randomUUID(),
    source: from,
    target: to,
    type: 'smoothstep',
    data: { kind: 'reports' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    style: { stroke: '#94a3b8', strokeWidth: 1.5 },
  };
}

function influenceEdge(from: string, to: string, label: string | null, id?: string): FlowEdge {
  return {
    id: id ?? crypto.randomUUID(),
    source: from,
    target: to,
    data: { kind: 'influence', label },
    label: label ?? undefined,
    labelStyle: { fontSize: 10, fill: '#7c3aed' },
    style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '6 4' },
  };
}

function toFlow(state: MapState): { nodes: Node<PersonNodeData>[]; edges: FlowEdge[] } {
  const nodes: Node<PersonNodeData>[] = state.people.map((p) => ({
    id: p.id,
    type: 'person',
    position: { x: p.x, y: p.y },
    data: { person: p },
  }));
  const edges: FlowEdge[] = state.edges.map((e) =>
    e.kind === 'reports'
      ? reportsEdge(e.from, e.to, e.id)
      : influenceEdge(e.from, e.to, e.label, e.id)
  );
  return { nodes, edges };
}

function toState(
  nodes: Node<PersonNodeData>[],
  edges: FlowEdge[],
  meta: MapState['meta']
): MapState {
  return {
    people: nodes.map((n) => ({
      ...n.data.person,
      x: n.position.x,
      y: n.position.y,
    })),
    edges: edges.map(edgeToMap),
    meta,
  };
}

type SaveState = 'saved' | 'dirty' | 'saving';

function MapInner() {
  const { mapId } = useParams<{ mapId: string }>();
  const rf = useReactFlow();
  const [mapName, setMapName] = useState('');
  const [domain, setDomain] = useState('');
  const [meta, setMeta] = useState<MapState['meta'] | null>(null);
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member');
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loaded, setLoaded] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const metaRef = useRef<MapState['meta'] | null>(null);

  const readOnly = role === 'viewer';

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    if (!mapId) return;
    api
      .getMap(mapId)
      .then(({ map }) => {
        const flow = toFlow(map.state);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setMapName(map.name);
        setDomain(map.domain);
        setMeta(map.state.meta);
        setRole(map.role);
        setLoaded(true);
        window.setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
      })
      .catch(() => setNotFound(true));
  }, [mapId, setNodes, setEdges, rf]);

  const persist = useCallback(
    (ns: Node<PersonNodeData>[], es: FlowEdge[]) => {
      if (!mapId || !metaRef.current || readOnly) return;
      setSaveState('saving');
      api
        .patchMap(mapId, { state: toState(ns, es, metaRef.current) })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('dirty'));
    },
    [mapId, readOnly]
  );

  const markDirty = useCallback(
    (ns: Node<PersonNodeData>[], es: FlowEdge[]) => {
      if (readOnly) return;
      setSaveState('dirty');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => persist(ns, es), 900);
    },
    [persist, readOnly]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      if (changes.some((ch) => ch.type === 'position' || ch.type === 'remove')) {
        // state below is post-change via useNodesState; persist next tick
        window.setTimeout(() => {
          setNodes((ns) => {
            setEdges((es) => {
              markDirty(ns, es);
              return es;
            });
            return ns;
          });
        }, 0);
      }
    },
    [onNodesChange, markDirty, setNodes, setEdges]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      if (changes.some((ch) => ch.type === 'remove')) {
        window.setTimeout(() => {
          setNodes((ns) => {
            setEdges((es) => {
              markDirty(ns, es);
              return es;
            });
            return ns;
          });
        }, 0);
      }
    },
    [onEdgesChange, markDirty, setNodes, setEdges]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      setEdges((es) => {
        // one formal manager per person
        const without = es.filter(
          (e) => !(e.data?.kind === 'reports' && e.target === conn.target)
        );
        const next = [
          ...without,
          reportsEdge(conn.source!, conn.target!),
        ];
        markDirty(nodes, next);
        return next;
      });
    },
    [setEdges, markDirty, nodes]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const ids = new Set(deleted.map((n) => n.id));
      setEdges((es) => {
        const next = es.filter((e) => !ids.has(e.source) && !ids.has(e.target));
        markDirty(nodes.filter((n) => !ids.has(n.id)), next);
        return next;
      });
      setSelectedId((sel) => (sel && ids.has(sel) ? null : sel));
    },
    [setEdges, markDirty, nodes]
  );

  const selected = nodes.find((n) => n.id === selectedId)?.data.person ?? null;
  const people = useMemo(() => nodes.map((n) => n.data.person), [nodes]);

  const coverage = useMemo(() => {
    const counts = new Map<BuyingRole, number>();
    for (const p of people) {
      if (p.role === 'none') continue;
      counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
    }
    return counts;
  }, [people]);

  const updatePerson = useCallback(
    (updated: Person) => {
      setNodes((ns) => {
        const next = ns.map((n) =>
          n.id === updated.id ? { ...n, data: { person: updated } } : n
        );
        setEdges((es) => {
          markDirty(next, es);
          return es;
        });
        return next;
      });
    },
    [setNodes, setEdges, markDirty]
  );

  const setManager = useCallback(
    (personId: string, managerId: string | null) => {
      setEdges((es) => {
        const without = es.filter(
          (e) => !(e.data?.kind === 'reports' && e.target === personId)
        );
        const next = managerId
          ? [...without, reportsEdge(managerId, personId)]
          : without;
        markDirty(nodes, next);
        return next;
      });
    },
    [setEdges, markDirty, nodes]
  );

  const addInfluence = useCallback(
    (fromId: string, toId: string, label: string) => {
      setEdges((es) => {
        const next = [
          ...es,
          influenceEdge(fromId, toId, label || null),
        ];
        markDirty(nodes, next);
        return next;
      });
    },
    [setEdges, markDirty, nodes]
  );

  const addPerson = useCallback(() => {
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const person: Person = {
      id: crypto.randomUUID(),
      name: 'New person',
      title: '',
      department: null,
      role: 'none',
      confidence: 'high',
      sources: [],
      notes: '',
      email: null,
      linkedin: null,
      x: center.x,
      y: center.y,
    };
    setNodes((ns) => {
      const next = [
        ...ns,
        {
          id: person.id,
          type: 'person' as const,
          position: { x: center.x, y: center.y },
          data: { person },
        },
      ];
      setEdges((es) => {
        markDirty(next, es);
        return es;
      });
      return next;
    });
    setSelectedId(person.id);
  }, [rf, setNodes, setEdges, markDirty]);

  const deletePerson = useCallback(
    (personId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== personId));
      setEdges((es) => {
        const next = es.filter(
          (e) => e.source !== personId && e.target !== personId
        );
        markDirty(
          nodes.filter((n) => n.id !== personId),
          next
        );
        return next;
      });
      setSelectedId(null);
    },
    [setNodes, setEdges, markDirty, nodes]
  );

  const autoLayout = useCallback(() => {
    const currentPeople = nodes.map((n) => ({ ...n.data.person, x: n.position.x, y: n.position.y }));
    const currentEdges: MapEdge[] = edges.map(edgeToMap);
    const laid = applyLayout(currentPeople, currentEdges);
    const pos = new Map(laid.map((p) => [p.id, { x: p.x, y: p.y }]));
    setNodes((ns) => {
      const next = ns.map((n) => ({
        ...n,
        position: pos.get(n.id) ?? n.position,
      }));
      markDirty(next, edges);
      return next;
    });
    window.setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes, markDirty, rf]);

  const exportPng = useCallback(async () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!el || nodes.length === 0) return;
    const bounds = getNodesBounds(nodes);
    const W = 1920;
    const H = Math.max(1080, Math.ceil((bounds.height * 1920) / Math.max(bounds.width, 1)) + 200);
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
    a.download = `${mapName || 'org-map'}.png`;
    a.click();
  }, [nodes, mapName]);

  const saveName = useCallback(() => {
    if (!mapId || readOnly) return;
    void api.patchMap(mapId, { name: mapName });
  }, [mapId, mapName, readOnly]);

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
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link
          to="/app"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ArrowLeft size={17} />
        </Link>
        <input
          className="w-56 rounded-lg border border-transparent px-2 py-1 text-sm font-semibold outline-none hover:border-slate-200 focus:border-indigo-400"
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          onBlur={saveName}
          disabled={readOnly}
        />
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {domain}
        </span>
        {meta?.provider && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
            {meta.tier} · {meta.provider}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-xs text-slate-400">
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'dirty'
              ? 'Unsaved changes'
              : 'Saved'}
        </span>
        {!readOnly && (
          <>
            <button
              onClick={addPerson}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <UserPlus size={15} /> Person
            </button>
            <button
              onClick={autoLayout}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <LayoutGrid size={15} /> Layout
            </button>
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              <Share2 size={15} /> Share
            </button>
          </>
        )}
        <button
          onClick={() => void exportPng()}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Download size={15} /> PNG
        </button>
      </header>

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-slate-50" />
        </ReactFlow>

        {/* buying-committee coverage strip */}
        {people.length > 0 && (
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Coverage · {people.length} people
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['champion', 'economic_buyer', 'decision_maker', 'technical_buyer', 'influencer', 'blocker'] as BuyingRole[]).map(
                (r) => {
                  const count = coverage.get(r) ?? 0;
                  return (
                    <span
                      key={r}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        count > 0
                          ? ROLE_META[r].chip
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${count > 0 ? ROLE_META[r].dot : 'bg-slate-300'}`}
                      />
                      {ROLE_META[r].label}
                      {count > 0 && ` · ${count}`}
                    </span>
                  );
                }
              )}
            </div>
          </div>
        )}

        {people.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 text-center text-sm text-slate-500 shadow-sm">
              This map is empty.
              {!readOnly && (
                <>
                  {' '}
                  Add people with <b>+ Person</b> or drag a connection between
                  nodes to build reporting lines.
                </>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {selected && mapId && (
            <PersonPanel
              key={selected.id}
              mapId={mapId}
              person={selected}
              people={people}
              edges={edges.map(edgeToMap)}
              readOnly={readOnly}
              onChange={updatePerson}
              onSetManager={setManager}
              onAddInfluence={addInfluence}
              onDelete={deletePerson}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {showShare && mapId && (
        <ShareModal mapId={mapId} onClose={() => setShowShare(false)} />
      )}
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
