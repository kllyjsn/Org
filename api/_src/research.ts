import { chat, activeProvider, type Provider } from './llm.js';
import type { Confidence, ResearchSource } from './types.js';

export interface ResearchedPerson {
  name: string;
  title: string;
  department: string | null;
  team: string | null;
  productLine: string | null;
  teamEvidence: 'sourced' | 'inferred' | null;
  reportsToName: string | null;
  confidence: Confidence;
  source: string | null;
  sources: string[];
  sourceDetails: ResearchSource[];
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  corroborationCount: number;
  lastVerifiedAt: string | null;
  conflictingTitles: string[];
  researchStatus: 'verified' | 'possibly_stale' | 'conflicting';
}

export interface ResearchResult {
  companyName: string | null;
  domain: string;
  people: ResearchedPerson[];
  provider: Provider;
  tier: 'T0';
  demo: boolean;
  initiatives: StrategicInitiative[];
}

export interface StrategicInitiative {
  name: string;
  summary: string;
  category: 'product' | 'growth' | 'operations' | 'technology' | 'market';
  evidence: string[];
  evidenceDetails: ResearchSource[];
  relevantPeople: string[];
  relevantTeams: string[];
  salesAngles: string[];
}

const SYSTEM_PROMPT = `You are an analyst mapping the organizational structure of companies.
You answer only with strict JSON. No markdown, no prose, no footnotes.`;

function researchPrompt(domain: string, focus: string): string {
  return `Map the organizational structure of the company at domain "${domain}".

Use public sources: the company's leadership/team/about pages, press releases,
news coverage, SEC filings (10-K, DEF 14A) for public companies, and public
job postings. Search beyond the main leadership page, including department
pages, employee announcements, conference bios, and reputable profiles.

This pass focuses on: ${focus}.

Identify up to 25 current employees in this focus area. Include executives,
VPs, heads, directors, and named managers when publicly verifiable. Aim for at
least 10 people when the public evidence exists; do not stop after the first
leadership page.

Return ONLY this JSON object:
{
  "companyName": "string",
  "people": [
    {
      "name": "full name",
      "title": "current job title",
      "department": "string or null",
      "team": "specific team or group, or null",
      "productLine": "specific product or business line, or null",
      "teamEvidence": "sourced | inferred | null",
      "reportsTo": "full name of their manager, or null if unknown/CEO",
      "confidence": "high | medium | low",
      "sources": [{
        "url": "direct source URL",
        "title": "page or document title",
        "publisher": "publisher or company name",
        "publishedAt": "YYYY-MM-DD or null",
        "sourceType": "official | filing | press | news | profile | job | conference | other"
      }],
      "conflictingTitles": ["other current-looking titles found, if any"],
      "researchStatus": "verified | possibly_stale | conflicting"
    }
  ]
}

Rules:
- Only include real people you found evidence for in public sources.
- Return direct, inspectable source URLs, never search-result URLs.
- Include publication dates when the page or document provides one.
- Prefer official company pages and filings, then recent reputable reporting.
- "high" confidence = named on the company's official site or filings.
- "medium" = credible secondary source (press, reputable directories).
- "low" = inferred or possibly stale.
- Research specific sub-teams and product lines, not just broad departments.
- Mark teamEvidence "inferred" when the team comes only from title/context.
- Use "conflicting" when credible sources disagree on the current title.
- Use "possibly_stale" when the only evidence appears older than 18 months.
- If you cannot verify the manager, use null — do not guess.
- JSON only.`;
}

function initiativesPrompt(domain: string): string {
  return `Research the company at "${domain}" and identify up to eight important
initiatives from the last 18 months. Use product launches, executive interviews,
earnings or investor materials, press releases, major hiring patterns, and
credible news.

Return ONLY this JSON:
{
  "initiatives": [{
    "name": "short initiative name",
    "summary": "what changed and why it matters",
    "category": "product | growth | operations | technology | market",
    "evidence": [{
      "url": "direct source URL",
      "title": "page or document title",
      "publisher": "publisher or company name",
      "publishedAt": "YYYY-MM-DD or null",
      "sourceType": "official | filing | press | news | profile | job | conference | other"
    }],
    "relevantPeople": ["names of leaders publicly connected to it"],
    "relevantTeams": ["teams likely accountable for it"],
    "salesAngles": ["evidence-backed hypothesis for a seller, not a claimed fact"]
  }]
}

Rules:
- Prefer initiatives with recent, specific public evidence.
- Return direct source URLs and publication dates when available.
- Sales angles must connect a likely business pressure to the initiative.
- Do not invent budgets, pain, purchase intent, or internal plans.
- JSON only.`;
}

