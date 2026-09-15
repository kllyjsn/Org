/**
 * Sumble (api.sumble.com) — structured organization data used to deepen maps:
 * canonical job functions/levels, team hierarchies extracted from job posts,
 * and each person's LinkedIn URL. All endpoints are async jobs (v8+): POST
 * returns a request_id, the same endpoint is polled until it succeeds.
 */
const SUMBLE_BASE = 'https://api.sumble.com/v9';

interface SumbleResponse {
  request_id?: string;
  status?: string;
  [key: string]: unknown;
}

async function sumblePost(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  deadlineMs: number
): Promise<SumbleResponse | null> {
  const remaining = deadlineMs - Date.now();
  if (remaining < 1_200) return null;
  try {
    const response = await fetch(`${SUMBLE_BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, remaining))),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return (await response.json()) as SumbleResponse;
  } catch {
    return null;
  }
}

/** POST a job, then poll the same endpoint until it succeeds/fails/times out. */
async function sumbleCall(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  deadlineMs: number
): Promise<SumbleResponse | null> {
  let payload = await sumblePost(path, body, apiKey, deadlineMs);
  for (let poll = 0; poll < 40; poll += 1) {
    if (
      !payload ||
      typeof payload.request_id !== 'string' ||
      (payload.status !== 'pending' && payload.status !== 'running')
    ) {
      break;
    }
    const wait = Math.min(1_500, deadlineMs - Date.now());
    if (wait <= 0) return null;
    await new Promise((resolve) => setTimeout(resolve, wait));
    payload = await sumblePost(
      path,
      { request_id: payload.request_id },
      apiKey,
      deadlineMs
    );
  }
  if (!payload || payload.status === 'failed') return null;
  return payload;
}

function rowsOf(payload: SumbleResponse | null, key: string): unknown[] {
  if (!payload) return [];
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['name', 'label', 'title', 'slug']) {
      if (typeof record[key] === 'string' && record[key].trim()) {
        return (record[key] as string).trim();
      }
    }
  }
  return null;
}

function idOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** "breadcrumbs" may be strings or {name} objects; leaf-most entry wins. */
function breadcrumbLeaf(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const names = value
    .map(textOf)
    .filter((entry): entry is string => !!entry);
  return names.at(-1) ?? null;
}

/**
 * Convert Sumble people + team memberships into the same raw person shape the
 * LLM passes produce, so everything flows through one normalizePeople merge.
 * Pure and exported for tests.
 */
export function sumblePeopleToRaw(
  people: unknown[],
  teamByName: Map<string, string>
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of people) {
    if (!row || typeof row !== 'object') continue;
    const p = row as Record<string, unknown>;
    const name = textOf(p.name);
    const title = textOf(p.job_title ?? p.title);
    if (!name || !title) continue;
    const linkedin = textOf(p.linkedin_url);
    const sumbleUrl = textOf(p.sumble_url);
    const department = textOf(p.job_function);
    const team = teamByName.get(name.trim().toLowerCase()) ?? null;
    const sources = [sumbleUrl, linkedin]
      .filter((url): url is string => !!url && /^https?:\/\//i.test(url))
      .map((url) => ({
        url,
        title: url.includes('sumble.com') ? 'Sumble profile' : 'LinkedIn profile',
        publisher: url.includes('sumble.com') ? 'Sumble' : 'LinkedIn',
        sourceType: 'profile',
      }));
    out.push({
      name,
      title,
      department,
      team,
      productLine: null,
      teamEvidence: sources.length > 0 ? 'sourced' : 'inferred',
      reportsTo: null,
      confidence: 'medium',
      sources,
      linkedin,
    });
  }
  return out;
}

/**
 * Build person-name → team-name membership from teams' related_people. Keys are
 * lowercase trimmed names; callers canonicalize the same way.
 */
export function sumbleTeamMemberships(teams: unknown[]): Map<string, string> {
  const memberships = new Map<string, string>();
  for (const row of teams) {
    if (!row || typeof row !== 'object') continue;
    const team = row as Record<string, unknown>;
    const teamName = textOf(team.name);
    if (!teamName) continue;
    const related = Array.isArray(team.related_people) ? team.related_people : [];
    for (const person of related) {
      if (!person || typeof person !== 'object') continue;
      const name = textOf((person as Record<string, unknown>).name);
      if (!name) continue;
      const key = name.trim().toLowerCase();
      if (!memberships.has(key)) memberships.set(key, teamName);
    }
  }
  return memberships;
}

export interface SumbleOrgData {
  companyName: string | null;
  people: Record<string, unknown>[];
}

/**
 * Resolve a domain to Sumble's organization, then pull its people (ordered by
 * job level for seniority + depth) and its extracted teams for membership.
 * Returns null when the key is missing, the org is unknown, or the budget
 * expires — callers treat it as a best-effort enrichment layer.
 */
export async function sumbleOrgPeople(
  domain: string,
  deadlineMs: number
): Promise<SumbleOrgData | null> {
  const apiKey = process.env.SUMBLE_API_KEY;
  if (!apiKey) return null;

  const orgPayload = await sumbleCall(
    '/organizations',
    {
      organizations: [{ url: domain }],
      select: { attributes: ['name'] },
    },
    apiKey,
    deadlineMs
  );
  const org = rowsOf(orgPayload, 'organizations')[0] as
    | Record<string, unknown>
    | undefined;
  const orgId = org ? idOf(org.id ?? org.organization_id) : null;
  if (!orgId) return null;

  const remaining = deadlineMs - Date.now();
  if (remaining < 2_000) return null;
  const innerDeadline = Date.now() + remaining;

  const [peoplePayload, teamsPayload] = await Promise.all([
    sumbleCall(
      '/people',
      {
        filter: { organization_ids: [orgId] },
        select: {
          attributes: [
            'name',
            'job_title',
            'job_function',
            'job_level',
            'linkedin_url',
            'location',
          ],
        },
        limit: 80,
        order_by_column: 'job_level',
        order_by_direction: 'DESC',
      },
      apiKey,
      innerDeadline
    ),
    sumbleCall(
      '/teams',
      {
        filter: { organization_ids: [orgId] },
        select: {
          attributes: ['breadcrumbs'],
          related_people: {
            attributes: ['name', 'job_title'],
            max_per_team: 10,
          },
        },
        limit: 25,
      },
      apiKey,
      innerDeadline
    ),
  ]);

  const teams = rowsOf(teamsPayload, 'teams');
  const teamByName = sumbleTeamMemberships(teams);
  const people = sumblePeopleToRaw(rowsOf(peoplePayload, 'people'), teamByName);
  if (people.length === 0) return null;
  return {
    companyName: textOf(org?.name),
    people,
  };
}
