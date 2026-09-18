import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { Plus } from 'lucide-react';

export interface MoreNodeData {
  count: number;
  lane: string;
  onExpand?: (lane: string) => void;
}

/**
 * Placeholder tile at the end of a collapsed lane — expands the lane on click.
 * Render-time only, like lane headers: never persisted into MapState.
 */
function MoreNode({ data }: NodeProps<MoreNodeData>) {
  return (
    <button
      type="button"
      onClick={() => data.onExpand?.(data.lane)}
      aria-label={`Show ${data.count} more in ${data.lane}`}
      className="nodrag flex h-[72px] min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-xs font-semibold text-slate-500 transition hover:border-[#5b4cf0] hover:bg-[#f5f4ff] hover:text-[#5b4cf0] sm:h-[52px]"
    >
      <Plus size={14} className="shrink-0" />
      {data.count} more
    </button>
  );
}

export default memo(MoreNode);