function stripFootnotes(value: string): string {
  return value.replace(/\[\d+\]/g, '').trim();
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in LLM response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const CORE_FUNCTIONS = [
  'engineering',
  'product',
  'sales',
  'marketing',
  'finance',
  'operations',
  'people',
  'legal',
  'security',
  'customer success',
];

const SOURCE_TYPES: ResearchSource['sourceType'][] = [
  'official',
  'filing',
  'press',
  'news',
  'profile',
  'job',
  'conference',
  'other',
];

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeSources(
  raw: unknown,
  retrievedAt: string,
  limit = 5
): ResearchSource[] {
  if (!Array.isArray(raw)) return [];
  const sources = new Map<string, ResearchSource>();
  for (const item of raw) {
    const value =
      typeof item === 'string'
        ? { url: item }
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null;
    if (!value || typeof value.url !== 'string') continue;
    const url = stripFootnotes(value.url).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const sourceType = SOURCE_TYPES.includes(
      value.sourceType as ResearchSource['sourceType']
    )
      ? (value.sourceType as ResearchSource['sourceType'])
      : 'other';
    sources.set(url, {
      url,
      title:
        typeof value.title === 'string' ? stripFootnotes(value.title) : null,
      publisher:
        typeof value.publisher === 'string'
          ? stripFootnotes(value.publisher)
          : null,
      publishedAt: normalizeDate(value.publishedAt),
      retrievedAt,
      sourceType,
    });
    if (sources.size >= limit) break;
  }
  return Array.from(sources.values());
}

function sourceDomain(source: ResearchSource): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceQuality(
  sources: ResearchSource[],
  nowMs: number
): {
  freshness: ResearchedPerson['freshness'];
  corroborationCount: number;
} {
  const datedAges = sources.flatMap((source) => {
    if (!source.publishedAt) return [];
    const publishedMs = Date.parse(source.publishedAt);
    return Number.isFinite(publishedMs)
      ? [(nowMs - publishedMs) / 86_400_000]
      : [];
  });
  const newestAge = datedAges.length > 0 ? Math.min(...datedAges) : null;
  const freshness =
    newestAge === null
      ? 'unknown'
      : newestAge <= 180
        ? 'fresh'
        : newestAge <= 540
          ? 'aging'
          : 'stale';
  const corroborationCount = new Set(
    sources.map(sourceDomain).filter(Boolean)
  ).size;
  return { freshness, corroborationCount };
}

function normalizePeople(
  raw: unknown,
  limit = 60,
  nowMs = Date.now()
): ResearchedPerson[] {
  if (!Array.isArray(raw)) return [];
  const retrievedAt = new Date(nowMs).toISOString();
  const people = new Map<string, ResearchedPerson>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? stripFootnotes(p.name) : '';
    const title = typeof p.title === 'string' ? stripFootnotes(p.title) : '';
    if (!name || !title) continue;
    const key = name.toLowerCase();
    const conf = CONFIDENCES.includes(p.confidence as Confidence)
      ? (p.confidence as Confidence)
      : 'low';
    const sourceDetails = normalizeSources(
      Array.isArray(p.sources)
        ? p.sources
        : typeof p.source === 'string'
          ? [p.source]
          : [],
      retrievedAt
    );
    const sources = sourceDetails.map((source) => source.url);
    const quality = sourceQuality(sourceDetails, nowMs);
    const conflictingTitles = Array.isArray(p.conflictingTitles)
      ? p.conflictingTitles
          .filter((value): value is string => typeof value === 'string')
          .map(stripFootnotes)
          .filter(Boolean)
      : [];
    const status =
      p.researchStatus === 'possibly_stale' ||
      p.researchStatus === 'conflicting'
        ? p.researchStatus
        : conf === 'low' ||
            sources.length === 0 ||
            quality.freshness === 'stale'
          ? 'possibly_stale'
          : 'verified';
    const teamEvidence =
      p.teamEvidence === 'sourced' || p.teamEvidence === 'inferred'
        ? p.teamEvidence
        : null;
    const candidate: ResearchedPerson = {
      name,
      title,
      department:
        typeof p.department === 'string' ? stripFootnotes(p.department) : null,
      team: typeof p.team === 'string' ? stripFootnotes(p.team) : null,
      productLine:
        typeof p.productLine === 'string' ? stripFootnotes(p.productLine) : null,
      teamEvidence,
      reportsToName:
        typeof p.reportsTo === 'string' && p.reportsTo.trim()
          ? stripFootnotes(p.reportsTo)
          : typeof p.reportsToName === 'string' && p.reportsToName.trim()
            ? stripFootnotes(p.reportsToName)
            : null,
      confidence: conf,
      source: sources[0] ?? null,
      sources,
      sourceDetails,
      freshness: quality.freshness,
      corroborationCount: quality.corroborationCount,
      lastVerifiedAt: sources.length > 0 ? retrievedAt : null,
      conflictingTitles,
      researchStatus: status,
    };
    const existing = people.get(key);
    if (!existing) {
      people.set(key, candidate);
      if (people.size >= limit) break;
      continue;
    }
    const titleConflict =
      existing.title.toLowerCase() !== candidate.title.toLowerCase();
    const confidenceRank: Record<Confidence, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    const preferred =
      confidenceRank[candidate.confidence] > confidenceRank[existing.confidence]
        ? candidate
        : existing;
    people.set(key, {
      ...preferred,
      department: preferred.department ?? existing.department ?? candidate.department,
      team: preferred.team ?? existing.team ?? candidate.team,
      productLine:
        preferred.productLine ?? existing.productLine ?? candidate.productLine,
      teamEvidence:
        preferred.teamEvidence ?? existing.teamEvidence ?? candidate.teamEvidence,
      reportsToName:
        preferred.reportsToName ??
        existing.reportsToName ??
        candidate.reportsToName,
      sources: Array.from(new Set([...existing.sources, ...candidate.sources])).slice(
        0,
        5
      ),
      sourceDetails: Array.from(
        new Map(
          [...existing.sourceDetails, ...candidate.sourceDetails].map((source) => [
            source.url,
            source,
          ])
        ).values()
      ).slice(0, 5),
      freshness:
        existing.freshness === 'fresh' || candidate.freshness === 'fresh'
          ? 'fresh'
          : existing.freshness === 'aging' || candidate.freshness === 'aging'
            ? 'aging'
            : existing.freshness === 'stale' || candidate.freshness === 'stale'
              ? 'stale'
              : 'unknown',
      corroborationCount: new Set(
        [...existing.sourceDetails, ...candidate.sourceDetails]
          .map(sourceDomain)
          .filter(Boolean)
      ).size,
      lastVerifiedAt: existing.lastVerifiedAt ?? candidate.lastVerifiedAt,
      source: existing.source ?? candidate.source,
      conflictingTitles: Array.from(
        new Set([
          ...existing.conflictingTitles,
          ...candidate.conflictingTitles,
          ...(titleConflict ? [existing.title, candidate.title] : []),
        ])
      ),
      researchStatus:
        titleConflict ||
        existing.researchStatus === 'conflicting' ||
        candidate.researchStatus === 'conflicting'
          ? 'conflicting'
          : existing.researchStatus === 'possibly_stale' &&
              candidate.researchStatus === 'possibly_stale'
            ? 'possibly_stale'
            : 'verified',
    });
  }
  return Array.from(people.values());
}

