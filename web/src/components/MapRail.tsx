import type { ChangeEvent, RefObject } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  Compass,
  Download,
  FileUp,
  Handshake,
  History,
  LayoutGrid,
  Lightbulb,
  MessageSquare,
  Network,
  Radar,
  Redo2,
  Rows3,
  Share2,
  Sparkles,
  PhoneCall,
  Undo2,
  UserCheck,
  UserPlus,
  Waypoints,
} from 'lucide-react';
import RailButton, { RailSeparator } from './RailButton';
import type { LaneGrouping } from '../lib/layout';

export interface MapRailProps {
  viewMode: 'canvas' | 'roster';
  onViewMode: (mode: 'canvas' | 'roster') => void;
  readOnly: boolean;
  onDeepResearch: () => void;
  onBriefing: () => void;
  onStrategy: () => void;
  onMeetings: () => void;
  onCalls: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAddPerson: () => void;
  laneGrouping: LaneGrouping;
  onAutoLayout: (mode: LaneGrouping) => void;
  onImportCrm: () => void;
  crmInputRef: RefObject<HTMLInputElement>;
  onCrmFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onHistory: () => void;
  onChanges: () => void;
  hasInitiatives: boolean;
  onInitiatives: () => void;
  onExportPng: () => void;
  onFeedback: () => void;
  onShare: () => void;
}

/**
 * Left tool rail for the map canvas — extracted verbatim from MapPage so the
 * page file stays about canvas state, not chrome.
 */
export default function MapRail({
  viewMode,
  onViewMode,
  readOnly,
  onDeepResearch,
  onBriefing,
  onStrategy,
  onMeetings,
  onCalls,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddPerson,
  laneGrouping,
  onAutoLayout,
  onImportCrm,
  crmInputRef,
  onCrmFile,
  onHistory,
  onChanges,
  hasInitiatives,
  onInitiatives,
  onExportPng,
  onFeedback,
  onShare,
}: MapRailProps) {
  return (
    <nav
      aria-label="Map tools"
      className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto bg-[#101828] py-2 sm:w-56 sm:items-stretch sm:px-3"
    >
      <Link
        to="/app"
        title="Back to accounts"
        aria-label="Back to accounts"
        className="flex h-11 w-11 shrink-0 items-center justify-center gap-2.5 rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white sm:h-9 sm:w-full sm:justify-start sm:px-3"
      >
        <ArrowLeft size={17} className="shrink-0" />
        <span className="hidden truncate text-[13px] font-medium sm:block">
          Accounts
        </span>
      </Link>
      <RailSeparator />
      <RailButton
        icon={<Waypoints size={16} />}
        label="Canvas"
        active={viewMode === 'canvas'}
        onClick={() => onViewMode('canvas')}
      />
      <RailButton
        icon={<Rows3 size={16} />}
        label="Roster"
        active={viewMode === 'roster'}
        onClick={() => onViewMode('roster')}
      />
      {!readOnly && (
        <>
          <RailSeparator />
          <RailButton
            icon={<Sparkles size={16} />}
            label="Deep research"
            onClick={onDeepResearch}
          />
          <RailButton
            icon={<Radar size={16} />}
            label="Briefing"
            onClick={onBriefing}
          />
          <RailButton
            icon={<Compass size={16} />}
            label="Strategy"
            onClick={onStrategy}
          />
          <RailButton
            icon={<UserCheck size={16} />}
            label="Meetings"
            onClick={onMeetings}
          />
          <RailButton
            icon={<PhoneCall size={16} />}
            label="Calls"
            onClick={onCalls}
          />
          <RailSeparator />
          <RailButton
            icon={<Undo2 size={16} />}
            label="Undo"
            onClick={onUndo}
            disabled={!canUndo}
          />
          <RailButton
            icon={<Redo2 size={16} />}
            label="Redo"
            onClick={onRedo}
            disabled={!canRedo}
          />
          <RailButton
            icon={<UserPlus size={16} />}
            label="Add person"
            onClick={onAddPerson}
          />
          <RailButton
            icon={<LayoutGrid size={16} />}
            label="Arrange by department"
            active={laneGrouping === 'department'}
            onClick={() => onAutoLayout('department')}
          />
          <RailButton
            icon={<Network size={16} />}
            label="Arrange by team"
            active={laneGrouping === 'team'}
            onClick={() => onAutoLayout('team')}
          />
          <RailButton
            icon={<Handshake size={16} />}
            label="Met vs unmet by team"
            active={laneGrouping === 'met'}
            onClick={() => onAutoLayout('met')}
          />
          <RailButton
            icon={<FileUp size={16} />}
            label="Import CRM"
            onClick={onImportCrm}
          />
          <input
            ref={crmInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Import CRM CSV"
            className="hidden"
            onChange={onCrmFile}
          />
          <RailButton
            icon={<History size={16} />}
            label="History"
            onClick={onHistory}
          />
          <RailButton
            icon={<BellRing size={16} />}
            label="Changes"
            onClick={onChanges}
          />
          {hasInitiatives && (
            <RailButton
              icon={<Lightbulb size={16} />}
              label="Initiatives"
              onClick={onInitiatives}
            />
          )}
        </>
      )}
      <RailSeparator />
      <RailButton
        icon={<Download size={16} />}
        label="Export PNG"
        onClick={onExportPng}
      />
      <RailButton
        icon={<MessageSquare size={16} />}
        label="Send feedback"
        onClick={onFeedback}
      />
      <div className="flex-1" />
      {!readOnly && (
        <RailButton
          icon={<Share2 size={16} />}
          label="Share"
          accent
          onClick={onShare}
        />
      )}
    </nav>
  );
}
