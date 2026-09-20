import type { Node } from 'reactflow';
import { influenceEdge, reportsEdge } from '../../lib/flowEdges';
import type { EdgeData, FlowEdge } from '../../lib/flowEdges';
import PersonNode from '../../components/PersonNode';
import type { PersonNodeData } from '../../components/PersonNode';
import LaneHeaderNode from '../../components/LaneHeaderNode';
import MoreNode from '../../components/MoreNode';
import type { Fn, Seniority } from '../../lib/taxonomy';
import type {
  BuyingRole,
  MapEdge,
  MapGroup,
  MapState,
} from '../../types';

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

export const nodeTypes = {
  person: PersonNode,
  lane: LaneHeaderNode,
  more: MoreNode,
};

export const COMMITTEE_ROLES: BuyingRole[] = [
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_buyer',
  'influencer',
  'blocker',
];

// Tighter column spacing on phones so two lanes fit the viewport.
export const MOBILE_COL_GAP = 270;
export const GHOST_NODE_H = 148;

export function edgeToMap(e: FlowEdge): MapEdge {
  return {
    id: e.id,
    from: e.source,
    to: e.target,
    kind: e.data?.kind ?? 'reports',
    label: e.data?.label ?? null,
    inferred: e.data?.inferred || undefined,
  };
}

export function toFlow(
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

export function toState(
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

export type SaveState = 'saved' | 'dirty' | 'saving';
export type CanvasSnapshot = {
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
};

export function snapshot(
  nodes: Node<PersonNodeData>[],
  edges: FlowEdge[]
): CanvasSnapshot {
  return structuredClone({ nodes, edges });
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === 'INPUT' ||
    element?.tagName === 'TEXTAREA' ||
    element?.isContentEditable === true
  );
}

export type { EdgeData };