function missingFunctions(people: ResearchedPerson[]): string[] {
  const haystack = people
    .flatMap((person) => [
      person.department,
      person.team,
      person.title,
      person.productLine,
    ])
    .filter((value): value is string => !!value)
    .join(' ')
    .toLowerCase();
  return CORE_FUNCTIONS.filter((name) => !haystack.includes(name));
}

function normalizeInitiatives(
  raw: unknown,
  nowMs = Date.now()
): StrategicInitiative[] {
  if (!Array.isArray(raw)) return [];
  const retrievedAt = new Date(nowMs).toISOString();
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const name = typeof value.name === 'string' ? stripFootnotes(value.name) : '';
    const summary =
      typeof value.summary === 'string' ? stripFootnotes(value.summary) : '';
    if (!name || !summary) return [];
    const list = (field: unknown, limit: number) =>
      Array.isArray(field)
        ? field
            .filter((entry): entry is string => typeof entry === 'string')
            .map(stripFootnotes)
            .filter(Boolean)
            .slice(0, limit)
        : [];
    const category =
      value.category === 'growth' ||
      value.category === 'operations' ||
      value.category === 'technology' ||
      value.category === 'market'
        ? value.category
        : 'product';
    const evidenceDetails = normalizeSources(value.evidence, retrievedAt, 3);
    return [
      {
        name,
        summary,
        category,
        evidence: evidenceDetails.map((source) => source.url),
        evidenceDetails,
        relevantPeople: list(value.relevantPeople, 8),
        relevantTeams: list(value.relevantTeams, 8),
        salesAngles: list(value.salesAngles, 4),
      },
    ];
  });
}

