import type { ChangeEvent, RefObject } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  Compass,
  Download,
  FileSpreadsheet,
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
  Undo2,
  UserCheck,
  UserPlus,
  Users,
  Wand2,
  Waypoints,
} from 'lucide-react';
import RailButton, { RailSeparator } from '../../components/RailButton';
import type { LaneGrouping } from '../../lib/layout';

export default function MapRail(props: {
  isMobile: boolean;
  readOnly: boolean;
  viewMode: 'canvas' | 'roster';
  setViewMode: (mode: 'canvas' | 'roster') => void;
  setViewModeTouched: (touched: boolean) => void;
  rosterCounts: {
    suggested: number;
    added: number;
    dismissed: number;
  } | null;
  showRoster: boolean;
  setShowRoster: (open: boolean | ((v: boolean) => boolean)) => void;
  showSuggest: boolean;
  setShowSuggest: (open: boolean | ((v: boolean) => boolean)) => void;
  setSelectedId: (id: string | null) => void;
  setDeepResearchFocus: (focus: string) => void;
  setShowDeepResearch: (open: boolean) => void;
  setBriefingEntry: (
    entry: 'dashboard' | 'direct' | 'spotlight' | 'toolbar'
  ) => void;
  setShowBriefing: (open: boolean) => void;
  setShowStrategy: (open: boolean) => void;
  setShowMeetings: (open: boolean) => void;
  undo: () => void;
  redo: () => void;
  pastLength: number;
  futureLength: number;
  addPerson: () => void;
  laneGrouping: LaneGrouping;
  autoLayout: (mode?: LaneGrouping | 'hierarchy') => void;
  crmInput: RefObject<HTMLInputElement>;
  importCrmCsv: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  openHistory: () => void;
  setShowChanges: (open: boolean) => void;
  initiativeCount: number;
  setShowInitiatives: (open: boolean) => void;
  exportPng: () => void;
  exportAccountPlan: () => void;
  exportingAccountPlan: boolean;
  exportDisabled: boolean;
  setShowFeedback: (open: boolean) => void;
  setShowShare: (open: boolean) => void;
}) {
  const {
    isMobile,
    readOnly,
    viewMode,
    setViewMode,
    setViewModeTouched,
    rosterCounts,
    showRoster,
    setShowRoster,
    showSuggest,
    setShowSuggest,
    setSelectedId,
    setDeepResearchFocus,
    setShowDeepResearch,
    setBriefingEntry,
    setShowBriefing,
    setShowStrategy,
    setShowMeetings,
    undo,
    redo,
    pastLength,
    futureLength,
    addPerson,
    laneGrouping,
    autoLayout,
    crmInput,
    importCrmCsv,
    openHistory,
    setShowChanges,
    initiativeCount,
    setShowInitiatives,
    exportPng,
    exportAccountPlan,
    exportingAccountPlan,
    exportDisabled,
    setShowFeedback,
    setShowShare,
  } = props;

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
        label={isMobile && viewMode === 'roster' ? 'Show canvas' : 'Canvas'}
        active={viewMode === 'canvas'}
        onClick={() => {
          setViewModeTouched(true);
          setViewMode('canvas');
        }}
      />
      <RailButton
        icon={<Rows3 size={16} />}
        label="Roster"
        active={viewMode === 'roster'}
        onClick={() => {
          setViewModeTouched(true);
          setViewMode('roster');
        }}
      />
      <RailButton
        icon={<Users size={16} />}
        label={
          rosterCounts === null
            ? 'Suggested'
            : `Suggested (${rosterCounts.suggested})`
        }
        active={showRoster}
        onClick={() => {
          setSelectedId(null);
          setShowSuggest(false);
          setShowRoster((value) => !value);
        }}
      />
      {!readOnly && (
        <>
          <RailSeparator />
          <RailButton
            icon={<Wand2 size={16} />}
            label="Suggest org chart"
            active={showSuggest}
            onClick={() => {
              setShowRoster(false);
              setShowSuggest((value) => !value);
            }}
          />
          <RailButton
            icon={<Sparkles size={16} />}
            label="Deep research"
            onClick={() => {
              setDeepResearchFocus('');
              setShowDeepResearch(true);
            }}
          />
          <RailButton
            icon={<Radar size={16} />}
            label="Briefing"
            onClick={() => {
              setBriefingEntry('toolbar');
              setShowBriefing(true);
            }}
          />
          <RailButton
            icon={<Compass size={16} />}
            label="Strategy"
            onClick={() => setShowStrategy(true)}
          />
          <RailButton
            icon={<UserCheck size={16} />}
            label="Meetings"
            onClick={() => setShowMeetings(true)}
          />
          <RailSeparator />
          <RailButton
            icon={<Undo2 size={16} />}
            label="Undo"
            onClick={undo}
            disabled={pastLength === 0}
          />
          <RailButton
            icon={<Redo2 size={16} />}
            label="Redo"
            onClick={redo}
            disabled={futureLength === 0}
          />
          <RailButton
            icon={<UserPlus size={16} />}
            label="Add person"
            onClick={() => addPerson()}
          />
          <RailButton
            icon={<LayoutGrid size={16} />}
            label="Arrange by department"
            active={laneGrouping === 'department'}
            onClick={() => autoLayout('department')}
          />
          <RailButton
            icon={<Network size={16} />}
            label="Arrange by team"
            active={laneGrouping === 'team'}
            onClick={() => autoLayout('team')}
          />
          <RailButton
            icon={<Handshake size={16} />}
            label="Met vs unmet by team"
            active={laneGrouping === 'met'}
            onClick={() => autoLayout('met')}
          />
          <RailButton
            icon={<FileUp size={16} />}
            label="Import CRM"
            onClick={() => crmInput.current?.click()}
          />
          <input
            ref={crmInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="Import CRM CSV"
            className="hidden"
            onChange={(event) => void importCrmCsv(event)}
          />
          <RailButton
            icon={<History size={16} />}
            label="History"
            onClick={openHistory}
          />
          <RailButton
            icon={<BellRing size={16} />}
            label="Changes"
            onClick={() => setShowChanges(true)}
          />
          {initiativeCount > 0 && (
            <RailButton
              icon={<Lightbulb size={16} />}
              label="Initiatives"
              onClick={() => setShowInitiatives(true)}
            />
          )}
        </>
      )}
      <RailSeparator />
      <RailButton
        icon={<Download size={16} />}
        label="Export PNG"
        onClick={exportPng}
      />
      <RailButton
        icon={<FileSpreadsheet size={16} />}
        label={
          exportingAccountPlan
            ? 'Exporting account plan…'
            : 'Export account plan (.xlsx)'
        }
        onClick={exportAccountPlan}
        disabled={exportDisabled}
      />
      <RailButton
        icon={<MessageSquare size={16} />}
        label="Send feedback"
        onClick={() => setShowFeedback(true)}
      />
      <div className="flex-1" />
      {!readOnly && (
        <RailButton
          icon={<Share2 size={16} />}
          label="Share"
          accent
          onClick={() => setShowShare(true)}
        />
      )}
    </nav>
  );
}
