import { chat } from './llm.js';
import { extractJson } from './research.js';
import type { BriefingInsight } from './briefing.js';
import type {
  MapEdge,
  MapState,
  Person,
  SellerProfile,
} from './types.js';

// Strategy selection and route scoring must stay in sync with
// web/src/lib/accountStrategy.ts.

export interface StrategyContext {
  entry?: Person;
  target?: Person;
  pathNames: string[];
  risks: string[];
  objections: string[];
}

export interface StrategyInsights {
  generatedAt: string;
  provider: string;
  researchDepth: 'live' | 'map_only';
  executiveSummary: string;
  winThemes: BriefingInsight[];
  landingPlays: {
    title: string;
    rationale: string;
    personIds: string[];
    provenance: 'sourced' | 'hypothesis';
    evidence: string[];
  }[];
  stakeholderQuestions: {
    personId?: string;
    personName: string;
    questions: string[];
  }[];
  competitiveWatch: BriefingInsight[];
  mutualActionPlan: {
    milestone: string;
    owner: 'seller' | 'buyer' | 'joint';
    timing: string;
  }[];
  researchGaps: string[];
}

const ROLE_PRIORITY: Record<Person['role'], number> = {
  champion: 100,
  influencer: 75,
  technical_buyer: 65,
  decision_maker: 55,
  economic_buyer: 50,
  blocker: 10,
  none: 0,
};

const TARGET_PRIORITY: Record<Person['role'], number> = {
  economic_buyer: 100,
  decision_maker: 90,
  technical_buyer: 70,
  champion: 40,
  influencer: 30,
  blocker: 10,
  none: 0,
};

type BuyingFunction =
  | 'engineering'
  | 'security'
  | 'data'
  | 'revenue'
  | 'marketing'
  | 'finance'
  | 'people'
  | 'operations';

const FUNCTION_SIGNALS: Record<BuyingFunction, RegExp> = {
  engineering:
    /\b(developer|development|engineering|software|api|platform|infrastructure|cloud|devops|sre|architecture|technical|technology|cto|cio)\b/i,
  security:
    /\b(security|cyber|identity|compliance|risk|privacy|ciso|trust)\b/i,
  data: /\b(data|analytics|machine learning|artificial intelligence|\bai\b|insights|database)\b/i,
  revenue:
    /\b(revenue|sales|account executive|customer success|go.to.market|\bgtm\b|commercial|cro)\b/i,
  marketing:
    /\b(marketing|brand|demand generation|growth|communications|cmo)\b/i,
  finance:
    /\b(finance|financial|payments|billing|treasury|procurement|purchasing|cfo|controller)\b/i,
  people:
    /\b(people|human resources|\bhr\b|talent|recruiting|workforce|chro)\b/i,
  operations:
    /\b(operations|operational|supply chain|workflows?|productivity|coo)\b/i,
};

function functionsIn(value: string): BuyingFunction[] {
  return (Object.entries(FUNCTION_SIGNALS) as [BuyingFunction, RegExp][])
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name);
}

function sellerBuyingFunctions(profile: SellerProfile | null): BuyingFunction[] {
  if (!profile) return [];
  const scores = new Map<BuyingFunction, number>();
  const add = (values: string[], weight: number) => {
    for (const name of functionsIn(values.join(' '))) {
      scores.set(name, (scores.get(name) ?? 0) + weight);
    }
  };
  add(profile.products, 3);
  add(profile.useCases, 3);
  add([profile.positioning], 2);
  add([profile.summary], 1);
  add(profile.targetCustomers, 1);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const strongest = ranked[0]?.[1] ?? 0;
  return ranked
    .filter(([, score]) => score >= Math.max(2, strongest * 0.6))
    .slice(0, 2)
    .map(([name]) => name);
}

function personProductFit(
  person: Person,
  profile: SellerProfile | null
): number {
  const sellerFunctions = new Set(sellerBuyingFunctions(profile));
  if (sellerFunctions.size === 0) return 0;
  const personFunctions = functionsIn(
    [person.title, person.department, person.team, person.productLine]
      .filter(Boolean)
      .join(' ')
  );
  const matches = personFunctions.filter((name) => sellerFunctions.has(name));
  if (matches.length > 0) return 70 + (matches.length - 1) * 10;
  return personFunctions.length > 0 ? -110 : -30;
}

function personScore(
  person: Person,
  priorities: Record<Person['role'], number>,
  sellerProfile: SellerProfile | null,
  includeMetBonus = false
): number {
  const executive =
    /\b(chief|ceo|cto|cio|cfo|coo|president|vp|vice president|head)\b/i.test(
      person.title
    )
      ? 18
      : 0;
  return (
    priorities[person.role ?? 'none'] +
    personProductFit(person, sellerProfile) +
    executive +
    Math.min((person.sources ?? []).length, 5) * 2 +
    (person.confidence === 'high' ? 8 : person.confidence === 'medium' ? 4 : 0) +
    (includeMetBonus && person.metWith ? 12 : 0)
  );
}

