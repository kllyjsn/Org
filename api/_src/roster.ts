import { randomUUID } from 'node:crypto';
import { canonicalPersonName } from './research.js';
import { classifyTitle, SENIORITY_ORDER, seniorityFromLevel, type Fn } from './classify.js';
import { now, query } from './db.js';

export type RosterSource = 'sumble' | 'csv' | 'linkedin_url' | 'research';
export type RosterStatus = 'suggested' | 'added' | 'dismissed';
export interface RosterPersonRow {
  id: string;
  workspace_id: string;
  domain: string;
  person_key: string;
  name: string;
  title: string | null;
  function: string | null;
  seniority: string | null;
  location: string | null;
  linkedin: string | null;
  email: string | null;
  manager_key: string | null;
  source: RosterSource;
  source_url: string | null;
  confidence: 'high' | 'medium' | 'low';
  status: RosterStatus;
  map_person_id: string | null;
  raw: unknown;
  first_seen_at: string;
  last_seen_at: string;
}
export interface RosterUpsertInput {
  name: string;
  title: string | null;
  location: string | null;
  linkedin: string | null;
  email: string | null;
  managerKey: string | null;
  source: RosterSource;
  sourceUrl: string | null;
  confidence?: 'high' | 'medium' | 'low';
  status?: RosterStatus;
  mapPersonId?: string | null;
  raw?: unknown;
  jobLevel?: string | null;
  functionHint?: string | null;
}

export function personKeyFor(
  name: string,
  linkedin: string | null
): string {
  if (linkedin) {
    try {
      const path = new URL(linkedin).pathname.match(/^\/in\/([^/]+)/i)?.[1];
      if (path) return path.toLowerCase();
    } catch { /* use canonical name */ }
  }
  return canonicalPersonName(name);
}

export function mergeRosterRows(
  existing: RosterPersonRow | null,
  incoming: RosterUpsertInput,
  nowIso: string
) {
  const titleClassification = classifyTitle(incoming.title);
  const classification =
    titleClassification.function === 'other' && incoming.functionHint
      ? classifyTitle(incoming.functionHint)
      : titleClassification;
  const seniority =
    seniorityFromLevel(incoming.jobLevel) ?? titleClassification.seniority;
  const fn = classification.function as Fn;
  const bulk = incoming.source === 'sumble';
  const source =
    existing &&
    (existing.source === 'linkedin_url' || existing.source === 'csv') &&
    bulk
      ? incoming.source
      : existing?.source ?? incoming.source;
  return {
    id: existing?.id ?? randomUUID(),
    person_key:
      existing?.person_key ?? personKeyFor(incoming.name, incoming.linkedin),
    name: incoming.name.trim() || existing?.name || 'Unknown',
    title:
      incoming.title &&
      (!existing?.title || incoming.title.length > existing.title.length)
        ? incoming.title
        : existing?.title ?? null,
    function: fn,
    seniority,
    location: incoming.location ?? existing?.location ?? null,
    linkedin: incoming.linkedin ?? existing?.linkedin ?? null,
    email: incoming.email ?? existing?.email ?? null,
    manager_key: incoming.managerKey ?? existing?.manager_key ?? null,
    source,
    source_url: incoming.sourceUrl ?? existing?.source_url ?? null,
    confidence: incoming.confidence ?? existing?.confidence ?? 'medium',
    status:
      existing &&
      existing.status !== 'suggested' &&
      (incoming.status ?? 'suggested') === 'suggested'
        ? existing.status
        : (incoming.status ?? existing?.status ?? 'suggested'),
    map_person_id: existing?.map_person_id ?? incoming.mapPersonId ?? null,
    raw: incoming.raw ?? existing?.raw ?? null,
    first_seen_at: existing?.first_seen_at ?? nowIso,
    last_seen_at: nowIso,
  };
}

