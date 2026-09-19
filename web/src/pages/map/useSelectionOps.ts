import { useCallback, useMemo, useRef } from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';
import type { FlowEdge } from '../../lib/flowEdges';
import { applyLayout } from '../../lib/layout';
import { describeGrouping } from '../../lib/agentCanvas';
import type {
  AgentGroupingField,
  AgentRelationshipView,
} from '../../lib/agentCanvas';
import type { PersonNodeData } from '../../components/PersonNode';
import type { BuyingRole, Person } from '../../types';
import { edgeToMap, snapshot, type CanvasSnapshot } from './helpers';

export function useSelectionOps(deps: {
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
  people: Person[];
  readOnly: boolean;
  rf: ReactFlowInstance;
  nodesRef: { current: Node<PersonNodeData>[] };
  edgesRef: { current: FlowEdge[] };
  setNodes: (ns: Node<PersonNodeData>[]) => void;
  setEdges: (es: FlowEdge[]) => void;
  setSelectedId: (id: string | null) => void;
  recordHistory: () => void;
  markDirty: (ns: Node<PersonNodeData>[], es: FlowEdge[]) => void;
}) {
  const {
    nodes,
    edges,
    people,
    readOnly,
    rf,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    setSelectedId,
    recordHistory,
    markDirty,
  } = deps;

  const clipboard = useRef<CanvasSnapshot | null>(null);
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
  }, [selectedNodes, recordHistory, setNodes, markDirty, edgesRef, nodesRef]);

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
    [selectedNodes, recordHistory, setNodes, markDirty, edgesRef, nodesRef]
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
  }, [selectedNodes, recordHistory, setNodes, setEdges, markDirty, setSelectedId, edgesRef, nodesRef]);

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
  }, [selectedNodes, recordHistory, setNodes, markDirty, edgesRef, nodesRef]);

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
  }, [selectedNodes, recordHistory, setNodes, markDirty, edgesRef, nodesRef]);

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
  }, [selectedNodes, recordHistory, setNodes, markDirty, edgesRef, nodesRef]);

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
    [nodes, selectedNodes, edges, recordHistory, setNodes, markDirty, rf, setSelectedId, edgesRef, nodesRef]
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
    [recordHistory, setEdges, markDirty, edgesRef, nodesRef]
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
    edgesRef,
    nodesRef,
    readOnly,
    recordHistory,
    setNodes,
    setEdges,
    markDirty,
  ]);

  return {
    selectedNodes,
    alignTop,
    assignRole,
    deleteSelection,
    distributeHorizontally,
    groupSelection,
    ungroupSelection,
    semanticGroup,
    setRelationshipView,
    previewGroup,
    copySelection,
    pasteSelection,
  };
}
