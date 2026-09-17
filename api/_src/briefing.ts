import type { MapChangeAlert } from './changes.js';
import { chat } from './llm.js';
import { extractJson } from './research.js';
import type {
  MapState,
  Person,
  SellerProfile,
  StrategicInitiative,
} from './types.js';

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
  valueCase: AccountValueCase | null;
}

export interface BriefingInsight {
  statement: string;
  provenance: 'sourced' | 'hypothesis';
  evidence: string[];
}

export interface StakeholderMessage extends BriefingInsight {
  personId?: string;
  personName: string;
  relevance: string;
}

export interface AccountValueCase {
  methodology: 'Command of the Message';
  researchDepth: 'live' | 'map_only';
  currentState: BriefingInsight[];
  businessProblems: BriefingInsight[];
  businessImpact: BriefingInsight[];
  desiredOutcomes: BriefingInsight[];
  requiredCapabilities: BriefingInsight[];
  decisionCriteria: BriefingInsight[];
  differentiation: BriefingInsight[];
  stakeholderMessages: StakeholderMessage[];
  discoveryQuestions: string[];
  researchGaps: string[];
}

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function findPeople(
  people: Person[],
  initiative: StrategicInitiative
): Person[] {
  const names = new Set((initiative.relevantPeople ?? []).map(normalized));
  const teams = new Set((initiative.relevantTeams ?? []).map(normalized));
  return people.filter(
    (person) =>
      names.has(normalized(person.name)) ||
      [person.team, person.department, person.productLine].some(
        (value) => value && teams.has(normalized(value))
      )
  );
}

function sourcesFor(person: Person | undefined) {
  return (person?.sources ?? []).filter(Boolean).slice(0, 3);
}

function confidenceFor(person: Person | undefined) {
  if (!person) return 'low' as const;
  if (person.confidence === 'high' && (person.sources ?? []).length > 0) {
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
    (item) =>
      (item.salesAngles ?? []).length > 0 && (item.evidence ?? []).length > 0
  );
  if (initiative) {
    const relevantPeople = findPeople(state.people, initiative);
    actions.push({
      id: `initiative-${normalized(initiative.name).replace(/\s+/g, '-')}`,
      title: (initiative.salesAngles ?? [])[0] ?? `Review ${initiative.name ?? 'initiative'}`,
      reason: `${initiative.name ?? 'Initiative'}: ${initiative.summary ?? ''}`,
      confidence: relevantPeople.length > 0 ? 'high' : 'medium',
      provenance: 'sourced',
      type: relevantPeople.length > 0 ? 'focus_people' : 'open_initiatives',
      personIds: relevantPeople.slice(0, 4).map((person) => person.id),
      evidence: (initiative.evidence ?? []).slice(0, 3),
    });
  }

  const researchGap = state.people
    .filter(
      (person) =>
        person.researchStatus === 'conflicting' ||
        person.researchStatus === 'possibly_stale' ||
        (person.sources ?? []).length === 0
    )
    .sort((a, b) => {
      const aPriority = a.researchStatus === 'conflicting' ? 2 : 1;
      const bPriority = b.researchStatus === 'conflicting' ? 2 : 1;
      return bPriority - aPriority || (a.name ?? '').localeCompare(b.name ?? '');
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
    valueCase: null,
  };
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function directUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === 'string' && /^https?:\/\//i.test(item)
    )
    .slice(0, 4);
}

function insights(value: unknown): BriefingInsight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      const statement = cleanText(row.statement);
      if (!statement) return null;
      const evidence = directUrls(row.evidence);
      return {
        statement,
        provenance:
          row.provenance === 'sourced' && evidence.length > 0
            ? ('sourced' as const)
            : ('hypothesis' as const),
        evidence,
      };
    })
    .filter((item): item is BriefingInsight => item !== null)
    .slice(0, 4);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 6);
}

type ValueCaseWithoutGaps = Omit<AccountValueCase, 'researchGaps'>;

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 8);
}

function derivedResearchGaps(valueCase: ValueCaseWithoutGaps): string[] {
  const gaps: string[] = [];
  if (valueCase.currentState.length === 0) {
    gaps.push('Current-state evidence is not established yet.');
  }
  if (valueCase.businessProblems.length === 0) {
    gaps.push('Business problems are not established from account evidence yet.');
  }
  if (valueCase.businessImpact.length === 0) {
    gaps.push('Business impact is not established from account evidence yet.');
  }
  if (valueCase.desiredOutcomes.length === 0) {
    gaps.push('Desired outcomes are not established yet.');
  }
  if (valueCase.requiredCapabilities.length === 0) {
    gaps.push('Required capabilities are not established yet.');
  }
  if (valueCase.decisionCriteria.length === 0) {
    gaps.push('Decision criteria are not established yet.');
  }
  if (valueCase.stakeholderMessages.length === 0) {
    gaps.push('No stakeholder-specific message is grounded in the map yet.');
  }
  return gaps;
}

