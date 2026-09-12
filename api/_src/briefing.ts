import type { MapChangeAlert } from './changes.js';
import type { MapState, Person, StrategicInitiative } from './types.js';

export type BriefingActionType =
  | 'focus_people'
  | 'open_strategy'
  | 'open_initiatives'
  | 'deep_research';

export interface BriefingAction {
  id: string;
  title: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  provenance: 'sourced' | 'map' | 'hypothesis';
  type: BriefingActionType;
  personIds?: string[];
  focus?: string;
  evidence: string[];
}

export interface AccountBriefing {
  generatedAt: string;
  baselineAt: string | null;
  headline: string;
  summary: string;
  changes: MapChangeAlert[];
  actions: BriefingAction[];
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function findPeople(
  people: Person[],
  initiative: StrategicInitiative
): Person[] {
  const names = new Set(initiative.relevantPeople.map(normalized));
  const teams = new Set(initiative.relevantTeams.map(normalized));
  return people.filter(
    (person) =>
      names.has(normalized(person.name)) ||
      [person.team, person.department, person.productLine].some(
        (value) => value && teams.has(normalized(value))
      )
  );
}

function sourcesFor(person: Person | undefined) {
  return person?.sources.filter(Boolean).slice(0, 3) ?? [];
}

function confidenceFor(person: Person | undefined) {
  if (!person) return 'low' as const;
  if (person.confidence === 'high' && person.sources.length > 0) {
    return 'high' as const;
  }
  return person.confidence === 'low' ? ('low' as const) : ('medium' as const);
}

export function buildAccountBriefing(
  state: MapState,
  changes: MapChangeAlert[],
  baselineAt: string | null
): AccountBriefing {
  const initiatives = state.meta.initiatives ?? [];
  const actions: BriefingAction[] = [];
  const peopleById = new Map(state.people.map((person) => [person.id, person]));
  const meaningfulChange = changes.find((change) =>
    [
      'initiative_added',
      'person_added',
      'title_changed',
      'team_changed',
      'role_changed',
    ].includes(change.type)
  );

  if (meaningfulChange?.type === 'initiative_added') {
    actions.push({
      id: `act-${meaningfulChange.id}`,
      title: `Review ${meaningfulChange.title.replace(/^New initiative:\s*/i, '')}`,
      reason: meaningfulChange.detail,
      confidence: meaningfulChange.sources?.length ? 'high' : 'medium',
      provenance: meaningfulChange.sources?.length ? 'sourced' : 'map',
      type: 'open_initiatives',
      evidence: meaningfulChange.sources?.slice(0, 3) ?? [],
    });
  } else if (meaningfulChange?.personId) {
    const person = peopleById.get(meaningfulChange.personId);
    actions.push({
      id: `act-${meaningfulChange.id}`,
      title: `Revisit ${person?.name ?? 'this stakeholder'}`,
      reason: `${meaningfulChange.title}. Confirm how the change affects ownership and the buying group.`,
      confidence: confidenceFor(person),
      provenance: sourcesFor(person).length > 0 ? 'sourced' : 'map',
      type: 'focus_people',
      personIds: person ? [person.id] : undefined,
      evidence: sourcesFor(person),
    });
  }

  const initiative = initiatives.find(
    (item) => item.salesAngles.length > 0 && item.evidence.length > 0
  );
  if (initiative) {
    const relevantPeople = findPeople(state.people, initiative);
    actions.push({
      id: `initiative-${normalized(initiative.name).replace(/\s+/g, '-')}`,
      title: initiative.salesAngles[0] ?? `Review ${initiative.name}`,
      reason: `${initiative.name}: ${initiative.summary}`,
      confidence: relevantPeople.length > 0 ? 'high' : 'medium',
      provenance: 'sourced',
      type: relevantPeople.length > 0 ? 'focus_people' : 'open_initiatives',
      personIds: relevantPeople.slice(0, 4).map((person) => person.id),
      evidence: initiative.evidence.slice(0, 3),
    });
  }

  const researchGap = state.people
    .filter(
      (person) =>
        person.researchStatus === 'conflicting' ||
        person.researchStatus === 'possibly_stale' ||
        person.sources.length === 0
    )
    .sort((a, b) => {
      const aPriority = a.researchStatus === 'conflicting' ? 2 : 1;
      const bPriority = b.researchStatus === 'conflicting' ? 2 : 1;
      return bPriority - aPriority || a.name.localeCompare(b.name);
    })[0];
  if (researchGap) {
    actions.push({
      id: `research-${researchGap.id}`,
      title: `Verify ${researchGap.name}`,
      reason:
        researchGap.researchStatus === 'conflicting'
          ? 'The map contains conflicting title evidence. A focused refresh can resolve it.'
          : researchGap.researchStatus === 'possibly_stale'
            ? 'This stakeholder may be stale. Refresh the evidence before relying on the map.'
            : 'This stakeholder has no attached public source yet.',
      confidence: 'high',
      provenance: 'map',
      type: 'deep_research',
      focus: researchGap.name,
      personIds: [researchGap.id],
      evidence: sourcesFor(researchGap),
    });
  }

  const inferredEdges = state.edges.filter((edge) => edge.inferred).length;
  if (inferredEdges > 0) {
    actions.push({
      id: 'review-inferred-path',
      title: 'Pressure-test the relationship path',
      reason: `${inferredEdges} reporting relationship${inferredEdges === 1 ? ' is' : 's are'} inferred. Validate the route before using it as an introduction plan.`,
      confidence: 'medium',
      provenance: 'hypothesis',
      type: 'open_strategy',
      evidence: [],
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'deepen-account',
      title: 'Deepen the buying committee',
      reason:
        'No new movement or urgent evidence gaps are visible. Research a priority team or stakeholder to improve account coverage.',
      confidence: 'medium',
      provenance: 'map',
      type: 'deep_research',
      focus: '',
      evidence: [],
    });
  }

  const headline = meaningfulChange
    ? meaningfulChange.title
    : initiative
      ? `${initiative.name} is the clearest current signal`
      : 'No meaningful account movement yet';
  const summary =
    changes.length > 0
      ? `${changes.length} change${changes.length === 1 ? '' : 's'} detected, with ${actions.length} evidence-backed next move${actions.length === 1 ? '' : 's'}.`
      : `The map is stable. TopDown found ${actions.length} next move${actions.length === 1 ? '' : 's'} from current evidence and coverage gaps.`;

  return {
    generatedAt: new Date().toISOString(),
    baselineAt,
    headline,
    summary,
    changes: changes.slice(0, 5),
    actions: actions.slice(0, 4),
  };
}
