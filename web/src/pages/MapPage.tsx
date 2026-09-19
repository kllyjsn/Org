import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from 'reactflow';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { api } from '../api';
import { useSession } from '../store';
import AccountBriefingModal from '../components/AccountBriefingModal';
import AccountStrategyModal from '../components/AccountStrategyModal';
import ChangeAlertsModal from '../components/ChangeAlertsModal';
import CommandPalette from '../components/CommandPalette';
import DeepResearchModal from '../components/DeepResearchModal';
import FeedbackModal from '../components/FeedbackModal';
import MeetingsImportModal from '../components/MeetingsImportModal';
import PersonPanel from '../components/PersonPanel';
import RosterDrawer from '../components/RosterDrawer';
import RosterView from '../components/RosterView';
import ShareModal from '../components/ShareModal';
import SuggestChartPanel from '../components/SuggestChartPanel';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { isBigMap } from '../lib/bigMap';
import { useIsMobile } from '../lib/useIsMobile';
import type {
  AccountAgentMessage,
  BriefingAction,
  BuyingRole,
  Persona,
} from '../types';
import { COMMITTEE_ROLES, edgeToMap, nodeTypes } from './map/helpers';
import { useMapCanvas } from './map/useMapCanvas';
import { useLanes } from './map/useLanes';
import { useMapActions } from './map/useMapActions';
import { useSelectionOps } from './map/useSelectionOps';
import { useMapCommands } from './map/useMapCommands';
import { useMapExports } from './map/useMapExports';
import { useMapHotkeys } from './map/useMapHotkeys';
import MapRail from './map/MapRail';
import MapHeader from './map/MapHeader';
import CommitteeCoverage from './map/CommitteeCoverage';
import {
  EmptyMapState,
  GhostSuggestionBar,
  LaneDensityToggle,
  PresenceCursors,
  SelectionToolbar,
} from './map/CanvasOverlays';
import HistoryModal from './map/HistoryModal';
import InitiativesModal from './map/InitiativesModal';

export { PERSONA_FILTER_EVENT } from './map/helpers';
export type { PersonaFilterDetail } from './map/helpers';

const MemoMiniMap = memo(MiniMap);

