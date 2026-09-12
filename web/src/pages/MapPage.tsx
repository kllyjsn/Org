import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
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
  useViewport,
} from 'reactflow';
import type { Connection, Edge, EdgeChange, Node, NodeChange } from 'reactflow';

type EdgeData = {
  kind: 'reports' | 'influence';
  label?: string | null;
  inferred?: boolean;
};
type FlowEdge = Edge<EdgeData>;

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
  Copy,
  Download,
  FileUp,
  History,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Redo2,
  Share2,
  Ungroup,
  Undo2,
  Group,
  UserPlus,
} from 'lucide-react';
import { api } from '../api';
import PersonNode from '../components/PersonNode';
import type { PersonNodeData } from '../components/PersonNode';
import PersonPanel from '../components/PersonPanel';
import ShareModal from '../components/ShareModal';
import { applyLayout } from '../lib/layout';
import { ROLE_META } from '../lib/colors';
import { parseCsv } from '../lib/csv';
import type {
  BuyingRole,
  MapEdge,
  MapPresence,
  MapState,
  MapVersion,
  Person,
} from '../types';

const nodeTypes = { person: PersonNode };

function reportsEdge(
  from: string,
  to: string,
  id?: string,
  inferred?: boolean
): FlowEdge {
  const stroke = inferred ? '#c7d2fe' : '#94a3b8';
  return {
    id: id ?? crypto.randomUUID(),
    source: from,
    target: to,
    type: 'smoothstep',
    data: { kind: 'reports', inferred },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    style: {
      stroke,
      strokeWidth: 1.5,
      ...(inferred ? { strokeDasharray: '5 4' } : {}),
    },
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

function toFlow(
  state: MapState,
  readOnly = false
): { nodes: Node<PersonNodeData>[]; edges: FlowEdge[] } {
  const nodes: Node<PersonNodeData>[] = state.people.map((p) => ({
    id: p.id,
    type: 'person',
    position: { x: p.x, y: p.y },
    data: { person: p, readOnly },
    style: { width: p.width ?? 250, height: p.height },
  }));
  const edges: FlowEdge[] = state.edges.map((e) =>
    e.kind === 'reports'
      ? reportsEdge(e.from, e.to, e.id, e.inferred)
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
      width: n.width ?? n.data.person.width,
      height: n.height ?? n.data.person.height,
    })),
    edges: edges.map(edgeToMap),
    meta,
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
  const rf = useReactFlow();
  const viewport = useViewport();
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
  const [showHistory, setShowHistory] = useState(false);
  const [showInitiatives, setShowInitiatives] = useState(false);
  const [versions, setVersions] = useState<MapVersion[]>([]);
  const [presence, setPresence] = useState<MapPresence[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [past, setPast] = useState<CanvasSnapshot[]>([]);
  const [future, setFuture] = useState<CanvasSnapshot[]>([]);
  const saveTimer = useRef<number | null>(null);
  const editTimer = useRef<number | null>(null);
  const dragHistoryRecorded = useRef(false);
  const clipboard = useRef<CanvasSnapshot | null>(null);
  const crmInput = useRef<HTMLInputElement | null>(null);
  const metaRef = useRef<MapState['meta'] | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const remoteUpdatedAt = useRef('');
  const saveStateRef = useRef<SaveState>('saved');

  const readOnly = role === 'viewer';

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mapId) return;
    api
      .getMap(mapId)
      .then(({ map }) => {
        const flow = toFlow(map.state, map.role === 'viewer');
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setMapName(map.name);
        setDomain(map.domain);
        setMeta(map.state.meta);
        setRole(map.role);
        remoteUpdatedAt.current = map.updated_at;
        setPast([]);
        setFuture([]);
        setLoaded(true);
        window.setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
      })
      .catch(() => setNotFound(true));
  }, [mapId, setNodes, setEdges, rf]);

  useEffect(() => {
    if (!mapId) return;
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
  }, [mapId, selectedId]);

  useEffect(() => {
    if (!mapId) return;
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
          setMapName(map.name);
          setMeta(map.state.meta);
          setNodes(flow.nodes);
          setEdges(flow.edges);
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(sync, 3_000);
    return () => window.clearInterval(interval);
  }, [mapId, setNodes, setEdges]);

  const openHistory = useCallback(() => {
    if (!mapId) return;
    setShowHistory(true);
    void api
      .listVersions(mapId)
      .then(({ versions: items }) => setVersions(items));
  }, [mapId]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!mapId) return;
      const restored = await api.restoreVersion(mapId, versionId);
      const flow = toFlow(restored.state, readOnly);
      setMapName(restored.name);
      setMeta(restored.state.meta);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setPast([]);
      setFuture([]);
      setShowHistory(false);
      setSaveState('saved');
    },
    [mapId, readOnly, setNodes, setEdges]
  );

  const persist = useCallback(
    (ns: Node<PersonNodeData>[], es: FlowEdge[]) => {
      if (!mapId || !metaRef.current || readOnly) return;
      saveStateRef.current = 'saving';
      setSaveState('saving');
      api
        .patchMap(mapId, { state: toState(ns, es, metaRef.current) })
        .then(({ updatedAt }) => {
          remoteUpdatedAt.current = updatedAt;
          saveStateRef.current = 'saved';
          setSaveState('saved');
        })
        .catch(() => {
          saveStateRef.current = 'dirty';
          setSaveState('dirty');
        });
    },
    [mapId, readOnly]
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

  const recordHistory = useCallback(() => {
    if (readOnly) return;
    setPast((items) => [...items.slice(-49), snapshot(nodes, edges)]);
    setFuture([]);
  }, [readOnly, nodes, edges]);

  const restore = useCallback(
    (next: CanvasSnapshot) => {
      const restored = snapshot(next.nodes, next.edges);
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
      recordHistory();
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
    [setEdges, markDirty, nodes, recordHistory]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      recordHistory();
      const ids = new Set(deleted.map((n) => n.id));
      setEdges((es) => {
        const next = es.filter((e) => !ids.has(e.source) && !ids.has(e.target));
        markDirty(nodes.filter((n) => !ids.has(n.id)), next);
        return next;
      });
      setSelectedId((sel) => (sel && ids.has(sel) ? null : sel));
    },
    [setEdges, markDirty, nodes, recordHistory]
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
      if (!editTimer.current) recordHistory();
      if (editTimer.current) window.clearTimeout(editTimer.current);
      editTimer.current = window.setTimeout(() => {
        editTimer.current = null;
      }, 750);
      setNodes((ns) => {
        const next = ns.map((n) =>
          n.id === updated.id
            ? { ...n, data: { ...n.data, person: updated } }
            : n
        );
        setEdges((es) => {
          markDirty(next, es);
          return es;
        });
        return next;
      });
    },
    [setNodes, setEdges, markDirty, recordHistory]
  );

  const setManager = useCallback(
    (personId: string, managerId: string | null) => {
      recordHistory();
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
    [setEdges, markDirty, nodes, recordHistory]
  );

  const addInfluence = useCallback(
    (fromId: string, toId: string, label: string) => {
      recordHistory();
      setEdges((es) => {
        const next = [
          ...es,
          influenceEdge(fromId, toId, label || null),
        ];
        markDirty(nodes, next);
        return next;
      });
    },
    [setEdges, markDirty, nodes, recordHistory]
  );

  const addPerson = useCallback(() => {
    recordHistory();
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
          data: { person, readOnly: false },
          style: { width: 250 },
        },
      ];
      setEdges((es) => {
        markDirty(next, es);
        return es;
      });
      return next;
    });
    setSelectedId(person.id);
  }, [rf, setNodes, setEdges, markDirty, recordHistory]);

  const deletePerson = useCallback(
    (personId: string) => {
      recordHistory();
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
    [setNodes, setEdges, markDirty, nodes, recordHistory]
  );

  const autoLayout = useCallback(() => {
    recordHistory();
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
  }, [nodes, edges, setNodes, markDirty, rf, recordHistory]);

  const selectedNodes = useMemo(
    () => nodes.filter((node) => node.selected),
    [nodes]
  );

  const alignTop = useCallback(() => {
    if (selectedNodes.length < 2) return;
    recordHistory();
    const y = Math.min(...selectedNodes.map((node) => node.position.y));
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    setNodes((items) => {
      const next = items.map((node) =>
        selectedIds.has(node.id)
          ? { ...node, position: { ...node.position, y } }
          : node
      );
      markDirty(next, edges);
      return next;
    });
  }, [selectedNodes, recordHistory, setNodes, markDirty, edges]);

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
    setNodes((items) => {
      const next = items.map((node) => {
        const x = xById.get(node.id);
        return x === undefined
          ? node
          : { ...node, position: { ...node.position, x } };
      });
      markDirty(next, edges);
      return next;
    });
  }, [selectedNodes, recordHistory, setNodes, markDirty, edges]);

  const groupSelection = useCallback(() => {
    if (selectedNodes.length < 2) return;
    recordHistory();
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const groupId = crypto.randomUUID();
    setNodes((items) => {
      const next = items.map((node) =>
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
      markDirty(next, edges);
      return next;
    });
  }, [selectedNodes, recordHistory, setNodes, markDirty, edges]);

  const ungroupSelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    recordHistory();
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    setNodes((items) => {
      const next = items.map((node) =>
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
      markDirty(next, edges);
      return next;
    });
  }, [selectedNodes, recordHistory, setNodes, markDirty, edges]);

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
    setNodes((items) => {
      const next = [
        ...items.map((node) => ({ ...node, selected: false })),
        ...pastedNodes,
      ];
      setEdges((itemsEdges) => {
        const nextEdges = [
          ...itemsEdges.map((edge) => ({ ...edge, selected: false })),
          ...pastedEdges,
        ];
        markDirty(next, nextEdges);
        return nextEdges;
      });
      return next;
    });
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
      if (isTypingTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
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
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      setNodes((items) => {
        const next = [...items];
        for (const row of rows) {
          const name =
            row.name ||
            row.fullname ||
            [row.firstname, row.lastname].filter(Boolean).join(' ');
          const email = row.email || row.emailaddress;
          if (!name && !email) continue;
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
            ...(row.title || row.jobtitle
              ? { title: row.title || row.jobtitle }
              : {}),
            ...(row.department ? { department: row.department } : {}),
            ...(row.team ? { team: row.team, teamEvidence: 'sourced' as const } : {}),
            ...(row.productline || row.product
              ? { productLine: row.productline || row.product }
              : {}),
            ...(email ? { email } : {}),
            ...(row.linkedin || row.linkedinurl
              ? { linkedin: row.linkedin || row.linkedinurl }
              : {}),
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
                  notes: [person.notes, row.notes].filter(Boolean).join('\n'),
                  sources: Array.from(new Set([...person.sources, 'CRM CSV'])),
                },
              },
            };
            updated += 1;
            continue;
          }
          const person: Person = {
            id: crypto.randomUUID(),
            name: name || email,
            title: row.title || row.jobtitle || 'CRM contact',
            department: row.department || null,
            team: row.team || null,
            productLine: row.productline || row.product || null,
            teamEvidence: row.team ? 'sourced' : null,
            role: 'none',
            confidence: 'high',
            sources: ['CRM CSV'],
            researchStatus: 'verified',
            notes: row.notes || '',
            email: email || null,
            linkedin: row.linkedin || row.linkedinurl || null,
            x: center.x + (added % 4) * 280,
            y: center.y + Math.floor(added / 4) * 130,
          };
          next.push({
            id: person.id,
            type: 'person',
            position: { x: person.x, y: person.y },
            data: { person, readOnly: false },
            style: { width: 250 },
          });
          added += 1;
        }
        markDirty(next, edges);
        return next;
      });
      setImportNotice(`CRM import: ${updated} enriched, ${added} added.`);
      window.setTimeout(() => setImportNotice(''), 5_000);
    },
    [readOnly, recordHistory, rf, setNodes, markDirty, edges]
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
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:gap-3 sm:px-4">
        <Link
          to="/app"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ArrowLeft size={17} />
        </Link>
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-semibold outline-none hover:border-slate-200 focus:border-indigo-400 sm:w-56 sm:flex-none"
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          onBlur={saveName}
          disabled={readOnly}
        />
        <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline">
          {domain}
        </span>
        {meta?.provider && (
          <span className="hidden rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 md:inline">
            {meta.tier} · {meta.provider}
          </span>
        )}
        <div className="hidden flex-1 sm:block" />
        <span className="hidden text-xs text-slate-400 sm:inline">
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
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-indigo-100 text-[10px] font-semibold text-indigo-700"
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
        <div className="order-last flex w-full items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 sm:order-none sm:w-auto sm:border-0 sm:pt-0">
          {!readOnly && (
            <>
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              <button
                onClick={undo}
                disabled={past.length === 0}
                title="Undo (⌘Z)"
                className="border-r border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                <Undo2 size={15} />
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                title="Redo (⇧⌘Z)"
                className="p-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                <Redo2 size={15} />
              </button>
            </div>
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
              onClick={() => crmInput.current?.click()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <FileUp size={15} /> CRM CSV
            </button>
            <input
              ref={crmInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void importCrmCsv(event)}
            />
            <button
              onClick={openHistory}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <History size={15} /> History
            </button>
            {(meta?.initiatives?.length ?? 0) > 0 && (
              <button
                onClick={() => setShowInitiatives(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100"
              >
                <Lightbulb size={15} /> Initiatives
              </button>
            )}
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
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Download size={15} /> PNG
          </button>
        </div>
      </header>

      <div className="relative flex-1">
        {importNotice && (
          <div className="absolute right-3 top-3 z-30 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
            {importNotice}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
            setSelectedId(n.id);
            const groupId = n.data.person.groupId;
            if (groupId) {
              setNodes((items) =>
                items.map((node) => ({
                  ...node,
                  selected: node.data.person.groupId === groupId,
                }))
              );
            }
          }}
          onPaneClick={() => setSelectedId(null)}
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
          selectionOnDrag={!readOnly && !isCompact}
          panOnDrag={isCompact ? true : [1, 2]}
          multiSelectionKeyCode={['Meta', 'Control']}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="#cbd5e1" />
          <Controls
            showInteractive={false}
            className="!bottom-3 !left-3 sm:!bottom-4 sm:!left-4"
          />
          <MiniMap
            pannable
            zoomable
            className="!hidden !bg-slate-50 sm:!block"
          />
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
          </div>
        )}

        {/* buying-committee coverage strip */}
        {people.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:left-4 sm:top-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Coverage · {people.length} people
            </div>
            <div className="hidden flex-wrap gap-1.5 sm:flex">
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
              initiatives={meta?.initiatives}
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
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">Version history</h2>
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 sm:items-center sm:p-4">
          <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Strategic initiatives
                </h2>
                <p className="text-xs text-slate-500">
                  Recent signals mapped to teams and evidence-backed sales hypotheses.
                </p>
              </div>
              <button
                onClick={() => setShowInitiatives(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              {meta?.initiatives?.map((initiative) => (
                <article
                  key={initiative.name}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-800">
                      {initiative.name}
                    </h3>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                      {initiative.category}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{initiative.summary}</p>
                  {(initiative.relevantTeams.length > 0 ||
                    initiative.relevantPeople.length > 0) && (
                    <p className="mt-2 text-xs text-slate-500">
                      <b>Relevant:</b>{' '}
                      {[
                        ...initiative.relevantTeams,
                        ...initiative.relevantPeople,
                      ].join(' · ')}
                    </p>
                  )}
                  {initiative.salesAngles.length > 0 && (
                    <div className="mt-3 rounded-lg bg-amber-50 p-3">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Sales hypotheses
                      </div>
                      <ul className="space-y-1 text-xs text-amber-950">
                        {initiative.salesAngles.map((angle) => (
                          <li key={angle}>• {angle}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {initiative.evidence.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {initiative.evidence.map((source) =>
                        source.startsWith('http') ? (
                          <a
                            key={source}
                            href={source}
                            target="_blank"
                            rel="noreferrer"
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
