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
  /** Stored map source URLs the server verified as dead (404/410). */
  deadSources?: string[];
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

Identify up to 10 current employees in this focus area. Include executives,
VPs, heads, directors, and named managers when publicly verifiable. Aim for at
least 8 people when the public evidence exists; do not stop after the first
leadership page. Be concise: short titles, short summaries, no filler.

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

/** Salvage the last complete item of { key: [ {...}, ... ] } when the model
 *  output was truncated at the token cap mid-element. */
function salvageTruncatedJson(raw: string): unknown | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastGood = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      if (stack.pop() === undefined) return null;
      // A closed object at depth 2 is a complete top-level array item.
      if (ch === '}' && stack.length === 2 && stack[1] === '[') lastGood = i;
    }
  }
  if (lastGood === -1) return null;
  const cut = raw.slice(0, lastGood + 1);
  const remaining: string[] = [];
  inStr = false;
  esc = false;
  for (const ch of cut) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') remaining.push(ch);
    else if (ch === '}' || ch === ']') remaining.pop();
  }
  const closers = remaining
    .reverse()
    .map((c) => (c === '{' ? '}' : ']'))
    .join('');
  try {
    return JSON.parse(cut + closers);
  } catch {
    return null;
  }
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in LLM response');
  }
  const raw = candidate.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (error) {
    const salvaged = salvageTruncatedJson(raw);
    if (salvaged !== null) return salvaged;
    throw error;
  }
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

function isGroundingRedirect(url: string): boolean {
  return url.includes('grounding-api-redirect') || url.includes('vertexaisearch');
}

/**
 * Search-grounded answers cite opaque redirect links. Resolve them to the real
 * destination so users can inspect the evidence, dropping any that fail. Then
 * drop citations that return a definitive dead response (404/410) — a broken
 * link is worse than no link.
 */
export async function resolveSourceUrls(
  people: ResearchedPerson[],
  initiatives: StrategicInitiative[],
  deadlineMs = Number.POSITIVE_INFINITY
): Promise<void> {
  const applyPersonSources = (
    person: ResearchedPerson,
    sources: ResearchSource[]
  ) => {
    person.sourceDetails = sources;
    person.sources = person.sourceDetails.map((source) => source.url);
    person.source = person.sources[0] ?? null;
    const quality = sourceQuality(person.sourceDetails, Date.now());
    person.freshness = quality.freshness;
    person.corroborationCount = quality.corroborationCount;
    if (person.sources.length === 0) {
      person.lastVerifiedAt = null;
      if (person.researchStatus === 'verified')
        person.researchStatus = 'possibly_stale';
    } else {
      person.lastVerifiedAt = new Date().toISOString();
      if (
        quality.freshness === 'stale' &&
        person.researchStatus === 'verified'
      ) {
        person.researchStatus = 'possibly_stale';
      }
    }
  };
  const applyInitiativeSources = (
    initiative: StrategicInitiative,
    sources: ResearchSource[]
  ) => {
    initiative.evidenceDetails = sources;
    initiative.evidence = initiative.evidenceDetails.map((s) => s.url);
  };

  const pending = Array.from(
    new Set(
      [
        ...people.flatMap((person) => person.sourceDetails),
        ...initiatives.flatMap((initiative) => initiative.evidenceDetails),
      ]
        .filter((s) => isGroundingRedirect(s.url))
        .map((s) => s.url)
    )
  ).slice(0, 40);

  if (pending.length > 0) {
    const resolved = new Map<string, string | null>();
    const batchSize = 10;
    for (let i = 0; i < pending.length; i += batchSize) {
      if (Date.now() >= deadlineMs) break;
      const requestTimeout = Math.max(
        800,
        Math.min(5_000, deadlineMs - Date.now())
      );
      await Promise.all(
        pending.slice(i, i + batchSize).map(async (url) => {
          try {
            const res = await fetch(url, {
              redirect: 'manual',
              signal: AbortSignal.timeout(requestTimeout),
            });
            const location = res.headers.get('location');
            resolved.set(
              url,
              location && /^https?:\/\//i.test(location) ? location : null
            );
          } catch {
            resolved.set(url, null);
          }
        })
      );
    }

    const rewrite = (sources: ResearchSource[]): ResearchSource[] => {
      const next = new Map<string, ResearchSource>();
      for (const source of sources) {
        if (!isGroundingRedirect(source.url)) {
          next.set(source.url, source);
          continue;
        }
        const destination = resolved.get(source.url);
        if (!destination) continue;
        next.set(destination, { ...source, url: destination });
      }
      return Array.from(next.values());
    };

    for (const person of people) {
      applyPersonSources(person, rewrite(person.sourceDetails));
    }
    for (const initiative of initiatives) {
      applyInitiativeSources(initiative, rewrite(initiative.evidenceDetails));
    }
  }

  const remaining = new Set<string>();
  for (const person of people) {
    for (const source of person.sourceDetails) remaining.add(source.url);
  }
  for (const initiative of initiatives) {
    for (const source of initiative.evidenceDetails) remaining.add(source.url);
  }
  if (remaining.size === 0) return;

  const dead = await deadSourceUrls(remaining, deadlineMs);
  if (dead.size === 0) return;
  for (const person of people) {
    applyPersonSources(
      person,
      person.sourceDetails.filter((s) => !dead.has(s.url))
    );
  }
  for (const initiative of initiatives) {
    applyInitiativeSources(
      initiative,
      initiative.evidenceDetails.filter((s) => !dead.has(s.url))
    );
  }
}

