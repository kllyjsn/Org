import { chat } from './llm.js';
import { extractJson } from './research.js';
import type { BriefingInsight } from './briefing.js';
import type { MapState, Person, SellerProfile } from './types.js';

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

const cleanText = (value: unknown, max = 500): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const directUrls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item)).slice(0, 4)
    : [];

function insight(statement: string, evidence: string[] = []): BriefingInsight {
  return { statement, provenance: evidence.length ? 'sourced' : 'hypothesis', evidence };
}

function fallback(
  state: MapState,
  sellerProfile: SellerProfile | null,
  deterministic: { entry?: Person; target?: Person; pathNames: string[]; risks: string[]; objections: string[] }
): StrategyInsights {
  const initiatives = state.meta.initiatives ?? [];
  const account = state.meta.companyName || state.meta.domain;
  const path = deterministic.pathNames.length ? deterministic.pathNames.join(' → ') : 'No supported path mapped';
  const winThemes = initiatives.slice(0, 3).map((item) => insight(`${item.name}: ${item.salesAngles?.[0] || item.summary}`, (item.evidence ?? []).filter((url) => /^https?:\/\//i.test(url)).slice(0, 3)));
  const gaps = [
    ...deterministic.risks.slice(0, 4),
    ...(deterministic.target ? [] : ['Target stakeholder is not mapped.']),
    ...(initiatives.length ? [] : ['No current initiative evidence is attached.']),
  ];
  const people = state.people.filter((person) => [deterministic.entry?.id, deterministic.target?.id].includes(person.id)).slice(0, 5);
  return {
    generatedAt: new Date().toISOString(),
    provider: 'map',
    researchDepth: 'map_only',
    executiveSummary: `${account} strategy centers on ${deterministic.entry?.name || 'the mapped entry point'} reaching ${deterministic.target?.name || 'the buying group'}. ${path === 'No supported path mapped' ? 'Confirm the relationship path before treating this as an introduction plan.' : `The current route is ${path}.`}`,
    winThemes: winThemes.length ? winThemes : [insight(sellerProfile?.positioning || 'Use account initiatives and stakeholder priorities to establish a measurable business case.')],
    landingPlays: deterministic.entry && deterministic.target
      ? [{ title: `Reach ${deterministic.target.name} through ${deterministic.entry.name}`, rationale: 'Hypothesis based on the strongest mapped relationship path.', personIds: [deterministic.entry.id, deterministic.target.id], provenance: 'hypothesis', evidence: [] }]
      : [],
    stakeholderQuestions: people.map((person) => ({ personId: person.id, personName: person.name, questions: [`What outcome is ${person.name} accountable for?`, 'What would make this priority urgent?', 'Who else must be involved in a decision?'] })),
    competitiveWatch: [insight('Validate incumbent tools, internal alternatives, and competing priorities during discovery.')],
    mutualActionPlan: [
      { milestone: 'Discovery and success criteria', owner: 'joint', timing: 'Next meeting' },
      { milestone: 'Technical validation', owner: 'buyer', timing: 'After discovery' },
      { milestone: 'Business case', owner: 'seller', timing: 'Before decision review' },
      { milestone: 'Procurement and close plan', owner: 'joint', timing: 'After validation' },
    ],
    researchGaps: gaps.length ? gaps : ['Validate stakeholder motivations with direct discovery.'],
  };
}

export async function deepenAccountStrategy(
  state: MapState,
  sellerProfile: SellerProfile | null,
  deterministic: { entry?: Person; target?: Person; pathNames: string[]; risks: string[]; objections: string[] }
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
Return JSON only with executiveSummary (2-3 sentences), winThemes, landingPlays, stakeholderQuestions, competitiveWatch, mutualActionPlan, researchGaps. Separate sourced facts from hypotheses; sourced items require direct URLs.`;
  try {
    const result = await chat(
      [{ role: 'system', content: 'You are a skeptical enterprise account strategist. Never present assumptions as facts.' }, { role: 'user', content: prompt }],
      { maxTokens: 6_000, json: true, webSearch: true, deadlineMs: Date.now() + 32_000 }
    );
    const parsed = extractJson(result.content) as Record<string, unknown>;
    const parseInsights = (value: unknown, fallbackItems: BriefingInsight[]) => {
      if (!Array.isArray(value)) return fallbackItems;
      const items = value.map((item) => {
        const row = item as Record<string, unknown>;
        const statement = cleanText(row.statement);
        const evidence = directUrls(row.evidence);
        return statement ? { statement, evidence, provenance: row.provenance === 'sourced' && evidence.length ? 'sourced' as const : 'hypothesis' as const } : null;
      }).filter((item): item is BriefingInsight => item !== null).slice(0, 6);
      return items.length ? items : fallbackItems;
    };
    const landingPlays = Array.isArray(parsed.landingPlays) ? parsed.landingPlays.map((item) => {
      const row = item as Record<string, unknown>;
      const title = cleanText(row.title, 160);
      if (!title) return null;
      return { title, rationale: cleanText(row.rationale, 400), personIds: Array.isArray(row.personIds) ? row.personIds.filter((id): id is string => typeof id === 'string').slice(0, 8) : [], provenance: row.provenance === 'sourced' ? 'sourced' as const : 'hypothesis' as const, evidence: directUrls(row.evidence) };
    }).filter((item): item is StrategyInsights['landingPlays'][number] => item !== null).slice(0, 8) : base.landingPlays;
    const questions = Array.isArray(parsed.stakeholderQuestions) ? parsed.stakeholderQuestions.map((item) => {
      const row = item as Record<string, unknown>;
      const personName = cleanText(row.personName, 120);
      const qs = Array.isArray(row.questions) ? row.questions.map((q) => cleanText(q, 300)).filter(Boolean).slice(0, 3) : [];
      return personName && qs.length ? { personName, ...(typeof row.personId === 'string' ? { personId: row.personId } : {}), questions: qs } : null;
    }).filter((item): item is StrategyInsights['stakeholderQuestions'][number] => item !== null).slice(0, 5) : base.stakeholderQuestions;
    return {
      generatedAt: new Date().toISOString(), provider: result.provider, researchDepth: 'live',
      executiveSummary: cleanText(parsed.executiveSummary, 900) || base.executiveSummary,
      winThemes: parseInsights(parsed.winThemes, base.winThemes),
      landingPlays, stakeholderQuestions: questions, competitiveWatch: parseInsights(parsed.competitiveWatch, base.competitiveWatch),
      mutualActionPlan: base.mutualActionPlan, researchGaps: Array.isArray(parsed.researchGaps) ? parsed.researchGaps.map((gap) => cleanText(gap, 300)).filter(Boolean).slice(0, 8) : base.researchGaps,
    };
  } catch {
    return base;
  }
}
