import type { Edge } from 'reactflow';
import { MarkerType } from 'reactflow';

export interface EdgeData {
  kind: 'reports' | 'influence';
  label?: string | null;
  inferred?: boolean;
  hidden?: boolean;
}
export type FlowEdge = Edge<EdgeData>;

export function reportsEdge(
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

export function influenceEdge(
  from: string,
  to: string,
  label: string | null,
  id?: string
): FlowEdge {
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