type Hop = { id: string; inferred: boolean; influence: boolean };

function findPath(
  people: Person[],
  edges: MapEdge[],
  startId: string,
  targetId: string
): { ids: string[]; hops: Hop[] } {
  if (startId === targetId) return { ids: [startId], hops: [] };
  const known = new Set(people.map((person) => person.id));
  const adjacency = new Map<string, Hop[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    const hop = {
      id: edge.to,
      inferred: Boolean(edge.inferred),
      influence: edge.kind === 'influence',
    };
    const reverse = {
      id: edge.from,
      inferred: Boolean(edge.inferred),
      influence: edge.kind === 'influence',
    };
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), hop]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), reverse]);
  }
  const distance = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { from: string; hop: Hop }>();
  const open = new Set(known);
  while (open.size > 0) {
    const current = [...open].sort(
      (a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity)
    )[0];
    if (!current || !Number.isFinite(distance.get(current) ?? Infinity)) break;
    open.delete(current);
    if (current === targetId) break;
    for (const hop of adjacency.get(current) ?? []) {
      const cost = hop.influence ? 1 : hop.inferred ? 2.2 : 1.4;
      const nextDistance = (distance.get(current) ?? 0) + cost;
      if (nextDistance < (distance.get(hop.id) ?? Infinity)) {
        distance.set(hop.id, nextDistance);
        previous.set(hop.id, { from: current, hop });
      }
    }
  }
  if (!previous.has(targetId)) return { ids: [], hops: [] };
  const ids = [targetId];
  const hops: Hop[] = [];
  while (ids[0] !== startId) {
    const previousHop = previous.get(ids[0]);
    if (!previousHop) return { ids: [], hops: [] };
    hops.unshift(previousHop.hop);
    ids.unshift(previousHop.from);
  }
  return { ids, hops };
}

function routePath(
  people: Person[],
  edges: MapEdge[],
  start: Person | undefined,
  target: Person | undefined
): Person[] {
  if (!start || !target) return [];
  const { ids } = findPath(people, edges, start.id, target.id);
  return ids
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is Person => Boolean(person));
}

export function strategyContext(
  state: MapState,
  sellerProfile: SellerProfile | null = null
): StrategyContext {
  const peopleById = new Map(state.people.map((person) => [person.id, person]));
  const autoEntry = [...state.people].sort(
    (a, b) =>
      personScore(b, ROLE_PRIORITY, sellerProfile, true) -
        personScore(a, ROLE_PRIORITY, sellerProfile, true) ||
      a.name.localeCompare(b.name)
  )[0];
  const entry = state.meta.strategy?.entryPersonId
    ? (peopleById.get(state.meta.strategy.entryPersonId) ?? autoEntry)
    : autoEntry;
  const autoTarget =
    [...state.people]
      .filter((person) => person.id !== entry?.id)
      .sort(
        (a, b) =>
          personScore(b, TARGET_PRIORITY, sellerProfile) -
            personScore(a, TARGET_PRIORITY, sellerProfile) ||
          a.name.localeCompare(b.name)
      )[0] ?? entry;
  const target = state.meta.strategy?.targetPersonId
    ? (peopleById.get(state.meta.strategy.targetPersonId) ?? autoTarget)
    : autoTarget;
  const pathNames = routePath(
    state.people,
    state.edges ?? [],
    entry,
    target
  ).map((person) => person.name);
  const risks = [
    ...state.people
      .filter((person) => person.role === 'blocker')
      .map((person) => `Blocker mapped: ${person.name}`),
    ...(state.people.some((person) => person.role === 'economic_buyer')
      ? []
      : ['Economic buyer is not mapped']),
  ];
  const objections =
    target?.role === 'technical_buyer'
      ? ['Security, integration effort, and architecture fit']
      : ['Priority, timing, and ownership of the problem'];
  return { entry, target, pathNames, risks, objections };
}

const cleanText = (value: unknown, max = 500): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
const directUrls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === 'string' && /^https?:\/\//i.test(item)
        )
        .slice(0, 4)
    : [];
const normalized = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase();

function insight(statement: string, evidence: string[] = []): BriefingInsight {
  return {
    statement,
    provenance: evidence.length ? 'sourced' : 'hypothesis',
    evidence,
  };
}

