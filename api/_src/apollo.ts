/**
 * Apollo (api.apollo.io) — paid enrichment tier. Two-step because
 * /mixed_people/api_search returns obfuscated records (first_name +
 * "Po***r", no email/linkedin): the search yields ids + headcount, then
 * /people/bulk_match resolves each id into a full person (name, title,
 * linkedin, email). Both endpoints are credit-gated; APOLLO_API_KEY must be
 * a master key.
 */
const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const SEARCH_PAGE_SIZE = 100;
const BULK_MATCH_CHUNK = 10;

export interface ApolloEnrichedPerson {
  name: string;
  title: string | null;
  location: string | null;
  linkedin: string | null;
  email: string | null;
  jobLevel: string | null;
  functionHint: string | null;
  sourceUrl: string | null;
  raw: unknown;
}

export interface ApolloOrgPeople {
  companyName: string | null;
  people: ApolloEnrichedPerson[];
  /** Apollo's reported headcount for the domain (total_entries from search). */
  total: number | null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function apolloPost(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  deadlineMs: number
): Promise<Record<string, unknown> | null> {
  const remaining = deadlineMs - Date.now();
  if (remaining < 1_000) return null;
  try {
    const response = await fetch(`${APOLLO_BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'cache-control': 'no-cache',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface SearchHit {
  id: string;
  firstName: string | null;
  title: string | null;
  orgName: string | null;
}

/** Page api_search until `max` ids or the last page; returns hits + total. */
async function apolloSearchPeople(
  domain: string,
  apiKey: string,
  opts: { max: number; deadlineMs: number; onProgress?: (n: number) => void }
): Promise<{ hits: SearchHit[]; total: number | null }> {
  const hits: SearchHit[] = [];
  let total: number | null = null;
  for (let page = 1; page <= 20; page += 1) {
    if (hits.length >= opts.max || Date.now() >= opts.deadlineMs) break;
    const payload = await apolloPost(
      '/mixed_people/api_search',
      {
        q_organization_domains_list: [domain],
        per_page: SEARCH_PAGE_SIZE,
        page,
      },
      apiKey,
      opts.deadlineMs
    );
    if (!payload) break;
    const people = Array.isArray(payload.people) ? payload.people : [];
    const pagination =
      payload.pagination && typeof payload.pagination === 'object'
        ? (payload.pagination as Record<string, unknown>)
        : {};
    if (typeof payload.total_entries === 'number') total = payload.total_entries;
    if (typeof pagination.total_entries === 'number') {
      total = pagination.total_entries;
    }
    for (const row of people) {
      const hit = (row ?? {}) as Record<string, unknown>;
      const id = text(hit.id);
      if (!id) continue;
      const org =
        hit.organization && typeof hit.organization === 'object'
          ? (hit.organization as Record<string, unknown>)
          : {};
      hits.push({
        id,
        firstName: text(hit.first_name),
        title: text(hit.title),
        orgName: text(org.name),
      });
    }
    opts.onProgress?.(hits.length);
    if (people.length < SEARCH_PAGE_SIZE) break;
  }
  return { hits: hits.slice(0, opts.max), total };
}

/** Apollo seniority ('c_suite', 'senior', ...) → strings seniorityFromLevel parses. */
function apolloJobLevel(seniority: string | null): string | null {
  if (!seniority) return null;
  return seniority === 'c_suite' ? 'c_level' : seniority;
}

function matchToPerson(
  match: Record<string, unknown>,
  fallback: SearchHit
): ApolloEnrichedPerson | null {
  const person =
    match.person && typeof match.person === 'object'
      ? (match.person as Record<string, unknown>)
      : match;
  const name =
    text(person.name) ??
    ([text(person.first_name) ?? fallback.firstName, text(person.last_name)]
      .filter(Boolean)
      .join(' ') ||
      fallback.firstName);
  if (!name) return null;
  const departments = Array.isArray(person.departments) ? person.departments : [];
  const functions = Array.isArray(person.functions) ? person.functions : [];
  const location =
    [text(person.city), text(person.state), text(person.country)]
      .filter(Boolean)
      .join(', ') || null;
  return {
    name,
    title: text(person.title) ?? fallback.title,
    location,
    linkedin: text(person.linkedin_url),
    email: text(person.email),
    jobLevel: apolloJobLevel(text(person.seniority)),
    functionHint: text(departments[0] ?? functions[0]),
    sourceUrl: `https://app.apollo.io/#/people/${text(match.id) ?? fallback.id}`,
    raw: match,
  };
}

/**
 * Full org pull: search for ids, then bulk_match to enrich each one.
 * Returns null when nothing usable came back (bad key, no matches, network).
 */
export async function apolloOrgPeople(
  domain: string,
  opts: {
    max: number;
    deadlineMs: number;
    onProgress?: (n: number) => void;
  }
): Promise<ApolloOrgPeople | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;

  const { hits, total } = await apolloSearchPeople(domain, apiKey, opts);
  if (hits.length === 0) return total ? { companyName: null, people: [], total } : null;
  const companyName = hits.find((h) => h.orgName)?.orgName ?? null;

  const people: ApolloEnrichedPerson[] = [];
  for (let start = 0; start < hits.length; start += BULK_MATCH_CHUNK) {
    if (Date.now() >= opts.deadlineMs) break;
    const chunk = hits.slice(start, start + BULK_MATCH_CHUNK);
    const payload = await apolloPost(
      '/people/bulk_match',
      {
        details: chunk.map((hit) => ({ id: hit.id })),
        reveal_personal_emails: false,
      },
      apiKey,
      opts.deadlineMs
    );
    if (!payload) break;
    const matches = Array.isArray(payload.matches) ? payload.matches : [];
    for (const match of matches) {
      if (!match || typeof match !== 'object') continue;
      const row = match as Record<string, unknown>;
      const id = text(row.id);
      const fallback = hits.find((h) => h.id === id);
      if (!fallback) continue;
      const person = matchToPerson(row, fallback);
      if (person) people.push(person);
    }
    opts.onProgress?.(hits.length === 0 ? 0 : people.length);
  }
  return { companyName, people, total: total ?? people.length };
}