function fallbackValueCase(
  state: MapState,
  sellerProfile: SellerProfile
): AccountValueCase {
  const initiatives = state.meta.initiatives ?? [];
  const evidenceFor = (initiative: StrategicInitiative) =>
    (initiative.evidence ?? []).filter((url) => /^https?:\/\//i.test(url)).slice(0, 3);
  const currentState = initiatives.slice(0, 3).map((initiative) => ({
    statement: `${initiative.name ?? 'Initiative'}: ${initiative.summary ?? ''}`,
    provenance: evidenceFor(initiative).length
      ? ('sourced' as const)
      : ('hypothesis' as const),
    evidence: evidenceFor(initiative),
  }));
  const relevantPeople = state.people
    .filter((person) =>
      initiatives.some((initiative) =>
        (initiative.relevantPeople ?? []).some(
          (name) => normalized(name) === normalized(person.name)
        )
      )
    )
    .slice(0, 4);
  const valueCase: AccountValueCase = {
    methodology: 'Command of the Message',
    researchDepth: 'map_only',
    currentState,
    businessProblems: [],
    businessImpact: [],
    desiredOutcomes: sellerProfile.useCases.slice(0, 4).map((statement) => ({
      statement: `Validate whether ${statement} is a priority for this account.`,
      provenance: 'hypothesis',
      evidence: [],
    })),
    requiredCapabilities: sellerProfile.products.slice(0, 4).map((statement) => ({
      statement,
      provenance: 'hypothesis',
      evidence: [],
    })),
    decisionCriteria: [],
    differentiation: [
      sellerProfile.positioning,
      ...sellerProfile.proofPoints,
    ]
      .filter(Boolean)
      .slice(0, 4)
      .map((statement) => ({
        statement,
        provenance: 'hypothesis' as const,
        evidence: [],
      })),
    stakeholderMessages: relevantPeople.map((person) => ({
      personId: person.id,
      personName: person.name,
      relevance: [person.title, person.team ?? person.department]
        .filter(Boolean)
        .join(' · '),
      statement: `Ask how this stakeholder's priorities connect to the account's current initiatives before positioning ${sellerProfile.companyName}.`,
      provenance: 'hypothesis',
      evidence: sourcesFor(person),
    })),
    discoveryQuestions: [
      'Which business outcome has an executive commitment and a measurable deadline?',
      'What prevents the account from reaching that outcome today?',
      'Which capabilities are mandatory, and who defines the decision criteria?',
      'How will the buying group measure success and economic impact?',
    ],
    researchGaps: [],
  };
  valueCase.researchGaps = uniqueStrings([
    ...(currentState.length === 0
      ? ['No sourced strategic initiative is attached to this map.']
      : []),
    ...(relevantPeople.length === 0
      ? ['No stakeholder is explicitly connected to a current initiative.']
      : []),
    ...derivedResearchGaps(valueCase),
  ]);
  return valueCase;
}

export async function deepenAccountBriefing(
  briefing: AccountBriefing,
  state: MapState,
  sellerProfile: SellerProfile | null
): Promise<AccountBriefing> {
  if (!sellerProfile) return briefing;
  const fallback = fallbackValueCase(state, sellerProfile);
  const sources = Array.from(
    new Set([
      ...state.people.flatMap((person) => person.sources ?? []),
      ...(state.meta.initiatives ?? []).flatMap((initiative) =>
        (initiative.evidence ?? []).filter((url) => /^https?:\/\//i.test(url))
      ),
    ])
  ).slice(0, 30);
  const account = state.meta.companyName || state.meta.domain;
  const prompt = `Research and build a rigorous enterprise account value case for a seller.

TARGET ACCOUNT
${account} (${state.meta.domain})

SELLER
${sellerProfile.companyName} (${sellerProfile.domain})
Products: ${sellerProfile.products.join('; ') || 'unknown'}
Use cases: ${sellerProfile.useCases.join('; ') || 'unknown'}
Target customers: ${sellerProfile.targetCustomers.join('; ') || 'unknown'}
Positioning: ${sellerProfile.positioning || sellerProfile.summary || 'unknown'}
Proof points: ${sellerProfile.proofPoints.join('; ') || 'none supplied'}
Competitors: ${sellerProfile.competitors.join('; ') || 'unknown'}

KNOWN ACCOUNT INITIATIVES
${JSON.stringify(state.meta.initiatives ?? [])}

KNOWN STAKEHOLDERS
${JSON.stringify(
  state.people.slice(0, 60).map((person) => ({
    id: person.id,
    name: person.name,
    title: person.title,
    department: person.department,
    team: person.team,
    productLine: person.productLine,
    sources: (person.sources ?? []).slice(0, 3),
  }))
)}

EXISTING SOURCES
${sources.join('\n')}

Use current public web research to deepen the value case. Follow a Command of
the Message-style structure, but do not claim affiliation or certification.
Separate target-account facts from sales hypotheses. Never infer business pain,
financial impact, product usage, budget, decision criteria, or stakeholder
motivation as fact. A sourced statement needs a direct inspectable URL that
supports that exact claim. Hypotheses must have provenance "hypothesis" and no
fabricated evidence. Make stakeholder messages specific to the person's
function and the account evidence, not generic outreach copy.

Return JSON only:
{
  "currentState": [{"statement":"","provenance":"sourced|hypothesis","evidence":["https://..."]}],
  "businessProblems": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "businessImpact": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "desiredOutcomes": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "requiredCapabilities": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "decisionCriteria": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "differentiation": [{"statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "stakeholderMessages": [{"personId":"","personName":"","relevance":"","statement":"","provenance":"sourced|hypothesis","evidence":[]}],
  "discoveryQuestions": [""],
  "researchGaps": [""]
}`;
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            'You are a skeptical enterprise account researcher. Evidence and uncertainty are more important than completeness.',
        },
        { role: 'user', content: prompt },
      ],
      {
        maxTokens: 7_000,
        json: true,
        webSearch: true,
        deadlineMs: Date.now() + 32_000,
      }
    );
    const parsed = extractJson(result.content) as Record<string, unknown>;
    const stakeholderMessages = Array.isArray(parsed.stakeholderMessages)
      ? parsed.stakeholderMessages
          .map((item) => {
            const row = item as Record<string, unknown>;
            const statement = cleanText(row.statement);
            const personName = cleanText(row.personName, 120);
            if (!statement || !personName) return null;
            const evidence = directUrls(row.evidence);
            const person = state.people.find(
              (candidate) =>
                candidate.id === row.personId ||
                normalized(candidate.name) === normalized(personName)
            );
            return {
              ...(person ? { personId: person.id } : {}),
              personName,
              relevance: cleanText(row.relevance, 200),
              statement,
              provenance:
                row.provenance === 'sourced' && evidence.length > 0
                  ? ('sourced' as const)
                  : ('hypothesis' as const),
              evidence,
            };
          })
          .filter((item): item is StakeholderMessage => item !== null)
          .slice(0, 5)
      : [];
    const useInsights = (
      value: unknown,
      fallbackItems: BriefingInsight[]
    ): BriefingInsight[] => {
      const parsedItems = insights(value);
      return parsedItems.length > 0 ? parsedItems : fallbackItems;
    };
    const useStrings = (value: unknown, fallbackItems: string[]): string[] => {
      const parsedItems = strings(value);
      return parsedItems.length > 0 ? parsedItems : fallbackItems;
    };
    const valueCase: AccountValueCase = {
      methodology: 'Command of the Message',
      researchDepth: 'live',
      currentState: useInsights(
        parsed.currentState,
        fallback.currentState
      ),
      businessProblems: useInsights(
        parsed.businessProblems,
        fallback.businessProblems
      ),
      businessImpact: useInsights(
        parsed.businessImpact,
        fallback.businessImpact
      ),
      desiredOutcomes: useInsights(
        parsed.desiredOutcomes,
        fallback.desiredOutcomes
      ),
      requiredCapabilities: useInsights(
        parsed.requiredCapabilities,
        fallback.requiredCapabilities
      ),
      decisionCriteria: useInsights(
        parsed.decisionCriteria,
        fallback.decisionCriteria
      ),
      differentiation: useInsights(
        parsed.differentiation,
        fallback.differentiation
      ),
      stakeholderMessages:
        stakeholderMessages.length > 0
          ? stakeholderMessages
          : fallback.stakeholderMessages,
      discoveryQuestions: useStrings(
        parsed.discoveryQuestions,
        fallback.discoveryQuestions
      ),
      researchGaps: [],
    };
    valueCase.researchGaps = uniqueStrings([
      ...strings(parsed.researchGaps),
      ...fallback.researchGaps,
      ...derivedResearchGaps(valueCase),
    ]);
    return { ...briefing, valueCase };
  } catch {
    return { ...briefing, valueCase: fallback };
  }
}
