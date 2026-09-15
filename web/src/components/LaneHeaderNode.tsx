import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { deptColor } from '../lib/colors';

export interface LaneHeaderData {
  label: string;
  count: number;
}

/**
 * Non-interactive group label rendered above each department/business-unit
 * lane. Derived at render time from member positions, never stored in the
 * map — dragging a card just moves the lane's bounding box on next render.
 */
function LaneHeaderNode({ data }: NodeProps<LaneHeaderData>) {
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
          {data.count}
        </span>
      </div>
      <div className="mt-1.5 h-px w-64 bg-slate-200" />
    </div>
  );
}

export default memo(LaneHeaderNode);
