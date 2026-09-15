import { memo } from 'react';
import { Handle, NodeResizer, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { BookOpen, StickyNote } from 'lucide-react';
import { deptColor, initials, ROLE_META } from '../lib/colors';
import type { Person } from '../types';

export interface PersonNodeData {
  person: Person;
  readOnly?: boolean;
}

function PersonNode({ data, selected }: NodeProps<PersonNodeData>) {
  const p = data.person;
  const role = ROLE_META[p.role];
  const unverified = p.confidence === 'low';
  const needsReview =
    p.researchStatus === 'conflicting' ||
    p.researchStatus === 'possibly_stale' ||
    p.freshness === 'stale';

  return (
    <div
      className={`relative h-full min-h-[86px] w-full min-w-[220px] overflow-hidden rounded-2xl border bg-white px-3.5 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,.08)] transition ${
        selected ? 'border-[#5b4cf0] ring-4 ring-[#5b4cf0]/15' : 'border-slate-200'
      } ${
        unverified || needsReview
          ? 'border-dashed border-amber-300'
          : ''
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 w-1 ${
          role.label ? role.dot : 'bg-slate-200'
        }`}
      />
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={210}
        minHeight={74}
        lineClassName="!border-indigo-400"
        handleClassName="!h-4 !w-4 !border-indigo-500 !bg-white sm:!h-2.5 sm:!w-2.5"
      />
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="flex items-start gap-2.5 pl-1">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-sm ${deptColor(p.department)}`}
        >
          {initials(p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight tracking-[-0.015em] text-slate-950">
            {p.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{p.title}</div>
        </div>
        {p.notes && <StickyNote size={13} className="mt-0.5 shrink-0 text-amber-500" />}
      </div>
      {(role.label || p.department || unverified) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1 pl-1">
          {role.label && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${role.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${role.dot}`} />
              {role.label}
            </span>
          )}
          {p.team && (
            <span className="max-w-28 truncate rounded-full bg-[#eeecff] px-2 py-0.5 text-[9px] font-medium text-[#5144d7]">
              {p.team}
              {p.teamEvidence === 'inferred' ? ' · inferred' : ''}
            </span>
          )}
          {!p.team && p.department && (
            <span className="max-w-28 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600">
              {p.department}
            </span>
          )}
          {needsReview && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
              {p.researchStatus === 'conflicting'
                ? 'title conflict'
                : p.freshness === 'stale'
                  ? 'refresh required'
                  : 'may be stale'}
            </span>
          )}
          {unverified && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              unverified
            </span>
          )}
          {p.sources.length > 0 && !needsReview && !unverified && (
            <span className="ml-auto flex items-center gap-1 text-[9px] font-medium text-slate-400">
              <BookOpen size={10} /> {p.sources.length}
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

export default memo(PersonNode);
