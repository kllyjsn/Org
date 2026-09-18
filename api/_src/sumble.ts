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

function idOf(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/**
 * Sumble's job_function is granular ("Platform Engineer", "AI Engineer") —
 * feeding it straight to department would splinter lanes into one-person
 * rows. Collapse it into the department buckets the canvas groups by, and
 * keep the granular function as the team.
 */
const DEPARTMENT_PATTERNS: [RegExp, string][] = [
  [/^executives?$|founder|owner|chief|\bcxo\b|\bce[foorst]\b|\bpresident\b/i, 'Executive'],
  [/engineer|developer|software|devops|sre|platform|infrastructure|architect|automation|technician/i, 'Engineering'],
  [/data|machine learning|\bml\b|\bai\b|analytics|scientist|annotat/i, 'Engineering'],
  [/information technology|\bit\b|systems|help ?desk/i, 'Engineering'],
  [/product (manager|owner|lead|designer)|product/i, 'Product'],
  [/\bdesign(er)?\b|\bux\b|\bui\b|\bcreative\b|brand design/i, 'Design'],
  [/marketing|brand|communications|content|demand|media|social|growth marketing/i, 'Marketing'],
  [/\bsales\b|account executive|business development|\brevenue\b|partnership|\bgrowth\b/i, 'Sales'],
  [/financ|accounting|controller|procurement|treasury|payroll|billing/i, 'Finance'],
  [/recruit|talent|human resources|\bhr\b|\bpeople\b|learning|\bdevelopment\b|training/i, 'People'],
  [/legal|lawyer|counsel|attorney|paralegal|compliance|governance/i, 'Legal'],
  [/security|trust|safety/i, 'Security'],
  [/customer|support|success|service|experience/i, 'Customer Success'],
  [/analyst|operations|\bops\b|program|project|administrat|facilit|coordinator|office/i, 'Operations'],
];

export function canonicalDepartment(
  jobFunctionOrTitle: string | null
): string | null {
  if (!jobFunctionOrTitle) return null;
  const value = jobFunctionOrTitle.trim();
  if (!value || /^uncategorized$/i.test(value)) return null;
  // "Executive Assistant" is a support role, not the exec row.
  if (/(executive|administrative|personal|virtual)\s+(assistant|coordinator)/i.test(value)) {
    return 'Operations';
  }
  for (const [re, department] of DEPARTMENT_PATTERNS) {
    if (re.test(value)) return department;
  }
  return 'Other';
}

/**
 * Convert Sumble people + team memberships into the same raw person shape the
 * LLM passes produce, so everything flows through one normalizePeople merge.
 * Pure and exported for tests.
 */
export function sumblePeopleToRaw(
  people: unknown[],
  teamByName: Map<string, string>,
  managerByName: Map<string, string> = new Map()
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of people) {
    if (!row || typeof row !== 'object') continue;
    const rowRecord = row as Record<string, unknown>;
    // Rows carry paid fields under `attributes`; fall back to flat rows.
    const p = (
      rowRecord.attributes && typeof rowRecord.attributes === 'object'
        ? rowRecord.attributes
        : rowRecord
    ) as Record<string, unknown>;
    const name = textOf(p.name);
    const title = textOf(p.job_title ?? p.title);
    if (!name || !title) continue;
    const linkedin = textOf(p.linkedin_url);
    const sumbleUrl = textOf(rowRecord.sumble_url ?? p.sumble_url);
    const jobFunction = textOf(p.job_function);
    const team =
      teamByName.get(name.trim().toLowerCase()) ??
      (jobFunction && canonicalDepartment(jobFunction) ? jobFunction : null);
    const reportsTo = managerByName.get(name.trim().toLowerCase()) ?? null;
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
      department: canonicalDepartment(jobFunction ?? title),
      team,
      productLine: null,
      teamEvidence: sources.length > 0 ? 'sourced' : 'inferred',
      reportsTo,
      confidence: 'medium',
      sources,
      linkedin,
      jobLevel: textOf(p.job_level),
    });
  }
  return out;
}

/**
 * Build person-name → team-name membership from teams' related_people. Keys are
 * lowercase trimmed names; callers canonicalize the same way.
 */
/** "breadcrumbs" may be strings or {name} objects; leaf-most entry wins. */
function breadcrumbLeaf(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const names = value
    .map(textOf)
    .filter((entry): entry is string => !!entry);
  return names.at(-1) ?? null;
}

export function sumbleTeamMemberships(teams: unknown[]): Map<string, string> {
  const memberships = new Map<string, string>();
  for (const row of teams) {
    if (!row || typeof row !== 'object') continue;
    const rowRecord = row as Record<string, unknown>;
    const team = (
      rowRecord.attributes && typeof rowRecord.attributes === 'object'
        ? rowRecord.attributes
        : rowRecord
    ) as Record<string, unknown>;
    const teamName =
      textOf(team.name ?? rowRecord.name) ??
      breadcrumbLeaf(team.breadcrumbs ?? rowRecord.breadcrumbs);
    if (!teamName) continue;
    const relatedSource = team.related_people ?? rowRecord.related_people;
    const related = Array.isArray(relatedSource) ? relatedSource : [];
    for (const person of related) {
      if (!person || typeof person !== 'object') continue;
      const personRecord = person as Record<string, unknown>;
      const personAttrs = (
        personRecord.attributes && typeof personRecord.attributes === 'object'
          ? personRecord.attributes
          : personRecord
      ) as Record<string, unknown>;
      const name = textOf(personAttrs.name);
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
  /** Org-wide headcount reported by /people — sizes the merge cap. */
  total: number | null;
}

function relatedName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const attrs = (
    record.attributes && typeof record.attributes === 'object'
      ? record.attributes
      : record
  ) as Record<string, unknown>;
  return textOf(attrs.name);
}

function relatedTitle(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const attrs = (
    record.attributes && typeof record.attributes === 'object'
      ? record.attributes
      : record
  ) as Record<string, unknown>;
  return textOf(attrs.job_title ?? attrs.title);
}

function relatedUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return textOf(record.sumble_url);
}