function fallback(
  state: MapState,
  sellerProfile: SellerProfile | null,
  deterministic: StrategyContext
): StrategyInsights {
  const initiatives = state.meta.initiatives ?? [];
  const account = state.meta.companyName || state.meta.domain;
  const path = deterministic.pathNames.length
    ? deterministic.pathNames.join(' → ')
    : 'No supported path mapped';
  const winThemes = initiatives
    .slice(0, 3)
    .map((item) =>
      insight(
        `${item.name}: ${item.salesAngles?.[0] || item.summary}`,
        (item.evidence ?? [])
          .filter((url) => /^https?:\/\//i.test(url))
          .slice(0, 3)
      )
    );
  const gaps = [
    ...deterministic.risks.slice(0, 4),
    ...(deterministic.target ? [] : ['Target stakeholder is not mapped.']),
    ...(initiatives.length
      ? []
      : ['No current initiative evidence is attached.']),
  ];
  const people = state.people
    .filter((person) =>
      [deterministic.entry?.id, deterministic.target?.id].includes(person.id)
    )
    .slice(0, 5);
  return {
    generatedAt: new Date().toISOString(),
    provider: 'map',
    researchDepth: 'map_only',
    executiveSummary: `${account} strategy centers on ${deterministic.entry?.name || 'the mapped entry point'} reaching ${deterministic.target?.name || 'the buying group'}. ${path === 'No supported path mapped' ? 'Confirm the relationship path before treating this as an introduction plan.' : `The current route is ${path}.`}`,
    winThemes: winThemes.length
      ? winThemes
      : [
          insight(
            sellerProfile?.positioning ||
              'Use account initiatives and stakeholder priorities to establish a measurable business case.'
          ),
        ],
    landingPlays:
      deterministic.entry && deterministic.target
        ? [
            {
              title: `Reach ${deterministic.target.name} through ${deterministic.entry.name}`,
              rationale:
                'Hypothesis based on the strongest mapped relationship path.',
              personIds: [deterministic.entry.id, deterministic.target.id],
              provenance: 'hypothesis',
              evidence: [],
            },
          ]
        : [],
    stakeholderQuestions: people.map((person) => ({
      personId: person.id,
      personName: person.name,
      questions: [
        `What outcome is ${person.name} accountable for?`,
        'What would make this priority urgent?',
        'Who else must be involved in a decision?',
      ],
    })),
    competitiveWatch: [
      insight(
        'Validate incumbent tools, internal alternatives, and competing priorities during discovery.'
      ),
    ],
    mutualActionPlan: [
      {
        milestone: 'Discovery and success criteria',
        owner: 'joint',
        timing: 'Next meeting',
      },
      {
        milestone: 'Technical validation',
        owner: 'buyer',
        timing: 'After discovery',
      },
      {
        milestone: 'Business case',
        owner: 'seller',
        timing: 'Before decision review',
      },
      {
        milestone: 'Procurement and close plan',
        owner: 'joint',
        timing: 'After validation',
      },
    ],
    researchGaps: gaps.length
      ? gaps
      : ['Validate stakeholder motivations with direct discovery.'],
  };
}

export async function deepenAccountStrategy(
  state: MapState,
  sellerProfile: SellerProfile | null,
  deterministic: StrategyContext
): Promise<StrategyInsights> {
  const base = fallback(state, sellerProfile, deterministic);
  if (!sellerProfile) return base;
  const account = state.meta.companyName || state.meta.domain;
  const prompt = `Deepen this account strategy with skeptical, sourced public research.
ACCOUNT: ${account} (${state.meta.domain})
SELLER: ${sellerProfile.companyName} (${sellerProfile.domain})
POSITIONING: ${sellerProfile.positioning || sellerProfile.summary}
ENTRY: ${deterministic.entry?.name || 'unknown'}; TARGET: ${deterministic.target?.name || 'unknown'}
PATH: ${deterministic.pathNames.join(' → ') || 'none'}
KNOWN RISKS: ${deterministic.risks.join('; ') || 'none'}
OBJECTIONS: ${deterministic.objections.join('; ') || 'none'}
INITIATIVES: ${JSON.stringify(state.meta.initiatives ?? [])}
PEOPLE: ${JSON.stringify(state.people.slice(0, 60).map((p) => ({ id: p.id, name: p.name, title: p.title, role: p.role, sources: p.sources.slice(0, 3) })))}
Return JSON only:
{
  "executiveSummary": "2-3 sentences",
  "winThemes": [{"statement":"","provenance":"sourced|hypothesis","evidence":["https://..."]}],
  "landingPlays": [{"title":"","rationale":"","personIds":[""],"provenance":"sourced|hypothesis","evidence":["https://..."]}],
  "stakeholderQuestions": [{"personId":"","personName":"","questions":[""]}],
  "competitiveWatch": [{"statement":"","provenance":"sourced|hypothesis","evidence":["https://..."]}],
  "mutualActionPlan": [{"milestone":"","owner":"seller|buyer|joint","timing":""}],
  "researchGaps": [""]
}
Separate sourced facts from hypotheses; sourced items require direct URLs.`;
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            'You are a skeptical enterprise account strategist. Never present assumptions as facts.',
        },
        { role: 'user', content: prompt },
      ],
      {
        maxTokens: 6_000,
        json: true,
        webSearch: true,
        deadlineMs: Date.now() + 32_000,
      }
    );
    const parsed = extractJson(result.content) as Record<string, unknown>;
    const parseInsights = (
      value: unknown,
      fallbackItems: BriefingInsight[]
    ) => {
      if (!Array.isArray(value)) return fallbackItems;
      const items = value
        .map((item) => {
          const row = item as Record<string, unknown>;
          const statement = cleanText(row.statement);
          const evidence = directUrls(row.evidence);
          return statement
            ? {
                statement,
                evidence,
                provenance:
                  row.provenance === 'sourced' && evidence.length
                    ? ('sourced' as const)
                    : ('hypothesis' as const),
              }
            : null;
        })
        .filter((item): item is BriefingInsight => item !== null)
        .slice(0, 6);
      return items.length ? items : fallbackItems;
    };
    const knownPeople = new Map(
      state.people.map((person) => [person.id, person])
    );
    const landingPlays = Array.isArray(parsed.landingPlays)
      ? parsed.landingPlays
          .map((item) => {
            const row = item as Record<string, unknown>;
            const title = cleanText(row.title, 160);
            if (!title) return null;
            return {
              title,
              rationale: cleanText(row.rationale, 400),
              personIds: Array.isArray(row.personIds)
                ? row.personIds
                    .filter(
                      (id): id is string =>
                        typeof id === 'string' && knownPeople.has(id)
                    )
                    .slice(0, 8)
                : [],
              provenance:
                row.provenance === 'sourced'
                  ? ('sourced' as const)
                  : ('hypothesis' as const),
              evidence: directUrls(row.evidence),
            };
          })
          .filter(
            (item): item is StrategyInsights['landingPlays'][number] =>
              item !== null
          )
          .slice(0, 8)
      : base.landingPlays;
    const questions = Array.isArray(parsed.stakeholderQuestions)
      ? parsed.stakeholderQuestions
          .map((item) => {
            const row = item as Record<string, unknown>;
            const personName = cleanText(row.personName, 120);
            const suppliedPersonId =
              typeof row.personId === 'string' ? row.personId : undefined;
            const person =
              (suppliedPersonId
                ? knownPeople.get(suppliedPersonId)
                : undefined) ??
              state.people.find(
                (candidate) =>
                  normalized(candidate.name) === normalized(personName)
              );
            const qs = Array.isArray(row.questions)
              ? row.questions
                  .map((q) => cleanText(q, 300))
                  .filter(Boolean)
                  .slice(0, 3)
              : [];
            return personName && qs.length && (!suppliedPersonId || person)
              ? {
                  personName,
                  ...(person ? { personId: person.id } : {}),
                  questions: qs,
                }
              : null;
          })
          .filter(
            (item): item is StrategyInsights['stakeholderQuestions'][number] =>
              item !== null
          )
          .slice(0, 5)
      : base.stakeholderQuestions;
    const mutualActionPlan = Array.isArray(parsed.mutualActionPlan)
      ? parsed.mutualActionPlan
          .map((item) => {
            const row = item as Record<string, unknown>;
            const milestone = cleanText(row.milestone, 200);
            if (!milestone) return null;
            return {
              milestone,
              owner:
                row.owner === 'seller' ||
                row.owner === 'buyer' ||
                row.owner === 'joint'
                  ? row.owner
                  : ('joint' as const),
              timing: cleanText(row.timing, 120),
            };
          })
          .filter(
            (item): item is StrategyInsights['mutualActionPlan'][number] =>
              item !== null
          )
          .slice(0, 6)
      : base.mutualActionPlan;
    return {
      generatedAt: new Date().toISOString(),
      provider: result.provider,
      researchDepth: 'live',
      executiveSummary:
        cleanText(parsed.executiveSummary, 900) || base.executiveSummary,
      winThemes: parseInsights(parsed.winThemes, base.winThemes),
      landingPlays: landingPlays.length ? landingPlays : base.landingPlays,
      stakeholderQuestions: questions.length
        ? questions
        : base.stakeholderQuestions,
      competitiveWatch: parseInsights(
        parsed.competitiveWatch,
        base.competitiveWatch
      ),
      mutualActionPlan:
        mutualActionPlan.length > 0 ? mutualActionPlan : base.mutualActionPlan,
      researchGaps: Array.isArray(parsed.researchGaps)
        ? parsed.researchGaps
            .map((gap) => cleanText(gap, 300))
            .filter(Boolean)
            .slice(0, 8)
        : base.researchGaps,
    };
  } catch {
    return base;
  }
}
