import { memo } from 'react';
import { Handle, NodeResizer, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { StickyNote } from 'lucide-react';
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
    p.researchStatus === 'possibly_stale';

  return (
    <div
      className={`h-full min-h-[74px] w-full min-w-[210px] rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition ${
        selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'
      } ${
        unverified || needsReview
          ? 'border-dashed border-amber-300 bg-amber-50/40'
          : ''
      }`}
    >
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={210}
        minHeight={74}
        lineClassName="!border-indigo-400"
        handleClassName="!h-4 !w-4 !border-indigo-500 !bg-white sm:!h-2.5 sm:!w-2.5"
      />
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${deptColor(p.department)}`}
        >
          {initials(p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">
            {p.name}
          </div>
          <div className="truncate text-xs text-slate-500">{p.title}</div>
        </div>
        {p.notes && <StickyNote size={13} className="mt-0.5 shrink-0 text-amber-500" />}
      </div>
      {(role.label || p.department || unverified) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {role.label && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${role.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${role.dot}`} />
              {role.label}
            </span>
          )}
          {p.department && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
              {p.department}
            </span>
          )}
          {p.team && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
              {p.team}
              {p.teamEvidence === 'inferred' ? ' · inferred' : ''}
            </span>
          )}
          {needsReview && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
              {p.researchStatus === 'conflicting' ? 'title conflict' : 'may be stale'}
            </span>
          )}
          {unverified && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              unverified
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

export default memo(PersonNode);
