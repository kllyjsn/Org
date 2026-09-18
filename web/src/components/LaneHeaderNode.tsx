import { memo, useState } from 'react';
import type { NodeProps } from 'reactflow';
import { deptColor } from '../lib/colors';
import type { EvidenceKind } from '../types';

export interface LaneHeaderData {
  label: string;
  count: number;
  shown?: number;
  expanded?: boolean;
  /** Lane width in columns — caps the header so it doesn't bleed into a
   * lane sharing the band. */
  span?: number;
  colGap?: number;
  onToggle?: (lane: string) => void;
  suggested?: {
    confidence: 'high' | 'medium' | 'low';
    evidenceCounts: Partial<Record<EvidenceKind, number>>;
  };
}

function LaneHeaderNode({ data }: NodeProps<LaneHeaderData>) {
  const [whyOpen, setWhyOpen] = useState(false);
  const collapsible = data.shown !== undefined && data.shown < data.count;
  const expanded = data.expanded === true;
  const width =
    data.span !== undefined && data.colGap !== undefined
      ? data.span * data.colGap - 40
      : undefined;
  return (
    <div
      className="pointer-events-none select-none"
      style={width !== undefined ? { width } : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${deptColor(
            data.label === 'Unassigned' ? null : data.label
          )}`}
        />
        <span
          title={data.label}
          className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
        >
          {data.label}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          {collapsible ? `${data.shown} of ${data.count}` : data.count}
        </span>
        {(collapsible || expanded) && data.onToggle && (
          <button
            type="button"
            onClick={() => data.onToggle?.(data.label)}
            aria-label={
              expanded
                ? `Show fewer in ${data.label}`
                : `Show all ${data.count} in ${data.label}`
            }
            aria-expanded={expanded}
            className="nodrag pointer-events-auto min-h-[72px] min-w-[72px] rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#5b4cf0] shadow-sm ring-1 ring-slate-200 transition hover:bg-[#f5f4ff] hover:ring-[#5b4cf0]/40 sm:min-h-0 sm:min-w-0"
          >
            {expanded ? 'Show fewer' : `Show all ${data.count}`}
          </button>
        )}
        {data.suggested && (
          <div className="relative">
            <button
              type="button"
              className="nodrag nopan pointer-events-auto rounded-full border border-dashed border-[#5b4cf0] px-2 py-1 text-[9px] font-semibold text-[#5144d7]"
              onClick={() => setWhyOpen((open) => !open)}
            >
              Why this structure?
            </button>
            {whyOpen && (
              <div className="pointer-events-auto absolute left-0 top-8 z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Evidence</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold capitalize">
                    {data.suggested.confidence}
                  </span>
                </div>
                {(
                  [
                    ['sumble_relationship', 'Sumble relationships'],
                    ['research_reportsTo', 'research reporting lines'],
                    ['title_inference', 'inferred from titles'],
                    ['llm', 'moved by guidance'],
                  ] as const
                ).map(([kind, label]) =>
                  data.suggested?.evidenceCounts[kind] ? (
                    <div key={kind} className="py-0.5">
                      {data.suggested.evidenceCounts[kind]}{' '}
                      {kind === 'sumble_relationship' ? 'edges from ' : 'from '}
                      {label}
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-1.5 h-px w-full bg-slate-200" />
    </div>
  );
}

export default memo(LaneHeaderNode);