/** Clearly-labeled demo chart so the product is usable with no LLM key. */
function fixtureOrg(domain: string): ResearchResult {
  const fixtures: [string, string, string, string | null][] = [
    ['Alex Morgan', 'Chief Executive Officer', 'Executive', null],
    ['Sam Chen', 'Chief Revenue Officer', 'Sales', 'Alex Morgan'],
    ['Priya Patel', 'Chief Technology Officer', 'Engineering', 'Alex Morgan'],
    ['Jordan Lee', 'Chief Financial Officer', 'Finance', 'Alex Morgan'],
    ['Casey Rivera', 'VP Sales, Americas', 'Sales', 'Sam Chen'],
    ['Taylor Kim', 'VP Engineering', 'Engineering', 'Priya Patel'],
    ['Morgan Diaz', 'Head of Security', 'Engineering', 'Priya Patel'],
    ['Robin Novak', 'VP Marketing', 'Marketing', 'Alex Morgan'],
  ];
  const people: ResearchedPerson[] = fixtures.map(
    ([name, title, department, reportsToName]) => ({
    name,
    title,
    department,
    team: null,
    productLine: null,
    teamEvidence: null,
    reportsToName,
    confidence: 'low' as const,
    source: 'demo fixture',
    sources: ['demo fixture'],
    sourceDetails: [],
    freshness: 'unknown' as const,
    corroborationCount: 0,
    lastVerifiedAt: null,
    conflictingTitles: [],
    researchStatus: 'possibly_stale' as const,
    })
  );
  return {
    companyName: domain,
    domain,
    people,
    provider: 'fixture',
    tier: 'T0',
    demo: true,
    initiatives: [],
  };
}

export async function researchOrg(
  domain: string,
  requestedFocus?: string
): Promise<ResearchResult> {
  const provider = activeProvider();
  if (provider === 'fixture') return fixtureOrg(domain);

  try {
    const initiativesPromise = requestedFocus
      ? Promise.resolve(null)
      : chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: initiativesPrompt(domain) },
        ], { webSearch: true }).catch(() => null);
    const focuses = requestedFocus
      ? [
          `targeted enrichment for: ${requestedFocus}. Find the named person or ` +
            'team first, then include closely related leaders and reporting lines ' +
            'only when public evidence supports them.',
        ]
      : [
          'executive leadership and company-wide reporting structure',
          'engineering, product, design, data, security, and technology leadership',
          'sales, marketing, customer success, finance, operations, legal, and people leadership',
        ];
    const passes = await Promise.allSettled(
      focuses.map(async (focus) => {
        const result = await chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: researchPrompt(domain, focus) },
        ], { webSearch: true });
        const parsed = extractJson(result.content) as {
          companyName?: unknown;
          people?: unknown;
        };
        return { parsed, provider: result.provider };
      })
    );
    const successful = passes.flatMap((pass) =>
      pass.status === 'fulfilled' ? [pass.value] : []
    );
    if (successful.length === 0) {
      throw new Error('All company research passes failed');
    }
    let people = normalizePeople(
      successful.flatMap((pass) =>
        Array.isArray(pass.parsed.people) ? pass.parsed.people : []
      )
    );
    const missing = requestedFocus ? [] : missingFunctions(people);
    if (missing.length > 0) {
      try {
        const followUp = await chat([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: researchPrompt(
              domain,
              `missing or underrepresented functions: ${missing.join(', ')}. ` +
                'Return only people you can verify; some functions may not exist.'
            ),
          },
        ], { webSearch: true });
        const parsedFollowUp = extractJson(followUp.content) as {
          people?: unknown;
        };
        people = normalizePeople([
          ...people,
          ...(Array.isArray(parsedFollowUp.people) ? parsedFollowUp.people : []),
        ]);
      } catch {
        // The broad passes still provide a useful result if a follow-up times out.
      }
    }
    const companyName = successful.find(
      (pass) => typeof pass.parsed.companyName === 'string'
    )?.parsed.companyName;
    const initiativeResult = await initiativesPromise;
    let initiatives: StrategicInitiative[] = [];
    if (initiativeResult) {
      try {
        const initiativeJson = extractJson(initiativeResult.content) as {
          initiatives?: unknown;
        };
        initiatives = normalizeInitiatives(initiativeJson.initiatives);
      } catch {
        initiatives = [];
      }
    }
    return {
      companyName:
        typeof companyName === 'string'
          ? stripFootnotes(companyName)
          : null,
      domain,
      people,
      provider: successful[0].provider,
      tier: 'T0',
      demo: false,
      initiatives,
    };
  } catch (err) {
    // No keys configured at all → clearly-labeled demo chart.
    if (err instanceof Error && err.message === 'No LLM provider key configured')
      return fixtureOrg(domain);
    throw err;
  }
}
