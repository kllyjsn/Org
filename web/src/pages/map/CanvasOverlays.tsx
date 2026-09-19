import type { Node } from 'reactflow';
import {
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  Copy,
  Group,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { ROLE_META } from '../../lib/colors';
import type { PersonNodeData } from '../../components/PersonNode';
import type {
  BuyingRole,
  LoadedMap,
  MapPresence,
} from '../../types';
import { COMMITTEE_ROLES } from './helpers';

export function PresenceCursors(props: {
  presence: MapPresence[];
  selfId: string | null;
  viewport: { x: number; y: number; zoom: number };
}) {
  const { presence, selfId, viewport } = props;
  return (
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
  );
}

export function SelectionToolbar(props: {
  selectedNodes: Node<PersonNodeData>[];
  alignTop: () => void;
  distributeHorizontally: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  copySelection: () => void;
  pasteSelection: () => void;
  assignRole: (role: BuyingRole) => void;
  deleteSelection: () => void;
}) {
  const {
    selectedNodes,
    alignTop,
    distributeHorizontally,
    groupSelection,
    ungroupSelection,
    copySelection,
    pasteSelection,
    assignRole,
    deleteSelection,
  } = props;
  return (
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
      <select
        aria-label="Assign buying role to selection"
        defaultValue=""
        onChange={(event) => {
          if (event.target.value) {
            assignRole(event.target.value as BuyingRole);
            event.currentTarget.value = '';
          }
        }}
        className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none hover:bg-slate-50 sm:min-h-0"
      >
        <option value="" disabled>
          Assign role
        </option>
        {(['none', ...COMMITTEE_ROLES] as BuyingRole[]).map((role) => (
          <option key={role} value={role}>
            {ROLE_META[role].label ||
              role.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase())}
          </option>
        ))}
      </select>
      <button
        onClick={deleteSelection}
        title="Delete selection"
        className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:min-w-0"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function GhostSuggestionBar(props: {
  ghostPeople: { rosterId: string }[];
  isMobile: boolean;
  applying: boolean;
  mapId: string | undefined;
  applySuggestion: (
    mapId: string,
    mode: 'all' | 'declineAll',
    flush: () => Promise<void>
  ) => Promise<{ map: LoadedMap } | null>;
  flushPendingPersist: () => Promise<void>;
  onApplied: (map: LoadedMap) => void;
  confirmHighOnly: () => void;
  setShowSuggest: (open: boolean) => void;
}) {
  const {
    ghostPeople,
    isMobile,
    applying,
    mapId,
    applySuggestion,
    flushPendingPersist,
    onApplied,
    confirmHighOnly,
    setShowSuggest,
  } = props;
  return (
    <div className={`pointer-events-auto absolute left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 whitespace-nowrap rounded-2xl border border-white/80 bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl ${isMobile ? 'bottom-20' : 'top-16'}`}>
      <span className="font-semibold">{ghostPeople.length} suggested</span>
      <button
        type="button"
        disabled={applying || !mapId}
        onClick={() => {
          if (!mapId) return;
          void applySuggestion(mapId, 'all', flushPendingPersist).then(
            (result) => {
              if (result) onApplied(result.map);
            }
          );
        }}
        className="font-semibold text-[#5144d7] disabled:opacity-40"
      >
        Confirm all
      </button>
      <button
        type="button"
        disabled={applying}
        onClick={() => {
          confirmHighOnly();
          setShowSuggest(true);
        }}
        className="font-semibold text-[#5144d7] disabled:opacity-40"
      >
        High-confidence
      </button>
      <button
        type="button"
        disabled={applying || !mapId}
        onClick={() => {
          if (!mapId) return;
          void applySuggestion(
            mapId,
            'declineAll',
            flushPendingPersist
          ).then((result) => {
            if (result) onApplied(result.map);
          });
        }}
        className="font-semibold text-red-600 disabled:opacity-40"
      >
        Decline all
      </button>
      <button type="button" onClick={() => setShowSuggest(true)} className="font-semibold text-slate-500">
        Open panel
      </button>
    </div>
  );
}

export function LaneDensityToggle(props: {
  hiddenCount: number;
  shownCount: number;
  totalCount: number;
  raised: boolean;
  setShowAllLanes: (show: boolean) => void;
  setExpandedLanes: (lanes: Set<string>) => void;
  setCollapsedLanes: (lanes: Set<string>) => void;
}) {
  const {
    hiddenCount,
    shownCount,
    totalCount,
    raised,
    setShowAllLanes,
    setExpandedLanes,
    setCollapsedLanes,
  } = props;
  return (
    <div className={`pointer-events-auto absolute left-1/2 z-10 -translate-x-1/2 ${raised ? 'bottom-16' : 'bottom-3'}`}>
      <button
        type="button"
        onClick={() => {
          setShowAllLanes(hiddenCount > 0);
          setExpandedLanes(new Set());
          setCollapsedLanes(new Set());
        }}
        className="flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-slate-600 shadow-[0_10px_35px_rgba(15,23,42,.1)] backdrop-blur-xl transition hover:text-[#5b4cf0]"
      >
        {hiddenCount === 0 ? (
          <>Collapse lanes</>
        ) : (
          <>
            Showing {shownCount} of {totalCount}
            <span className="text-[#5b4cf0]">Show all</span>
          </>
        )}
      </button>
    </div>
  );
}

export function EmptyMapState(props: {
  readOnly: boolean;
  onSuggest: () => void;
}) {
  const { readOnly, onSuggest } = props;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 text-center text-sm text-slate-500 shadow-sm">
        This map is empty.
        {!readOnly && (
          <>
            {' '}
            Add people with <b>+ Person</b> or drag a connection between
            nodes to build reporting lines.
            <button
              type="button"
              onClick={onSuggest}
              className="pointer-events-auto mt-3 block w-full rounded-xl bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white hover:bg-[#6b5cf8]"
            >
              Suggest org chart
            </button>
          </>
        )}
      </div>
    </div>
  );
}