/**
 * From a /people response carrying related_people, build the name → manager
 * map and extra people rows for names not covered by the main pull — this is
 * where real reporting edges come from.
 */
export function sumbleRelationships(people: unknown[]): {
  managerByName: Map<string, string>;
  extraPeople: Record<string, unknown>[];
} {
  const managerByName = new Map<string, string>();
  const extraPeople: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of people) {
    if (!row || typeof row !== 'object') continue;
    const rowRecord = row as Record<string, unknown>;
    const p = (
      rowRecord.attributes && typeof rowRecord.attributes === 'object'
        ? rowRecord.attributes
        : rowRecord
    ) as Record<string, unknown>;
    const name = textOf(p.name);
    if (!name) continue;
    const key = name.trim().toLowerCase();
    const related = rowRecord.related_people;
    if (!related || typeof related !== 'object') continue;
    const rel = related as Record<string, unknown>;
    const managers = Array.isArray(rel.managers) ? rel.managers : [];
    const reports = Array.isArray(rel.direct_reports) ? rel.direct_reports : [];
    const manager = relatedName(managers[0]);
    if (manager && !managerByName.has(key)) {
      managerByName.set(key, manager);
    }
    for (const entry of reports) {
      const reportName = relatedName(entry);
      if (!reportName) continue;
      const reportKey = reportName.trim().toLowerCase();
      if (!managerByName.has(reportKey)) managerByName.set(reportKey, name);
    }
    // Related people are named employees even when they fall outside the top
    // N pull — surface them as sourced nodes rather than dropping the data.
    for (const entry of [...managers, ...reports]) {
      const relatedNameValue = relatedName(entry);
      if (!relatedNameValue) continue;
      const relatedKey = relatedNameValue.trim().toLowerCase();
      if (seen.has(relatedKey)) continue;
      seen.add(relatedKey);
      const title = relatedTitle(entry);
      const url = relatedUrl(entry);
      extraPeople.push({
        name: relatedNameValue,
        title: title ?? 'Employee',
        department: canonicalDepartment(title),
        team: null,
        productLine: null,
        teamEvidence: 'sourced',
        reportsTo: managerByName.get(relatedKey) ?? null,
        confidence: 'medium',
        sources: url && /^https?:\/\//i.test(url)
          ? [
              {
                url,
                title: 'Sumble profile',
                publisher: 'Sumble',
                sourceType: 'profile',
              },
            ]
          : [],
        linkedin: null,
        jobLevel: null,
      });
    }
  }
  return { managerByName, extraPeople };
}

/**
 * Resolve a domain to Sumble's organization, then pull its people (ordered by
 * job level for seniority + depth), its extracted teams for membership, and
 * manager/direct-report relationships for real reporting edges. Returns null
 * when the key is missing, the org is unknown, or the budget expires —
 * callers treat it as a best-effort enrichment layer.
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
      select: { attributes: ['id', 'name'] },
    },
    apiKey,
    deadlineMs
  );
  const orgRow = rowsOf(orgPayload, 'organizations')[0] as
    | Record<string, unknown>
    | undefined;
  const org = (orgRow?.attributes ?? orgRow) as
    | Record<string, unknown>
    | undefined;
  const orgId = org ? idOf(org.id ?? org.organization_id) : null;
  if (!orgId) return null;

  const remaining = deadlineMs - Date.now();
  if (remaining < 2_000) return null;
  const innerDeadline = Date.now() + remaining;

  const [peoplePayload, teamsPayload, relatedPayload] = await Promise.all([
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
        limit: 200,
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
          attributes: ['name', 'breadcrumbs'],
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
    // related_people is list-mode only (limit ≤ 25): a separate call against
    // the senior-most people, where reporting relationships actually live.
    sumbleCall(
      '/people',
      {
        filter: { organization_ids: [orgId] },
        select: {
          attributes: ['name', 'job_title'],
          related_people: {
            attributes: ['name', 'job_title'],
            direction: ['managers', 'direct_reports'],
          },
        },
        limit: 25,
        order_by_column: 'job_level',
        order_by_direction: 'DESC',
      },
      apiKey,
      innerDeadline
    ),
  ]);

  const teams = rowsOf(teamsPayload, 'teams');
  const teamByName = sumbleTeamMemberships(teams);
  const { managerByName, extraPeople } = sumbleRelationships(
    rowsOf(relatedPayload, 'people')
  );
  const people = sumblePeopleToRaw(
    rowsOf(peoplePayload, 'people'),
    teamByName,
    managerByName
  );
  const covered = new Set(people.map((p) => String(p.name).toLowerCase()));
  const extra = extraPeople.filter((p) => !covered.has(String(p.name).toLowerCase()));
  const combined = [...people, ...extra];
  if (combined.length === 0) return null;
  const total =
    typeof peoplePayload?.total === 'number' ? peoplePayload.total : null;
  return {
    companyName: textOf(org?.name),
    people: combined,
    total,
  };
}
