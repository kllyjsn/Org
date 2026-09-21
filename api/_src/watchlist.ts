import { randomUUID } from 'node:crypto';
import { now, query } from './db.js';
import { chat } from './llm.js';
import { extractJson } from './research.js';
import { canonicalPersonName } from './research.js';
import { personKeyFor } from './roster.js';
import type { MapRow, MapState, Person } from './types.js';

export interface WatchedPersonRow {
  id: string;
  workspace_id: string;
  map_id: string;
  person_id: string;
  person_key: string;
  name: string;
  title: string | null;
  role: string | null;
  company_name: string | null;
  domain: string;
  linkedin: string | null;
  status: 'watching' | 'moved' | 'departed';
  next_check_at: string;
  last_checked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface PersonSignalRow {
  id: string;
  workspace_id: string;
  watch_id: string;
  map_id: string;
  kind: 'moved' | 'departed';
  title: string;
  detail: string | null;
  new_company: string | null;
  new_title: string | null;
  new_domain: string | null;
  sources: unknown;
  created_at: string;
  dismissed_at: string | null;
}

const CHECK_INTERVAL_MS = 7 * 86_400_000;

function nextCheck(): string {
  return new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
}

export async function toggleWatch(
  map: MapRow,
  personId: string,
  userId: string
): Promise<{ watching: boolean; watch: WatchedPersonRow | null }> {
  const existing = await query<WatchedPersonRow>(
    'SELECT * FROM watched_people WHERE map_id = $1 AND person_id = $2',
    [map.id, personId]
  );
  if (existing[0]) {
    await query('DELETE FROM watched_people WHERE id = $1', [existing[0].id]);
    return { watching: false, watch: null };
  }
  const state = map.state as MapState;
  const person = (state.people ?? []).find((p) => p.id === personId);
  if (!person) return { watching: false, watch: null };
  const row: WatchedPersonRow = {
    id: randomUUID(),
    workspace_id: map.workspace_id,
    map_id: map.id,
    person_id: person.id,
    person_key: personKeyFor(person.name, person.linkedin),
    name: person.name,
    title: person.title || null,
    role: person.role ?? null,
    company_name: state.meta?.companyName ?? map.company_name,
    domain: map.domain,
    linkedin: person.linkedin,
    status: 'watching',
    next_check_at: now(),
    last_checked_at: null,
    created_by: userId,
    created_at: now(),
  };
  await query(
    `INSERT INTO watched_people
       (id, workspace_id, map_id, person_id, person_key, name, title, role,
        company_name, domain, linkedin, status, next_check_at, last_checked_at,
        created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      row.id, row.workspace_id, row.map_id, row.person_id, row.person_key,
      row.name, row.title, row.role, row.company_name, row.domain, row.linkedin,
      row.status, row.next_check_at, row.last_checked_at, row.created_by,
      row.created_at,
    ]
  );
  return { watching: true, watch: row };
}

export async function watchForPerson(
  mapId: string,
  personId: string
): Promise<WatchedPersonRow | null> {
  const rows = await query<WatchedPersonRow>(
    'SELECT * FROM watched_people WHERE map_id = $1 AND person_id = $2',
    [mapId, personId]
  );
  return rows[0] ?? null;
}

export async function listWorkspaceSignals(
  workspaceId: string
): Promise<(PersonSignalRow & { map_name: string; person_name: string })[]> {
  return query(
    `SELECT s.*, m.name AS map_name, w.name AS person_name
     FROM person_signals s
     JOIN maps m ON m.id = s.map_id
     JOIN watched_people w ON w.id = s.watch_id
     WHERE s.workspace_id = $1 AND s.dismissed_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [workspaceId]
  );
}

export async function dismissSignal(
  workspaceId: string,
  signalId: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE person_signals SET dismissed_at = $1
     WHERE id = $2 AND workspace_id = $3 AND dismissed_at IS NULL
     RETURNING id`,
    [now(), signalId, workspaceId]
  );
  return rows.length > 0;
}

interface TraceResult {
  status: 'same_company' | 'moved' | 'departed' | 'unknown';
  currentCompany: string | null;
  currentTitle: string | null;
  currentDomain: string | null;
  evidence: string[];
}

function sameCompany(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(
        /\b(inc|llc|ltd|corp|corporation|company|co|group|holdings|technologies|labs)\b/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

export function parseTrace(content: string): TraceResult {
  const parsed = extractJson(content) as Record<string, unknown>;
  const status =
    parsed.status === 'same_company' ||
    parsed.status === 'moved' ||
    parsed.status === 'departed'
      ? parsed.status
      : 'unknown';
  const text = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;
  return {
    status,
    currentCompany: text(parsed.currentCompany),
    currentTitle: text(parsed.currentTitle),
    currentDomain: text(parsed.currentDomain)?.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') ?? null,
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence
          .filter(
            (item): item is string =>
              typeof item === 'string' && /^https?:\/\//i.test(item)
          )
          .slice(0, 4)
      : [],
  };
}

async function tracePerson(watch: WatchedPersonRow): Promise<TraceResult> {
  const result = await chat(
    [
      {
        role: 'system',
        content:
          'You verify employment from public web evidence. When unsure, answer "unknown" — never guess.',
      },
      {
        role: 'user',
        content: `Where does ${watch.name} work right now?

They were previously "${watch.title ?? 'unknown title'}" at ${watch.company_name ?? watch.domain} (${watch.domain}).
${watch.linkedin ? `LinkedIn: ${watch.linkedin}` : ''}

Search the public web (LinkedIn, company pages, press, conference bios).
- If evidence shows them still at ${watch.company_name ?? watch.domain}: status "same_company".
- If evidence shows them at a different employer: status "moved".
- If evidence shows they left and no new employer is findable: status "departed".
- If the evidence is thin or contradictory: status "unknown".

Return JSON only:
{
  "status": "same_company|moved|departed|unknown",
  "currentCompany": "current employer name or null",
  "currentTitle": "current job title or null",
  "currentDomain": "current employer domain like acme.com or null",
  "evidence": ["urls supporting the answer"]
}`,
      },
    ],
    { maxTokens: 1_200, json: true, webSearch: true, deadlineMs: Date.now() + 20_000 }
  );
  return parseTrace(result.content);
}

async function latestSignal(
  watchId: string
): Promise<Pick<PersonSignalRow, 'kind' | 'new_company'> | null> {
  const rows = await query<Pick<PersonSignalRow, 'kind' | 'new_company'>>(
    `SELECT kind, new_company FROM person_signals
     WHERE watch_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [watchId]
  );
  return rows[0] ?? null;
}

