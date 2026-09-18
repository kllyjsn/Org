import type { CompanyProfile } from './types.js';

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
}

const COMPANY_PROFILE_QUERY =
  'Company profile for DOMAIN: official company name, one-line description, ' +
  'company mission statement, headquarters address, latest annual revenue with ' +
  'year, total employee count, number of software engineers/developers, ' +
  'industry, fiscal year end month (1-12), LinkedIn company page URL, latest ' +
  '10-K or annual report URL, funding stage and total raised. For engineer ' +
  'count, give the estimated number of software engineers/developers employed; ' +
  'return 0 if there is no credible estimate.';

const COMPANY_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    companyName: { type: 'string' },
    description: { type: 'string' },
    mission: { type: 'string' },
    headquarters: { type: 'string' },
    annualRevenue: { type: 'string' },
    employeeCount: { type: 'number' },
    engineerCount: { type: 'number' },
    industry: { type: 'string' },
    fiscalYearEndMonth: { type: 'number' },
    linkedinUrl: { type: 'string' },
    annualReportUrl: { type: 'string' },
    funding: { type: 'string' },
  },
  required: [
    'companyName',
    'description',
    'mission',
    'headquarters',
    'annualRevenue',
    'employeeCount',
    'engineerCount',
    'industry',
    'fiscalYearEndMonth',
    'linkedinUrl',
    'annualReportUrl',
    'funding',
  ],
  additionalProperties: false,
} as const;

const UNKNOWN_PREFIXES = [
  'unknown',
  'n/a',
  'not available',
  'not publicly available',
  'not disclosed',
  'none',
];

function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  return UNKNOWN_PREFIXES.some((prefix) => lowered.startsWith(prefix))
    ? null
    : trimmed;
}

function normalizedNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || UNKNOWN_PREFIXES.some((prefix) => text.toLowerCase().startsWith(prefix))) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedUrl(value: unknown): string | null {
  const url = normalizedString(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function parseAnnualRevenueUsd(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(
    /\$?(\d+(?:\.\d+)?)\s*(billion|bn|b|million|mm|m|k|thousand)?/i
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier =
    /^(billion|bn|b)$/i.test(match[2] ?? '')
      ? 1e9
      : /^(million|mm|m)$/i.test(match[2] ?? '')
        ? 1e6
        : /^(k|thousand)$/i.test(match[2] ?? '')
          ? 1e3
          : 1;
  return amount * multiplier;
}

export function normalizeCompanyProfile(
  answer: unknown,
  citations: unknown,
  retrievedAt: string
): CompanyProfile {
  const value =
    answer && typeof answer === 'object'
      ? (answer as Record<string, unknown>)
      : {};
  const linkedinUrl = normalizedUrl(value.linkedinUrl)?.replace(/\/+$/, '') ?? null;
  const annualRevenue = normalizedString(value.annualRevenue);
  const fiscalYearEndMonth = normalizedNumber(value.fiscalYearEndMonth);
  const employeeCount = normalizedNumber(value.employeeCount);
  const normalizedEngineerCount = normalizedNumber(value.engineerCount);
  const engineerCount =
    normalizedEngineerCount !== null &&
    normalizedEngineerCount >= 5 &&
    (employeeCount === null || normalizedEngineerCount <= employeeCount)
      ? normalizedEngineerCount
      : null;
  const citationsList = Array.isArray(citations) ? citations : [];
  const sources = Array.from(
    new Set(
      citationsList.flatMap((citation) => {
        const url =
          citation && typeof citation === 'object'
            ? normalizedUrl((citation as Record<string, unknown>).url)
            : null;
        return url ? [url] : [];
      })
    )
  );
  return {
    companyName: normalizedString(value.companyName),
    description: normalizedString(value.description),
    mission: normalizedString(value.mission),
    headquarters: normalizedString(value.headquarters),
    annualRevenue,
    annualRevenueUsd: parseAnnualRevenueUsd(annualRevenue),
    employeeCount,
    engineerCount,
    industry: normalizedString(value.industry),
    fiscalYearEndMonth:
      fiscalYearEndMonth !== null &&
      fiscalYearEndMonth >= 1 &&
      fiscalYearEndMonth <= 12
        ? fiscalYearEndMonth
        : null,
    linkedinUrl,
    annualReportUrl: normalizedUrl(value.annualReportUrl),
    funding: normalizedString(value.funding),
    sources,
    retrievedAt,
  };
}

export async function exaCompanyProfile(
  domain: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<CompanyProfile | null> {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl('https://api.exa.ai/answer', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify({
        query: COMPANY_PROFILE_QUERY.replace('DOMAIN', domain),
        text: false,
        outputSchema: COMPANY_PROFILE_SCHEMA,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const payload = (await response.json()) as {
      answer?: unknown;
      citations?: unknown;
    };
    if (!payload.answer || typeof payload.answer !== 'object') return null;
    return normalizeCompanyProfile(
      payload.answer,
      payload.citations,
      new Date().toISOString()
    );
  } catch {
    return null;
  }
}

export async function exaPeopleContext(
  domain: string,
  focus?: string
): Promise<string> {
  const key = process.env.EXA_API_KEY;
  if (!key) return '';
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify({
      query:
        `People, leadership, teams, and employee profiles at ${domain}. ` +
        (focus ? `Focus on ${focus}.` : 'Cover functions beyond executives.'),
      type: 'auto',
      numResults: 15,
      contents: { text: { maxCharacters: 900 } },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return '';
  }
  const payload = (await response.json()) as { results?: ExaResult[] };
  const results = (payload.results ?? []).flatMap((result) => {
    if (!result.url) return [];
    return [
      `- ${result.title ?? 'Profile result'}\n  URL: ${result.url}\n  ` +
        `Excerpt: ${(result.text ?? '').replace(/\s+/g, ' ').slice(0, 900)}`,
    ];
  });
  return results.length > 0
    ? `\n\nAdditional Exa discovery leads. Treat these only as candidates: verify the
person and current title against the linked page before citing them.\n${results.join('\n')}`
    : '';
}
