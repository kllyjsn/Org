import { useCallback } from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';
import type { PaletteAction } from '../../components/CommandPalette';
import {
  describePersonEdit,
  describeRelationship,
  describeRelationshipView,
} from '../../lib/agentCanvas';
import type {
  AgentCommandResult,
  AgentGroupingField,
  AgentRelationshipView,
} from '../../lib/agentCanvas';
import { matchesAllTokens } from '../../lib/searchText';
import type { PersonNodeData } from '../../components/PersonNode';
import type {
  AccountAgentAction,
  BuyingRole,
  Person,
} from '../../types';
import type { LaneGrouping } from '../../lib/layout';

export function useMapCommands(deps: {
  readOnly: boolean;
  rf: ReactFlowInstance;
  people: Person[];
  nodes: Node<PersonNodeData>[];
  selectedNodes: Node<PersonNodeData>[];
  selectedId: string | null;
  autoLayout: (mode?: LaneGrouping | 'hierarchy') => void;
  previewGroup: (
    field: AgentGroupingField,
    scope: 'map' | 'selection',
    explicitIds?: Set<string>
  ) => AgentCommandResult;
  setRelationshipView: (view: AgentRelationshipView) => string;
  updatePerson: (updated: Person) => void;
  focusPeople: (matches: Person[]) => void;
  addPerson: (draft?: Partial<Person>) => void;
  setManager: (personId: string, managerId: string | null) => void;
  addInfluence: (fromId: string, toId: string, label: string) => void;
  setSelectedId: (id: string | null) => void;
  setShowAllLanes: (open: boolean) => void;
  setExpandedLanes: (lanes: Set<string>) => void;
  setCollapsedLanes: (lanes: Set<string>) => void;
  setDeepResearchFocus: (focus: string) => void;
  setShowDeepResearch: (open: boolean) => void;
  setBriefingEntry: (
    entry: 'dashboard' | 'direct' | 'spotlight' | 'toolbar'
  ) => void;
  setShowBriefing: (open: boolean) => void;
  setShowStrategy: (open: boolean) => void;
  setShowChanges: (open: boolean) => void;
  setShowInitiatives: (open: boolean) => void;
  setShowShare: (open: boolean) => void;
}) {
  const {
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
  } = deps;

  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      if (action === 'layout') autoLayout();
      if (action === 'briefing') {
        setBriefingEntry('spotlight');
        setShowBriefing(true);
      }
      if (action === 'overview') {
        setSelectedId(null);
        void rf.fitView({ padding: 0.2, duration: 450 });
      }
      if (action === 'strategy') setShowStrategy(true);
      if (action === 'changes') setShowChanges(true);
      if (action === 'initiatives') setShowInitiatives(true);
      if (action === 'share') setShowShare(true);
    },
    [
      autoLayout,
      rf,
      setBriefingEntry,
      setShowBriefing,
      setSelectedId,
      setShowStrategy,
      setShowChanges,
      setShowInitiatives,
      setShowShare,
    ]
  );

  const runAgentCommand = useCallback(
    (raw: string): AgentCommandResult | null => {
      const say = (message: string): AgentCommandResult => ({ message });
      const query = raw.trim();
      const lower = query.toLowerCase();
      if (!query) return say('I couldn’t find a command to run.');

      // Lane re-arrangement by team or met-status — map-wide phrasing goes to
      // the lane layout; selection-scoped phrasing stays on preview grouping.
      const laneVerb =
        /\b(arrange|organize|organise|separate|split|divide|layout|tidy|bucket|break|group)\b/.test(
          lower
        );
      const wantsMetLanes =
        (laneVerb || /\b(show|view|filter|who)\b/.test(lower)) &&
        /\b(met|unmet)\b/.test(lower);
      const wantsTeamLanes = laneVerb && /\bteams?\b/.test(lower);
      if (
        (wantsTeamLanes || wantsMetLanes) &&
        !/\b(this|these|selected|selection)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        autoLayout(wantsMetLanes ? 'met' : 'team');
        return say(
          wantsMetLanes
            ? 'I split the map into Met with and Haven’t met lanes by team.'
            : 'I arranged the org chart into team lanes.'
        );
      }

      const groupField: AgentGroupingField = /\bproduct/.test(lower)
        ? 'productLine'
        : /\b(team|sub-?team)s?\b/.test(lower)
          ? 'team'
          : 'businessUnit';
      const wantsGrouping =
        /\b(split|group|cluster|reorganize|reorganise|break|divide|organize|organise|arrange|sort|bucket)\b/.test(
          lower
        ) &&
        (/\b(by|into|using)\s+(department|departments|function|functions|business units?|teams?|sub-?teams?|products?|product lines?|orgs?|org chart)\b/.test(
          lower
        ) ||
          /\b(group|teams?|products?|business units?|departments?|functions?|lanes?)\b/.test(
            lower
          ));
      if (wantsGrouping) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const selectionIds = new Set(
          /\b(this|these|selected|selection|current group)\b/.test(lower)
            ? selectedNodes.map((node) => node.id)
            : []
        );
        const selectedGroup = selectedId
          ? nodes.find(
              (node) =>
                node.id === selectedId && Boolean(node.data.person.groupId)
            )?.data.person.groupId
          : undefined;
        if (selectedGroup && /\b(this|these|selected|selection|current group)\b/.test(lower)) {
          nodes.forEach((node) => {
            if (node.data.person.groupId === selectedGroup) {
              selectionIds.add(node.id);
            }
          });
        }
        const scope = selectionIds.size > 0 ? 'selection' : 'map';
        return previewGroup(groupField, scope, selectionIds);
      }
      if (
        /\b(show|display|filter|view|use|switch to)\b/.test(lower) &&
        /\b(influence|influences|reporting|reports|hierarchy|managerial|all relationships)\b/.test(lower)
      ) {
        const view: AgentRelationshipView = /influence/.test(lower)
          ? 'influence'
          : /all/.test(lower)
            ? 'all'
            : 'reports';
        return describeRelationshipView(view, () => setRelationshipView(view));
      }
      if (/(arrange|organize|layout|tidy)/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const hierarchy = /\b(reporting|reports|hierarchy|tree|manager)\b/.test(
          lower
        );
        autoLayout(hierarchy ? 'hierarchy' : 'department');
        return say(
          hierarchy
            ? 'I arranged the org chart by reporting line.'
            : 'I arranged the org chart into department lanes.'
        );
      }
      if (
        /\b(overview|show all|whole (account|map|chart|canvas|org)|zoom out|one view|single view|see (everyone|everything|the whole)|fit)\b/.test(
          lower
        )
      ) {
        setSelectedId(null);
        setShowAllLanes(true);
        setExpandedLanes(new Set());
        setCollapsedLanes(new Set());
        window.setTimeout(
          () => void rf.fitView({ padding: 0.2, duration: 450 }),
          80
        );
        return say('Showing the whole account.');
      }
      if (/\b(research|enrich|find more people)\b/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        setDeepResearchFocus(
          query
            .replace(/\b(deep research|research|enrich|find more people)\b/gi, '')
            .replace(/\b(for|about|on|in)\b/gi, '')
            .trim()
        );
        setShowDeepResearch(true);
        return say('Opening targeted deep research.');
      }
      if (
        /\b(brief me|daily brief|account pulse|next best action|what should i do|what matters now)\b/.test(
          lower
        )
      ) {
        setBriefingEntry('spotlight');
        setShowBriefing(true);
        return say('Opening the account briefing.');
      }
      if (
        /\b(build|open|show|create|generate|view)\b.*\b(account brief|relationship path|deal plan|account strategy|path in)\b/.test(
          lower
        ) ||
        /^(account brief|relationship path|deal plan|account strategy)$/.test(lower)
      ) {
        setShowStrategy(true);
        return say('Opening the account strategy.');
      }
      if (
        /\b(what changed|show changes|show account changes|change alerts?|account movement)\b/.test(
          lower
        )
      ) {
        setShowChanges(true);
        return say('Opening account change alerts.');
      }
      if (
        /\b(open|show|view|review)\b.*\b(initiative|strategic priorities|why now)\b/.test(
          lower
        ) ||
        lower === 'why now'
      ) {
        setShowInitiatives(true);
        return say('Opening initiative intelligence.');
      }
      if (/\bshare\b/.test(lower)) {
        setShowShare(true);
        return say('Opening sharing controls.');
      }

      const matchedPeople = [...people]
        .sort((a, b) => b.name.length - a.name.length)
        .filter((person) => lower.includes(person.name.toLowerCase()));
      const matchedPerson = matchedPeople[0];

      if (lower.includes('reports to') && matchedPeople.length >= 2) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const divider = lower.indexOf('reports to');
        const subordinate = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) < divider
        );
        const manager = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) > divider
        );
        if (subordinate && manager) {
          return describeRelationship(manager, subordinate, 'reports', false, () => {
            setManager(subordinate.id, manager.id);
            focusPeople([subordinate, manager]);
            return `${subordinate.name} now reports to ${manager.name}.`;
          });
        }
      }

      if (matchedPeople.length >= 2 && /\binfluences?\b/.test(lower)) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const divider = lower.search(/\binfluences?\b/);
        const from = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) < divider
        );
        const to = matchedPeople.find(
          (person) => lower.indexOf(person.name.toLowerCase()) > divider
        );
        if (from && to) {
          return describeRelationship(from, to, 'influence', false, () => {
            addInfluence(from.id, to.id, 'influences');
            focusPeople([from, to]);
            return `Added an influence link from ${from.name} to ${to.name}.`;
          });
        }
      }

      const roles: { terms: string[]; role: BuyingRole; label: string }[] = [
        { terms: ['economic buyer', 'budget owner'], role: 'economic_buyer', label: 'economic buyer' },
        { terms: ['decision maker'], role: 'decision_maker', label: 'decision maker' },
        { terms: ['technical buyer'], role: 'technical_buyer', label: 'technical buyer' },
        { terms: ['champion'], role: 'champion', label: 'champion' },
        { terms: ['influencer'], role: 'influencer', label: 'influencer' },
        { terms: ['blocker'], role: 'blocker', label: 'blocker' },
      ];
      const matchedRole = roles.find(({ terms }) =>
        terms.some((term) => lower.includes(term))
      );
      if (
        matchedPerson &&
        matchedRole &&
        /\b(make|mark|set|assign)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        return describePersonEdit(
          matchedPerson,
          [{ label: 'buying role', value: matchedRole.label }],
          () => {
            updatePerson({ ...matchedPerson, role: matchedRole.role });
            focusPeople([matchedPerson]);
            return `${matchedPerson.name} is now marked as ${matchedRole.label}.`;
          }
        );
      }

      const titleMatch = query.match(/\btitle\s+to\s+(.+)$/i);
      if (
        matchedPerson &&
        titleMatch &&
        /\b(set|change|update)\b/.test(lower)
      ) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const title = titleMatch[1].trim();
        return describePersonEdit(
          matchedPerson,
          [{ label: 'title', value: title }],
          () => {
            updatePerson({ ...matchedPerson, title });
            focusPeople([matchedPerson]);
            return `Updated ${matchedPerson.name}’s title to ${title}.`;
          }
        );
      }

      const teamMove = lower.match(
        /^(?:move|put) .+? (?:to|on|in) (?:the )?(.+?)(?: team)?$/
      );
      if (matchedPerson && teamMove) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const team = query
          .slice(query.toLowerCase().lastIndexOf(teamMove[1]))
          .replace(/\s+team$/i, '');
        return describePersonEdit(
          matchedPerson,
          [{ label: 'team', value: team, inferred: true }],
          () => {
            updatePerson({
              ...matchedPerson,
              team,
              teamEvidence: 'inferred',
            });
            focusPeople([matchedPerson]);
            return `Moved ${matchedPerson.name} to the ${team} team as an inferred assignment.`;
          }
        );
      }

      const addMatch = query.match(
        /^(?:add|create)\s+(.+?)(?:\s+(?:as|,)\s+(.+))?$/i
      );
      if (addMatch) {
        if (readOnly) return say('I couldn’t edit this read-only map.');
        const name = addMatch[1].trim();
        const title = addMatch[2]?.trim() ?? '';
        addPerson({ name, title });
        return say(`Added ${name}${title ? ` as ${title}` : ''}.`);
      }

      if (matchedPerson) {
        focusPeople([matchedPerson]);
        return say(`Found ${matchedPerson.name}.`);
      }

      const searchQuery = lower
        .replace(
          /\b(show|find|open|focus|take me to|filter|people|person|everyone|everybody|folks|members?|anyone|the|a|an|teams?|departments?|products?|in|of|to|for|me|my|all|any|from|with|at|on|by|who|whom|is|are|list|display|view|only|into|working|work|us|now|please|and|or)\b/g,
          ' '
        )
        .trim();
      const matches = people.filter((person) => {
        const text = [
          person.name,
          person.title,
          person.department,
          person.team,
          person.productLine,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return matchesAllTokens(text, searchQuery);
      });
      if (matches.length > 0) {
        focusPeople(matches);
        return say(
          `Found ${matches.length} ${matches.length === 1 ? 'person' : 'people'}.`
        );
      }

      return null;
    },
    [
      people,
      readOnly,
      autoLayout,
      rf,
      updatePerson,
      focusPeople,
      addPerson,
      setManager,
      addInfluence,
      selectedId,
      selectedNodes,
      nodes,
      previewGroup,
      setRelationshipView,
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
    ]
  );

  const runAccountAgentAction = useCallback(
    (action: AccountAgentAction) => {
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
    },
    [
      focusPeople,
      people,
      readOnly,
      setShowStrategy,
      setShowInitiatives,
      setDeepResearchFocus,
      setShowDeepResearch,
    ]
  );

  return { runPaletteAction, runAgentCommand, runAccountAgentAction };
}
