import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { deptColor } from '../lib/colors';

export interface LaneHeaderData {
  label: string;
  count: number;
  shown?: number;
  expanded?: boolean;
  onToggle?: (lane: string) => void;
}

function LaneHeaderNode({ data }: NodeProps<LaneHeaderData>) {
  const collapsible = data.shown !== undefined && data.shown < data.count;
  const expanded = data.expanded === true;
  return (
    <div className="pointer-events-none select-none">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${deptColor(
            data.label === 'Unassigned' ? null : data.label
          )}`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {data.label}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          {collapsible ? `${data.shown} of ${data.count}` : data.count}
        </span>
        {(collapsible || expanded) && data.onToggle && (
          <button
            type="button"
            onClick={() => data.onToggle?.(data.label)}
            className="nodrag pointer-events-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#5b4cf0] shadow-sm ring-1 ring-slate-200 transition hover:bg-[#f5f4ff] hover:ring-[#5b4cf0]/40"
          >
            {expanded ? 'Show fewer' : `Show all ${data.count}`}
          </button>
        )}
      </div>
      <div className="mt-1.5 h-px w-64 bg-slate-200" />
    </div>
  );
}

export default memo(LaneHeaderNode);