/**
 * HEAD-check candidate URLs and return the ones that definitively do not
 * resolve (404/410). Timeouts, 403s, and other ambiguous responses are kept —
 * only a certain "gone" answer drops a citation.
 */
export async function deadSourceUrls(
  urls: Iterable<string>,
  deadlineMs = Number.POSITIVE_INFINITY
): Promise<Set<string>> {
  const dead = new Set<string>();
  const list = Array.from(urls).slice(0, 48);
  const batchSize = 12;
  for (let i = 0; i < list.length; i += batchSize) {
    if (Date.now() >= deadlineMs) break;
    const requestTimeout = Math.max(
      800,
      Math.min(3_500, deadlineMs - Date.now())
    );
    await Promise.all(
      list.slice(i, i + batchSize).map(async (url) => {
        try {
          const res = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(requestTimeout),
          });
          if (res.status === 404 || res.status === 410) dead.add(url);
        } catch {
          // Unreachable is not proof the citation is dead — keep it.
        }
      })
    );
  }
  return dead;
}

// Public suffixes where the meaningful publisher boundary sits one level up.
const MULTI_PART_SUFFIXES = new Set([
  'ac.uk',
  'co.uk',
  'gov.uk',
  'org.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'com.br',
  'com.cn',
  'com.hk',
  'com.mx',
  'com.sg',
  'com.tw',
  'co.kr',
  'co.nz',
  'co.in',
]);

/**
 * Registrable domain of a source — subdomains of one publisher (e.g.
 * ir.hubspot.com vs hubspot.com) count as a single corroborating source.
 */
function sourceDomain(source: ResearchSource): string {
  try {
    const hostname = new URL(source.url).hostname
      .replace(/^www\./, '')
      .toLowerCase();
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length <= 2) return hostname;
    const lastTwo = labels.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) {
      return labels.slice(-3).join('.');
    }
    return lastTwo;
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

export function normalizePeople(
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
      : typeof p.confidence === 'number'
        ? p.confidence >= 0.8
          ? 'high'
          : p.confidence >= 0.5
            ? 'medium'
            : 'low'
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

  // Hard budget for the whole pipeline so the work finishes inside the
  // serverless function limit; every provider attempt and post-processing
  // phase honors this cutoff.
  const deadlineMs = Date.now() + 52_000;

  try {
    const initiativesPromise = requestedFocus
      ? Promise.resolve(null)
      : chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: initiativesPrompt(domain) },
        ], { webSearch: true, maxTokens: 4000, deadlineMs }).catch(() => null);
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
        ], { webSearch: true, maxTokens: 4000, deadlineMs });
        const parsed = extractJson(result.content) as {
          companyName?: unknown;
          people?: unknown;
        };
        return { parsed, provider: result.provider };
      })
    );
    for (const pass of passes) {
      if (pass.status === 'rejected') {
        console.warn(
          `[research] pass failed: ${String(pass.reason).slice(0, 200)}`
        );
      }
    }
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
    if (missing.length > 0 && deadlineMs - Date.now() > 15_000) {
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
        ], { webSearch: true, maxTokens: 4000, deadlineMs });
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
    // Reserve a few seconds so the JSON response can still be sent.
    await resolveSourceUrls(people, initiatives, deadlineMs - 2_500);
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