function MapInner() {
  const { mapId } = useParams<{ mapId: string }>();
  const [searchParams] = useSearchParams();
  const fixtureCount = import.meta.env.DEV
    ? Number(searchParams.get('fixture')) || 0
    : 0;
  const fixtureMode = fixtureCount > 0;
  const rf = useReactFlow();
  const viewport = useViewport();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'roster'>('canvas');
  const [viewModeTouched, setViewModeTouched] = useState(false);
  const [showMeetings, setShowMeetings] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestChart = useSession((session) => session.suggestChart);
  const confirmSuggestion = useSession((session) => session.confirm);
  const declineSuggestion = useSession((session) => session.decline);
  const confirmHighOnly = useSession((session) => session.confirmHighOnly);
  const clearSuggestion = useSession((session) => session.clearSuggestion);
  const applySuggestion = useSession((session) => session.applySuggestion);
  const personas = useSession((session) => session.personas);
  const personaCoverage = useSession((session) =>
    session.coverage && session.coverage.mapId === mapId
      ? session.coverage.data
      : null
  );
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showInitiatives, setShowInitiatives] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingEntry, setBriefingEntry] = useState<
    'dashboard' | 'direct' | 'spotlight' | 'toolbar'
  >('direct');
  const [showChanges, setShowChanges] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showDeepResearch, setShowDeepResearch] = useState(false);
  const [deepResearchFocus, setDeepResearchFocus] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const crmInput = useRef<HTMLInputElement | null>(null);

  // Phone viewports fit an entire org to ~20% zoom, which renders cards
  // unreadable, so open on the top of the hierarchy at a legible scale.
  const openingFitOptions = useMemo(
    () =>
      isMobile
        ? { padding: 0.1, minZoom: 0.62, maxZoom: 0.9 }
        : { padding: 0.2, minZoom: 0.45 },
    [isMobile]
  );
  // Anchoring the first card near the top-left at a legible zoom keeps tall
  // department lanes usable; centering a tall map can leave no whole card in
  // view on a phone.
  const anchorTopLeft = useCallback(
    (positions: { x: number; y: number }[]) => {
      if (positions.length === 0) return;
      const minX = Math.min(...positions.map((point) => point.x));
      const minY = Math.min(...positions.map((point) => point.y));
      const maxX = Math.max(...positions.map((point) => point.x));
      const spread = maxX - minX + 250;
      const rail = isMobile ? 48 : 224;
      const zoom = Math.min(
        isMobile ? 0.62 : 0.8,
        (window.innerWidth - rail - 16) / spread
      );
      rf.setViewport(
        {
          x: (isMobile ? 8 : 32) - minX * zoom,
          y: (isMobile ? 170 : 200) - minY * zoom,
          zoom,
        },
        { duration: 450 }
      );
    },
    [isMobile, rf]
  );

  const {
    mapName,
    setMapName,
    domain,
    workspaceId,
    meta,
    setMeta,
    metaRef,
    readOnly,
    researchDue,
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    people,
    rosterCounts,
    setRosterCounts,
    saveState,
    loaded,
    notFound,
    versions,
    presence,
    selfId,
    past,
    future,
    laneGrouping,
    setLaneGrouping,
    cursorRef,
    dragHistoryRecorded,
    handleNodesChange,
    handleEdgesChange,
    onConnect,
    onNodesDelete,
    openHistory,
    restoreVersion,
    markDirty,
    flushPendingPersist,
    handleRosterMapUpdated,
    recordHistory,
    undo,
    redo,
    saveName,
  } = useMapCanvas({
    mapId,
    fixtureMode,
    fixtureCount,
    isMobile,
    rf,
    openingFitOptions,
    anchorTopLeft,
    searchParams,
    selectedId,
    setSelectedId,
    setShowBriefing,
    setBriefingEntry,
    setImportNotice,
    setShowHistory,
    clearSuggestion,
    suggestChart,
  });

  useDocumentTitle(`${mapName || 'Map'} — TopDown`);

  const sellerProfile = useSession(
    (session) =>
      session.workspaces.find((workspace) => workspace.id === workspaceId)
        ?.seller_profile ?? null
  );
  const personaById = useMemo(
    () => new Map<string, Persona>(personas.map((p) => [p.id, p])),
    [personas]
  );

  const {
    expandedLanes,
    setExpandedLanes,
    collapsedLanes,
    setCollapsedLanes,
    showAllLanes,
    setShowAllLanes,
    laneOf,
    ghostPeople,
    laneItems,
    laneView,
    displayNodes,
    displayEdges,
    pendingFocus,
    relayLanes,
    lanesChanged,
  } = useLanes({
    mapId,
    nodes,
    edges,
    people,
    isMobile,
    rf,
    laneGrouping,
    suggestionMapId: suggestChart.mapId,
    suggestion: suggestChart.suggestion,
    confirmedSuggestions: suggestChart.confirmed,
    declinedSuggestions: suggestChart.declined,
    confirmSuggestion,
    declineSuggestion,
  });

  const coverage = useMemo(() => {
    const counts = new Map<BuyingRole, number>();
    for (const p of people) {
      if (p.role === 'none') continue;
      counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
    }
    return counts;
  }, [people]);
  const committeeCovered = COMMITTEE_ROLES.filter(
    (r) => (coverage.get(r) ?? 0) > 0
  ).length;

  const {
    updatePerson,
    setManager,
    addInfluence,
    applyMeetings,
    addPerson,
    focusPeople,
    focusPersona,
    deletePerson,
    autoLayout,
    handleSuggestedApplied,
    updateStrategyPlan,
  } = useMapActions({
    mapId,
    readOnly,
    isMobile,
    rf,
    nodes,
    edges,
    people,
    nodesRef,
    edgesRef,
    metaRef,
    setNodes,
    setEdges,
    setSelectedId,
    setMeta,
    laneGrouping,
    setLaneGrouping,
    laneOf,
    relayLanes,
    lanesChanged,
    setExpandedLanes,
    setCollapsedLanes,
    pendingFocus,
    personaById,
    setImportNotice,
    recordHistory,
    markDirty,
    handleRosterMapUpdated,
    setShowSuggest,
    setRosterCounts,
    anchorTopLeft,
  });

  const {
    selectedNodes,
    alignTop,
    assignRole,
    deleteSelection,
    distributeHorizontally,
    groupSelection,
    ungroupSelection,
    setRelationshipView,
    previewGroup,
    copySelection,
    pasteSelection,
  } = useSelectionOps({
    nodes,
    edges,
    people,
    readOnly,
    rf,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    setSelectedId,
    recordHistory,
    markDirty,
  });

  const { runPaletteAction, runAgentCommand, runAccountAgentAction } =
    useMapCommands({
      readOnly,
      rf,
      people,
      nodes,
      selectedNodes,
      selectedId,
      autoLayout,
      previewGroup,
      setRelationshipView,
      updatePerson,
      focusPeople,
      addPerson,
      setManager,
      addInfluence,
      setSelectedId,
      setShowAllLanes,
      setExpandedLanes,
      setCollapsedLanes,
      setDeepResearchFocus,
      setShowDeepResearch,
      setBriefingEntry,
      setShowBriefing,
      setShowStrategy,
      setShowChanges,
      setShowInitiatives,
      setShowShare,
    });

  const {
    exportingAccountPlan,
    exportPng,
    exportAccountPlan,
    importCrmCsv,
    mergeResearch,
  } = useMapExports({
    mapId,
    mapName,
    readOnly,
    rf,
    displayNodes,
    nodes,
    edges,
    nodesRef,
    edgesRef,
    meta,
    metaRef,
    setMeta,
    setNodes,
    setEdges,
    relayLanes,
    lanesChanged,
    recordHistory,
    markDirty,
    setImportNotice,
  });

  const selected = nodes.find((n) => n.id === selectedId)?.data.person ?? null;
  const bigMap = isBigMap(people.length);
  useEffect(() => {
    if (loaded && isMobile && bigMap && !viewModeTouched) {
      setViewMode('roster');
    }
  }, [loaded, isMobile, bigMap, viewModeTouched]);
  const managerOf = useMemo(() => {
    const nameById = new Map(people.map((person) => [person.id, person.name]));
    const map = new Map<string, string>();
    for (const edge of edges) {
      if (edge.data?.kind !== 'reports') continue;
      const manager = nameById.get(edge.source);
      if (manager && !map.has(edge.target)) map.set(edge.target, manager);
    }
    return map;
  }, [people, edges]);

  const knownSourceUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const p of people) {
      for (const url of p.sources ?? []) if (url) urls.add(url);
      for (const s of p.sourceDetails ?? []) if (s.url) urls.add(s.url);
    }
    for (const initiative of meta?.initiatives ?? []) {
      for (const url of initiative.evidence ?? []) if (url) urls.add(url);
      for (const s of initiative.evidenceDetails ?? []) if (s.url) urls.add(s.url);
    }
    return Array.from(urls).slice(0, 96);
  }, [people, meta]);

  useMapHotkeys({
    undo,
    redo,
    copySelection,
    pasteSelection,
    setShowCommands,
    closers: [
      [showFeedback, () => setShowFeedback(false)],
      [showDeepResearch, () => setShowDeepResearch(false)],
      [showMeetings, () => setShowMeetings(false)],
      [showShare, () => setShowShare(false)],
      [showHistory, () => setShowHistory(false)],
      [showInitiatives, () => setShowInitiatives(false)],
      [showStrategy, () => setShowStrategy(false)],
      [showBriefing, () => setShowBriefing(false)],
      [showChanges, () => setShowChanges(false)],
      [committeeOpen, () => setCommitteeOpen(false)],
      [selectedId !== null, () => setSelectedId(null)],
    ],
  });

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
        <p>Map not found or you don&apos;t have access.</p>
        <Link to="/app" className="text-indigo-600 hover:underline">
          ← Back to maps
        </Link>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const densityActive =
    laneView.hiddenCount > 0 ||
    showAllLanes ||
    collapsedLanes.size > 0 ||
    expandedLanes.size > 0;
  const selectionToolbar = !readOnly && selectedNodes.length > 1;

  return (
    <div className="flex h-full overflow-hidden bg-[#f6f7f2]">
      <MapRail
        isMobile={isMobile}
        readOnly={readOnly}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setViewModeTouched={setViewModeTouched}
        rosterCounts={rosterCounts}
        showRoster={showRoster}
        setShowRoster={setShowRoster}
        showSuggest={showSuggest}
        setShowSuggest={setShowSuggest}
        setSelectedId={setSelectedId}
        setDeepResearchFocus={setDeepResearchFocus}
        setShowDeepResearch={setShowDeepResearch}
        setBriefingEntry={setBriefingEntry}
        setShowBriefing={setShowBriefing}
        setShowStrategy={setShowStrategy}
        setShowMeetings={setShowMeetings}
        undo={undo}
        redo={redo}
        pastLength={past.length}
        futureLength={future.length}
        addPerson={addPerson}
        laneGrouping={laneGrouping}
        autoLayout={autoLayout}
        crmInput={crmInput}
        importCrmCsv={importCrmCsv}
        openHistory={openHistory}
        setShowChanges={setShowChanges}
        initiativeCount={meta?.initiatives?.length ?? 0}
        setShowInitiatives={setShowInitiatives}
        exportPng={() => void exportPng()}
        exportAccountPlan={() => void exportAccountPlan()}
        exportingAccountPlan={exportingAccountPlan}
        exportDisabled={!mapId || exportingAccountPlan}
        setShowFeedback={setShowFeedback}
        setShowShare={setShowShare}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MapHeader
          mapName={mapName}
          setMapName={setMapName}
          saveName={saveName}
          readOnly={readOnly}
          domain={domain}
          meta={meta}
          researchDue={researchDue}
          openDeepResearch={() => {
            setDeepResearchFocus('');
            setShowDeepResearch(true);
          }}
          saveState={saveState}
          presence={presence}
        />

        <main
          id="main"
          tabIndex={-1}
          className="relative min-h-0 flex-1 bg-[#f6f7f2]"
        >
          {importNotice && (
            <div
              role="status"
              className="absolute right-3 top-3 z-40 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
            >
              {importNotice}
            </div>
          )}
          {viewMode === 'roster' ? (
            <RosterView
              people={people}
              managerOf={managerOf}
              selectedId={selectedId}
              onSelect={(person) => setSelectedId(person.id)}
              fileName={mapName || 'roster'}
            />
          ) : (
            <>
              <button
                onClick={() => setShowCommands(true)}
                className="absolute left-1/2 top-3 z-30 flex w-[calc(100%_-_7rem)] max-w-md -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-white/90 bg-white/90 px-3.5 py-2.5 text-left text-sm text-slate-500 shadow-[0_12px_40px_rgba(15,23,42,.12)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_45px_rgba(15,23,42,.16)] sm:top-4 sm:px-4"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eeecff] text-[#5b4cf0]">
                  <Search size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  Search or ask TopDown
                </span>
                <Sparkles size={14} className="shrink-0 text-[#5b4cf0]" />
                <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 sm:block">
                  ⌘K
                </kbd>
              </button>
              <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                nodesFocusable
                edgesFocusable
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onNodesDelete={onNodesDelete}
                onNodeDragStart={() => {
                  if (!dragHistoryRecorded.current) {
                    recordHistory();
                    dragHistoryRecorded.current = true;
                  }
                }}
                onNodeDragStop={() => {
                  dragHistoryRecorded.current = false;
                }}
                onNodeClick={(_, n) => {
                  if (n.type !== 'person') return;
                  setSelectedId(n.id);
                  const groupId = n.data.person.groupId;
                  if (groupId) {
                    const next = nodesRef.current.map((node) => ({
                      ...node,
                      selected: node.data.person.groupId === groupId,
                    }));
                    nodesRef.current = next;
                    setNodes(next);
                  }
                }}
                onPaneClick={() => setSelectedId(null)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  const nodeEl = (event.target as HTMLElement).closest<HTMLElement>(
                    '.react-flow__node'
                  );
                  const id = nodeEl?.dataset.id;
                  if (!id || id.startsWith('lane:') || id.startsWith('more:')) return;
                  const person = people.find((p) => p.id === id);
                  if (!person) return;
                  event.preventDefault();
                  setSelectedId(id);
                  if (person.groupId) {
                    setNodes((items) =>
                      items.map((node) => ({
                        ...node,
                        selected: node.data.person.groupId === person.groupId,
                      }))
                    );
                  }
                }}
                onPointerMove={(event) => {
                  cursorRef.current = rf.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                nodeTypes={nodeTypes}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable
                selectionOnDrag={false}
                selectionKeyCode={readOnly ? null : 'Shift'}
                panOnDrag
                multiSelectionKeyCode={['Meta', 'Control']}
                deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
                fitView
                fitViewOptions={openingFitOptions}
                minZoom={0.2}
                onlyRenderVisibleElements
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={28} size={1} color="#d9ddd4" />
                <Controls
                  showInteractive={false}
                  fitViewOptions={openingFitOptions}
                  className="max-sm:!hidden !bottom-4 !left-4"
                />
                {!isMobile && !laneItems.some((node) => node.dragging) && (
                  <MemoMiniMap
                    pannable
                    zoomable
                    nodeStrokeWidth={3}
                    nodeColor={bigMap ? () => '#cbd5e1' : undefined}
                    maskColor={bigMap ? 'rgba(241,245,249,0.72)' : undefined}
                    className="!bg-slate-50"
                  />
                )}
              </ReactFlow>

              <PresenceCursors
                presence={presence}
                selfId={selfId}
                viewport={viewport}
              />

              {selectionToolbar && (
                <SelectionToolbar
                  selectedNodes={selectedNodes}
                  alignTop={alignTop}
                  distributeHorizontally={distributeHorizontally}
                  groupSelection={groupSelection}
                  ungroupSelection={ungroupSelection}
                  copySelection={copySelection}
                  pasteSelection={pasteSelection}
                  assignRole={assignRole}
                  deleteSelection={deleteSelection}
                />
              )}

              {ghostPeople.length > 0 && (
                <GhostSuggestionBar
                  ghostPeople={ghostPeople}
                  isMobile={isMobile}
                  applying={suggestChart.applying}
                  mapId={mapId}
                  applySuggestion={applySuggestion}
                  flushPendingPersist={flushPendingPersist}
                  onApplied={handleSuggestedApplied}
                  confirmHighOnly={confirmHighOnly}
                  setShowSuggest={setShowSuggest}
                />
              )}

              {/* density control — collapse/expand every lane at once */}
              {densityActive && (
                <LaneDensityToggle
                  hiddenCount={laneView.hiddenCount}
                  shownCount={laneView.shownCount}
                  totalCount={people.length + ghostPeople.length}
                  raised={selectionToolbar}
                  setShowAllLanes={setShowAllLanes}
                  setExpandedLanes={setExpandedLanes}
                  setCollapsedLanes={setCollapsedLanes}
                />
              )}

              <CommitteeCoverage
                people={people}
                personaCoverage={personaCoverage}
                coverage={coverage}
                committeeCovered={committeeCovered}
                personaById={personaById}
                focusPersona={focusPersona}
                readOnly={readOnly}
                committeeOpen={committeeOpen}
                setCommitteeOpen={setCommitteeOpen}
                selectionRaised={selectedNodes.length > 1}
                densityRaised={densityActive}
              />

              {people.length === 0 && ghostPeople.length === 0 && (
                <EmptyMapState
                  readOnly={readOnly}
                  onSuggest={() => {
                    setShowRoster(false);
                    setShowSuggest(true);
                  }}
                />
              )}
            </>
          )}

          <AnimatePresence>
            {showRoster && mapId && (
              <RosterDrawer
                mapId={mapId}
                domain={domain}
                readOnly={readOnly}
                onClose={() => setShowRoster(false)}
                onMapUpdated={handleRosterMapUpdated}
                onCountsChange={setRosterCounts}
                beforeAdd={flushPendingPersist}
              />
            )}
            {showSuggest && mapId && (
              <SuggestChartPanel
                mapId={mapId}
                readOnly={readOnly}
                peopleCount={people.length}
                onClose={() => setShowSuggest(false)}
                onApplied={handleSuggestedApplied}
                beforeApply={flushPendingPersist}
              />
            )}
            {selected && mapId && (
              <PersonPanel
                key={selected.id}
                mapId={mapId}
                person={selected}
                people={people}
                edges={edges.map(edgeToMap)}
                initiatives={meta?.initiatives}
                readOnly={readOnly}
                onChange={updatePerson}
                onSetManager={setManager}
                onAddInfluence={addInfluence}
                onDelete={deletePerson}
                onClose={() => setSelectedId(null)}
                onNavigate={(id) => setSelectedId(id)}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

      {showShare && mapId && (
        <ShareModal mapId={mapId} onClose={() => setShowShare(false)} />
      )}
      {showMeetings && (
        <MeetingsImportModal
          people={people}
          onApply={applyMeetings}
          onClose={() => setShowMeetings(false)} />
      )}
      {showDeepResearch && (
        <DeepResearchModal
          domain={domain}
          mapId={mapId}
          workspaceId={workspaceId}
          people={people}
          selected={selected}
          initialFocus={deepResearchFocus}
          knownSources={knownSourceUrls}
          onClose={() => {
            setShowDeepResearch(false);
            setDeepResearchFocus('');
          }}
          onMerge={mergeResearch}
        />
      )}
      {showHistory && (
        <HistoryModal
          versions={versions}
          restoreVersion={restoreVersion}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showInitiatives && (
        <InitiativesModal
          mapId={mapId}
          fixtureMode={fixtureMode}
          meta={meta}
          onClose={() => setShowInitiatives(false)}
        />
      )}
      {showStrategy && meta && (
        <AccountStrategyModal
          mapId={mapId ?? null}
          readOnly={readOnly}
          companyName={meta.companyName}
          domain={domain}
          people={people}
          edges={edges.map(edgeToMap)}
          initiatives={meta.initiatives ?? []}
          sellerProfile={sellerProfile}
          plan={meta.strategy ?? { stakeholders: {}, tasks: [], updatedAt: '' }}
          onUpdatePlan={updateStrategyPlan}
          onClose={() => setShowStrategy(false)}
          onFocusPeople={(matches) => {
            setShowStrategy(false);
            focusPeople(matches);
          }}
          onOpenDeepResearch={(focus) => {
            if (readOnly) return;
            setShowStrategy(false);
            setDeepResearchFocus(focus);
            setShowDeepResearch(true);
          }}
          onOpenInitiatives={() => {
            setShowStrategy(false);
            setShowInitiatives(true);
          }}
        />
      )}
      {showBriefing && mapId && (
        <AccountBriefingModal
          mapId={mapId}
          readOnly={readOnly}
          entry={briefingEntry}
          onClose={() => setShowBriefing(false)}
          onRunAction={(action: BriefingAction) => {
            setShowBriefing(false);
            if (action.type === 'focus_people') {
              const matches = people.filter((person) =>
                action.personIds?.includes(person.id)
              );
              if (matches.length > 0) focusPeople(matches);
            }
            if (action.type === 'open_strategy') setShowStrategy(true);
            if (action.type === 'open_initiatives') setShowInitiatives(true);
            if (action.type === 'deep_research' && !readOnly) {
              setDeepResearchFocus(action.focus ?? '');
              setShowDeepResearch(true);
            }
          }}
        />
      )}
      {showFeedback && (
        <FeedbackModal
          workspaceId={workspaceId || null}
          onClose={() => setShowFeedback(false)}
        />
      )}
      {showChanges && mapId && (
        <ChangeAlertsModal
          mapId={mapId}
          people={people}
          onClose={() => setShowChanges(false)}
          onFocusPerson={(person) => {
            setShowChanges(false);
            focusPeople([person]);
          }}
        />
      )}
      <AnimatePresence>
        {showCommands && (
          <CommandPalette
            people={people}
            readOnly={readOnly}
            hasInitiatives={(meta?.initiatives?.length ?? 0) > 0}
            onClose={() => setShowCommands(false)}
            onFocusPerson={(person) => focusPeople([person])}
            onRunAction={runPaletteAction}
            onRunCommand={runAgentCommand}
            onAskAgent={(messages: AccountAgentMessage[]) => {
              if (!mapId) throw new Error('Map not loaded');
              return api.askMap(mapId, messages);
            }}
            onRunAgentAction={runAccountAgentAction}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MapPage() {
  return (
    <ReactFlowProvider>
      <MapInner />
    </ReactFlowProvider>
  );
}
