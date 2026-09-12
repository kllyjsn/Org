import { chat, activeProvider, type Provider } from './llm.js';
import type { Confidence } from './types.js';

export interface ResearchedPerson {
  name: string;
  title: string;
  department: string | null;
  reportsToName: string | null;
  confidence: Confidence;
  source: string | null;
}

export interface ResearchResult {
  companyName: string | null;
  domain: string;
  people: ResearchedPerson[];
  provider: Provider;
  tier: 'T0';
  demo: boolean;
}

const SYSTEM_PROMPT = `You are an analyst mapping the organizational structure of companies.
You answer only with strict JSON. No markdown, no prose, no footnotes.`;

function researchPrompt(domain: string): string {
  return `Map the leadership org chart of the company at domain "${domain}".

Use public sources: the company's leadership/team/about pages, press releases,
news coverage, SEC filings (10-K, DEF 14A) for public companies, and public
job postings.

Identify up to 25 current employees — executives first, then functional and
department heads (sales, engineering, product, finance, marketing, people,
legal, security, operations).

Return ONLY this JSON object:
{
  "companyName": "string",
  "people": [
    {
      "name": "full name",
      "title": "current job title",
      "department": "string or null",
      "reportsTo": "full name of their manager, or null if unknown/CEO",
      "confidence": "high | medium | low",
      "source": "one short source label or URL"
    }
  ]
}

Rules:
- Only include real people you found evidence for in public sources.
- "high" confidence = named on the company's official site or filings.
- "medium" = credible secondary source (press, reputable directories).
- "low" = inferred or possibly stale.
- If you cannot verify the manager, use null — do not guess.
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

function normalizePeople(raw: unknown): ResearchedPerson[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const people: ResearchedPerson[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? stripFootnotes(p.name) : '';
    const title = typeof p.title === 'string' ? stripFootnotes(p.title) : '';
    if (!name || !title) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const conf = CONFIDENCES.includes(p.confidence as Confidence)
      ? (p.confidence as Confidence)
      : 'low';
    people.push({
      name,
      title,
      department:
        typeof p.department === 'string' ? stripFootnotes(p.department) : null,
      reportsToName:
        typeof p.reportsTo === 'string' && p.reportsTo.trim()
          ? stripFootnotes(p.reportsTo)
          : null,
      confidence: conf,
      source: typeof p.source === 'string' ? stripFootnotes(p.source) : null,
    });
    if (people.length >= 25) break;
  }
  return people;
}

/** Clearly-labeled demo chart so the product is usable with no LLM key. */
function fixtureOrg(domain: string): ResearchResult {
  const people: ResearchedPerson[] = [
    { name: 'Alex Morgan', title: 'Chief Executive Officer', department: 'Executive', reportsToName: null, confidence: 'low', source: 'demo fixture' },
    { name: 'Sam Chen', title: 'Chief Revenue Officer', department: 'Sales', reportsToName: 'Alex Morgan', confidence: 'low', source: 'demo fixture' },
    { name: 'Priya Patel', title: 'Chief Technology Officer', department: 'Engineering', reportsToName: 'Alex Morgan', confidence: 'low', source: 'demo fixture' },
    { name: 'Jordan Lee', title: 'Chief Financial Officer', department: 'Finance', reportsToName: 'Alex Morgan', confidence: 'low', source: 'demo fixture' },
    { name: 'Casey Rivera', title: 'VP Sales, Americas', department: 'Sales', reportsToName: 'Sam Chen', confidence: 'low', source: 'demo fixture' },
    { name: 'Taylor Kim', title: 'VP Engineering', department: 'Engineering', reportsToName: 'Priya Patel', confidence: 'low', source: 'demo fixture' },
    { name: 'Morgan Diaz', title: 'Head of Security', department: 'Engineering', reportsToName: 'Priya Patel', confidence: 'low', source: 'demo fixture' },
    { name: 'Robin Novak', title: 'VP Marketing', department: 'Marketing', reportsToName: 'Alex Morgan', confidence: 'low', source: 'demo fixture' },
  ];
  return {
    companyName: domain,
    domain,
    people,
    provider: 'fixture',
    tier: 'T0',
    demo: true,
  };
}

export async function researchOrg(domain: string): Promise<ResearchResult> {
  const provider = activeProvider();
  if (provider === 'fixture') return fixtureOrg(domain);

  try {
    const { content } = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: researchPrompt(domain) },
    ]);
    const parsed = extractJson(content) as {
      companyName?: unknown;
      people?: unknown;
    };
    const people = normalizePeople(parsed.people);
    return {
      companyName:
        typeof parsed.companyName === 'string'
          ? stripFootnotes(parsed.companyName)
          : null,
      domain,
      people,
      provider,
      tier: 'T0',
      demo: false,
    };
  } catch (err) {
    // No keys configured at all → clearly-labeled demo chart.
    if (err instanceof Error && err.message === 'No LLM provider key configured')
      return fixtureOrg(domain);
    throw err;
  }
}