async function createSignal(
  watch: WatchedPersonRow,
  kind: PersonSignalRow['kind'],
  trace: TraceResult
) {
  const latest = await latestSignal(watch.id);
  if (
    latest &&
    latest.kind === kind &&
    (latest.new_company ?? null) === (trace.currentCompany ?? null)
  ) {
    return null;
  }
  const id = randomUUID();
  const title =
    kind === 'moved'
      ? `${watch.name} moved to ${trace.currentCompany ?? 'a new company'}`
      : `${watch.name} appears to have left ${watch.company_name ?? watch.domain}`;
  const detail =
    kind === 'moved'
      ? `${watch.title ?? 'Stakeholder'} at ${watch.company_name ?? watch.domain} → ${trace.currentTitle ?? 'role unknown'} at ${trace.currentCompany}.`
      : `Public evidence no longer shows ${watch.name} at ${watch.company_name ?? watch.domain}, and no new employer surfaced yet.`;
  await query(
    `INSERT INTO person_signals
       (id, workspace_id, watch_id, map_id, kind, title, detail,
        new_company, new_title, new_domain, sources, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id, watch.workspace_id, watch.id, watch.map_id, kind, title, detail,
      trace.currentCompany, trace.currentTitle, trace.currentDomain,
      JSON.stringify(trace.evidence), now(),
    ]
  );
  return id;
}

/** Trace one watched person; update watch state and emit a signal on a move. */
export async function checkWatchedPerson(
  watch: WatchedPersonRow,
  traceImpl: (w: WatchedPersonRow) => Promise<TraceResult> = tracePerson
): Promise<'checked' | 'error'> {
  try {
    const trace = await traceImpl(watch);
    if (trace.status === 'moved' && trace.currentCompany) {
      const moved = !sameCompany(trace.currentCompany, watch.company_name);
      if (moved) {
        await createSignal(watch, 'moved', trace);
        await query(
          `UPDATE watched_people
           SET status = 'moved', company_name = $1, domain = COALESCE($2, domain),
               title = COALESCE($3, title), last_checked_at = $4, next_check_at = $5
           WHERE id = $6`,
          [
            trace.currentCompany,
            trace.currentDomain,
            trace.currentTitle,
            now(),
            nextCheck(),
            watch.id,
          ]
        );
        return 'checked';
      }
    }
    if (trace.status === 'departed') {
      await createSignal(watch, 'departed', trace);
      await query(
        `UPDATE watched_people
         SET status = 'departed', last_checked_at = $1, next_check_at = $2
         WHERE id = $3`,
        [now(), nextCheck(), watch.id]
      );
      return 'checked';
    }
    // same_company or unknown — keep watching, reschedule.
    await query(
      `UPDATE watched_people
       SET status = 'watching', title = COALESCE($1, title),
           last_checked_at = $2, next_check_at = $3
       WHERE id = $4`,
      [
        trace.status === 'same_company' ? trace.currentTitle : null,
        now(),
        nextCheck(),
        watch.id,
      ]
    );
    return 'checked';
  } catch (error) {
    console.warn(`[watchlist] trace failed for ${watch.name}:`, error);
    await query(
      `UPDATE watched_people SET next_check_at = $1 WHERE id = $2`,
      [new Date(Date.now() + 86_400_000).toISOString(), watch.id]
    );
    return 'error';
  }
}

/**
 * Cron step: trace up to `limit` watched people whose check is due.
 * Small batches keep the serverless function inside its time budget.
 */
export async function processDueWatches(limit = 3): Promise<{
  processed: number;
  errors: number;
}> {
  const due = await query<WatchedPersonRow>(
    `SELECT * FROM watched_people
     WHERE next_check_at <= $1
     ORDER BY next_check_at ASC
     LIMIT $2`,
    [now(), limit]
  );
  let errors = 0;
  for (const watch of due) {
    const outcome = await checkWatchedPerson(watch);
    if (outcome === 'error') errors += 1;
  }
  return { processed: due.length, errors };
}

/**
 * After a map refresh, any watched person missing from the fresh research may
 * have left — schedule an immediate trace instead of waiting a full cycle.
 */
export function flagAbsentWatchlistPeople(
  map: MapRow,
  result: { people: { name: string }[] }
): Promise<number> {
  const names = new Set(
    result.people.map((p) => canonicalPersonName(p.name ?? ''))
  );
  return (async () => {
    const watches = await query<WatchedPersonRow>(
      `SELECT * FROM watched_people WHERE map_id = $1 AND status = 'watching'`,
      [map.id]
    );
    let flagged = 0;
    for (const watch of watches) {
      const person = (map.state as MapState).people?.find(
        (p: Person) => p.id === watch.person_id
      );
      const key = canonicalPersonName(person?.name ?? watch.name);
      if (!names.has(key)) {
        await query(
          `UPDATE watched_people SET next_check_at = $1 WHERE id = $2`,
          [now(), watch.id]
        );
        flagged += 1;
      }
    }
    return flagged;
  })();
}