export async function upsertRosterPeople(
  workspaceId: string,
  domainInput: string,
  inputs: RosterUpsertInput[]
): Promise<{ upserted: number }> {
  const domain = domainInput.trim().toLowerCase();
  let upserted = 0;
  for (let start = 0; start < inputs.length; start += 200) {
    const chunk = new Map<string, RosterUpsertInput>();
    for (const input of inputs.slice(start, start + 200)) {
      const key = personKeyFor(input.name, input.linkedin);
      chunk.set(key, input);
    }
    const keys = [...chunk.keys()];
    const existingRows =
      keys.length === 0
        ? []
        : await query<RosterPersonRow>(
            'SELECT * FROM roster_people WHERE workspace_id = $1 AND domain = $2 AND person_key = ANY($3::text[])',
            [workspaceId, domain, keys]
          );
    const existingByKey = new Map(existingRows.map((row) => [row.person_key, row]));
    for (const [key, input] of chunk) {
      const existing = existingByKey.get(key) ?? null;
      const merged = mergeRosterRows(existing, { ...input }, now());
      await query(
        `INSERT INTO roster_people
         (
           id, workspace_id, domain, person_key, name, title, "function",
           seniority, location, linkedin, email, manager_key, source, source_url,
           confidence, status, map_person_id, raw, first_seen_at, last_seen_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (workspace_id,domain,person_key) DO UPDATE SET
          name=EXCLUDED.name,title=EXCLUDED.title,"function"=EXCLUDED."function",seniority=EXCLUDED.seniority,
          location=EXCLUDED.location,linkedin=EXCLUDED.linkedin,email=EXCLUDED.email,manager_key=EXCLUDED.manager_key,
          source=EXCLUDED.source,source_url=EXCLUDED.source_url,confidence=EXCLUDED.confidence,status=EXCLUDED.status,
          map_person_id=EXCLUDED.map_person_id,raw=EXCLUDED.raw,last_seen_at=EXCLUDED.last_seen_at`,
        [
          merged.id,
          workspaceId,
          domain,
          merged.person_key,
          merged.name,
          merged.title,
          merged.function,
          merged.seniority,
          merged.location,
          merged.linkedin,
          merged.email,
          merged.manager_key,
          merged.source,
          merged.source_url,
          merged.confidence,
          merged.status,
          merged.map_person_id,
          merged.raw ? JSON.stringify(merged.raw) : null,
          merged.first_seen_at,
          merged.last_seen_at,
        ]
      );
      upserted += 1;
    }
  }
  return { upserted };
}

export async function listRoster(
  workspaceId: string,
  domainInput: string,
  filter: {
    q?: string;
    function?: string;
    seniority?: string;
    status?: string;
    source?: string;
    page: number;
    pageSize: number;
  }
) {
  const domain = domainInput.trim().toLowerCase();
  const status = filter.status || 'suggested';
  const params: unknown[] = [workspaceId, domain, status];
  const clauses = ['workspace_id = $1', 'domain = $2', 'status = $3'];
  if (filter.q) {
    params.push(`%${filter.q}%`);
    clauses.push(
      `(name ILIKE $${params.length} OR title ILIKE $${params.length})`
    );
  }
  if (filter.function) {
    params.push(filter.function);
    clauses.push(`"function" = $${params.length}`);
  }
  if (filter.seniority) {
    params.push(filter.seniority);
    clauses.push(`seniority = $${params.length}`);
  }
  if (filter.source) {
    params.push(filter.source);
    clauses.push(`source = $${params.length}`);
  }
  const where = clauses.join(' AND ');
  const facetRows = await query<{ function: string | null; seniority: string | null }>(
    'SELECT "function", seniority FROM roster_people WHERE workspace_id = $1 AND domain = $2 AND status = $3',
    [workspaceId, domain, status]
  );
  const byFunction: Record<string, number> = {};
  const bySeniority: Record<string, number> = {};
  for (const row of facetRows) {
    if (row.function) {
      byFunction[row.function] = (byFunction[row.function] ?? 0) + 1;
    }
    if (row.seniority) {
      bySeniority[row.seniority] = (bySeniority[row.seniority] ?? 0) + 1;
    }
  }
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM roster_people WHERE ${where}`,
    params
  );
  const limit = Math.min(200, Math.max(1, filter.pageSize || 50));
  const offset = Math.max(0, filter.page || 0) * limit;
  const rows = await query<RosterPersonRow>(
    `SELECT * FROM roster_people WHERE ${where}
     ORDER BY CASE seniority ${SENIORITY_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} ELSE 99 END, name
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return {
    total: Number(countRows[0]?.count ?? 0),
    byFunction,
    bySeniority,
    people: rows,
  };
}

export async function setRosterStatus(
  workspaceId: string,
  domainInput: string,
  ids: string[],
  status: RosterStatus,
  mapPersonIds?: Map<string, string>,
  onlyFromDismissed = false
) {
  const domain = domainInput.trim().toLowerCase();
  for (const id of ids.slice(0, 200)) {
    await query(
      `UPDATE roster_people
       SET status = $1, map_person_id = COALESCE($2, map_person_id), last_seen_at = $3
       WHERE workspace_id = $4 AND domain = $5 AND id = $6
       ${onlyFromDismissed ? "AND status = 'dismissed'" : ''}`,
      [
        status,
        mapPersonIds?.get(id) ?? null,
        now(),
        workspaceId,
        domain,
        id,
      ]
    );
  }
}

export async function rosterCounts(workspaceId: string, domainInput: string) {
  const rows = await query<{ status: RosterStatus; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM roster_people
     WHERE workspace_id = $1 AND domain = $2
     GROUP BY status`,
    [workspaceId, domainInput.trim().toLowerCase()]
  );
  return {
    suggested: Number(
      rows.find((row) => row.status === 'suggested')?.count ?? 0
    ),
    added: Number(rows.find((row) => row.status === 'added')?.count ?? 0),
    dismissed: Number(
      rows.find((row) => row.status === 'dismissed')?.count ?? 0
    ),
  };
}
