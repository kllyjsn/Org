import { randomUUID } from 'node:crypto';
import { bad, param, type App } from '../http.js';
import { query } from '../db.js';
import {
  canWrite,
  mapForUser,
  requireAuth,
  saveMapState,
} from '../authz.js';
import { canonicalPersonName } from '../research.js';
import { rowsFromCsv, rowsFromLinkedinUrls, linkedinSlug } from '../csv.js';
import { configuredRosterProviders } from '../roster-providers.js';
import {
  listRoster,
  rosterCounts,
  type RosterPersonRow,
  setRosterStatus,
  upsertRosterPeople,
} from '../roster.js';
import {
  buildChartSuggestion,
  refineWithLlm,
  type Confidence,
} from '../suggest-chart.js';
import { listPersonas } from '../personas.js';
import { isFn, isSeniority } from '../taxonomy.js';
import {
  createRosterSyncJob,
  getRosterSyncJob,
  runRosterSync,
} from '../roster-sync.js';
import {
  classifyTitle,
  functionToDepartment,
  seniorityToJobLevel,
} from '../classify.js';
import type { Fn, Seniority } from '../classify.js';
import { activeProvider } from '../llm.js';
import type { MapGroup, MapRow, MapState } from '../types.js';

async function materializeRosterRows(
  map: MapRow,
  userId: string,
  rows: RosterPersonRow[],
  opts: {
    groupIdByRosterId?: Map<string, string>;
    reportsToRosterIdByRosterId?: Map<string, string>;
    reportsToPersonIdByRosterId?: Map<string, string>;
    confidenceByRosterId?: Map<string, Confidence>;
    groups?: MapGroup[];
  } = {}
): Promise<{ map: MapRow; added: number }> {
  const pending = rows.filter((row) => row.status !== 'added');
  if (pending.length === 0) return { map, added: 0 };
  const state = map.state as MapState;
  const existing = state.people;
  const baseX = existing.length ? Math.min(...existing.map((person) => person.x)) : 0;
  const baseY = existing.length ? Math.max(...existing.map((person) => person.y)) + 240 : 0;
  const additions = pending.map((row, index) => {
    const classified = classifyTitle(row.title);
    const fn = (row.function || classified.function) as Fn;
    return {
      id: randomUUID(),
      name: row.name,
      title: row.title ?? 'Employee',
      department: functionToDepartment(fn),
      team: null,
      role: 'none' as const,
      confidence: opts.confidenceByRosterId?.get(row.id) ?? row.confidence,
      sources: row.source_url
        ? [row.source_url]
        : row.linkedin
          ? [row.linkedin]
          : [],
      notes: '',
      email: row.email,
      linkedin: row.linkedin,
      jobLevel: seniorityToJobLevel(
        (row.seniority || classified.seniority) as Seniority
      ),
      ...(opts.groupIdByRosterId?.get(row.id)
        ? { groupId: opts.groupIdByRosterId.get(row.id) }
        : {}),
      x: baseX + (index % 4) * 260,
      y: baseY + Math.floor(index / 4) * 140,
    };
  });
  const keyToId = new Map<string, string>();
  const rosterManagers = await query<{
    person_key: string;
    map_person_id: string;
  }>(
    `SELECT person_key, map_person_id FROM roster_people
     WHERE workspace_id = $1 AND domain = $2 AND status = 'added' AND map_person_id IS NOT NULL`,
    [map.workspace_id, map.domain.trim().toLowerCase()]
  );
  for (const row of rosterManagers) {
    keyToId.set(row.person_key, row.map_person_id);
  }
  for (const person of existing) {
    keyToId.set(canonicalPersonName(person.name), person.id);
    const linkedinKey = linkedinSlug(person.linkedin);
    if (linkedinKey) keyToId.set(linkedinKey, person.id);
  }
  for (const person of additions) {
    keyToId.set(canonicalPersonName(person.name), person.id);
    const linkedinKey = linkedinSlug(person.linkedin);
    if (linkedinKey) keyToId.set(linkedinKey, person.id);
  }
  const edges = [...state.edges];
  const edgeKeys = new Set(edges.map((edge) => `${edge.from}:${edge.to}:${edge.kind}`));
  for (let index = 0; index < pending.length; index += 1) {
    const manager = pending[index].manager_key ? keyToId.get(pending[index].manager_key!) : undefined;
    const explicitManagerRosterId = opts.reportsToRosterIdByRosterId?.get(pending[index].id);
    const explicitManagerPersonId = opts.reportsToPersonIdByRosterId?.get(pending[index].id);
    const explicitManager = explicitManagerRosterId
      ? additions[pending.findIndex((row) => row.id === explicitManagerRosterId)]?.id
      : explicitManagerPersonId;
    const target = explicitManager ?? manager;
    if (target && target !== additions[index].id &&
        !edgeKeys.has(`${target}:${additions[index].id}:reports`)) {
      edges.push({
        id: randomUUID(),
        from: target,
        to: additions[index].id,
        kind: 'reports',
        label: null,
      });
      edgeKeys.add(`${target}:${additions[index].id}:reports`);
    }
  }
  let nextGroups = state.groups ? [...state.groups] : [];
  if (opts.groups?.length) {
    const byId = new Map(opts.groups.map((group) => [group.id, group]));
    const referenced = new Set(
      pending
        .map((row) => opts.groupIdByRosterId?.get(row.id))
        .filter((id): id is string => Boolean(id))
    );
    for (const id of [...referenced]) {
      let cursor = byId.get(id);
      while (cursor) {
        referenced.add(cursor.id);
        cursor = cursor.parentGroupId ? byId.get(cursor.parentGroupId) : undefined;
      }
    }
    const existingById = new Map(nextGroups.map((group) => [group.id, group]));
    for (const group of opts.groups) {
      if (referenced.has(group.id)) existingById.set(group.id, group);
    }
    nextGroups = [...existingById.values()];
  }
  const nextState: MapState = {
    ...state,
    people: [...existing, ...additions],
    edges,
    ...(nextGroups.length ? { groups: nextGroups } : {}),
  };
  const savedMap = await saveMapState(map, nextState, userId);
  await setRosterStatus(
    map.workspace_id,
    map.domain,
    pending.map((row) => row.id),
    'added',
    new Map(
      pending.map((row, index) => [row.id, additions[index].id])
    )
  );
  return { map: savedMap, added: additions.length };
}

async function allSuggestionRoster(
  workspaceId: string,
  domain: string
): Promise<RosterPersonRow[]> {
  const statuses = await Promise.all(
    (['suggested', 'added'] as const).map(async (status) => {
      const rows: RosterPersonRow[] = [];
      for (let page = 0; ; page += 1) {
        const result = await listRoster(workspaceId, domain, {
          status,
          page,
          pageSize: 200,
        });
        rows.push(...result.people);
        if (result.people.length < 200) break;
      }
      return rows;
    })
  );
  return [...statuses[0], ...statuses[1]];
}

export function registerRosterRoutes(app: App): void {
  app.get('/api/maps/:id/roster', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const pageSize = Math.min(
      200,
      Math.max(1, Number(c.req.query('pageSize') ?? 50) || 50)
    );
    const page = Math.max(0, Number(c.req.query('page') ?? 0) || 0);
    const data = await listRoster(map.workspace_id, map.domain, {
      q: c.req.query('q') || undefined,
      function: c.req.query('function') || undefined,
      seniority: c.req.query('seniority') || undefined,
      status: c.req.query('status') || 'suggested',
      source: c.req.query('source') || undefined,
      page,
      pageSize,
    });
    return c.json({
      ...data,
      counts: await rosterCounts(map.workspace_id, map.domain),
      providers: configuredRosterProviders(),
    });
  });

  app.post('/api/maps/:id/roster/sync', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot sync roster', 403);
    const existing = await query<{ id: string }>(
      `SELECT id FROM roster_sync_jobs
       WHERE map_id = $1 AND status IN ('queued', 'running')
       LIMIT 1`,
      [map.id]
    );
    if (existing[0]) {
      return c.json(
        {
          error: 'roster sync already running',
          jobId: existing[0].id,
        },
        409
      );
    }
    const job = await createRosterSyncJob({
      workspaceId: map.workspace_id,
      mapId: map.id,
      userId: user.id,
      domain: map.domain,
    });
    if (!process.env.VERCEL) {
      void runRosterSync(job.id).catch((error) =>
        console.error('roster sync failed', error)
      );
    }
    return c.json({ jobId: job.id }, 202);
  });

  app.get('/api/maps/:id/roster/sync/:jobId', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const job = await getRosterSyncJob(param(c, 'jobId'));
    if (!job || job.map_id !== map.id) return bad(c, 'roster sync job not found', 404);
    if (job.status === 'queued' && !process.env.VERCEL) {
      void runRosterSync(job.id).catch((error) =>
        console.error('roster sync tick failed', error)
      );
    }
    return c.json({
      job: {
        id: job.id,
        status: job.status,
        events: job.events,
        summary: job.summary,
        error: job.error,
      },
    });
  });

  app.post('/api/maps/:id/roster/import', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot import roster', 403);
    const body = await c.req.json().catch(() => null);
    const rows =
      typeof body?.csv === 'string'
        ? rowsFromCsv(body.csv).map((row) => ({
            ...row,
            source: 'csv' as const,
            confidence: 'medium' as const,
          }))
        : Array.isArray(body?.linkedinUrls)
          ? rowsFromLinkedinUrls(
              body.linkedinUrls.filter(
                (value: unknown): value is string => typeof value === 'string'
              )
            ).map((row) => ({
              ...row,
              source: 'linkedin_url' as const,
              confidence: 'low' as const,
            }))
          : [];
    if (rows.length === 0) return bad(c, 'csv or linkedinUrls required');
    const result = await upsertRosterPeople(
      map.workspace_id,
      map.domain,
      rows.map((row) => ({
        name: row.name,
        title: row.title,
        location: row.location,
        linkedin: row.linkedin,
        email: row.email,
        managerKey: row.manager
          ? canonicalPersonName(row.manager)
          : null,
        source: row.source,
        confidence: row.confidence,
        sourceUrl: row.linkedin,
        raw: row,
      }))
    );
    return c.json({
      imported: result.upserted,
      counts: await rosterCounts(map.workspace_id, map.domain),
    });
  });

  app.post('/api/maps/:id/roster/add', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot add roster people', 403);
    const body = await c.req.json().catch(() => null);
    const ids = Array.isArray(body?.ids)
      ? body.ids
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 200)
      : [];
    const rows = await query<RosterPersonRow>(
      `SELECT * FROM roster_people WHERE workspace_id = $1 AND domain = $2 AND id = ANY($3::text[])`,
      [map.workspace_id, map.domain.trim().toLowerCase(), ids]
    );
    const pending = rows.filter((row) => row.status !== 'added');
    if (pending.length === 0) return c.json({ map: { ...map, role }, added: 0 });
    const materialized = await materializeRosterRows(map, user.id, pending);
    return c.json({ map: { ...materialized.map, role }, added: materialized.added });
  });

  app.post('/api/maps/:id/suggest-chart', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const body = await c.req.json().catch(() => null);
    if (body?.guidance !== undefined &&
        (typeof body.guidance !== 'string' || body.guidance.length > 2000)) {
      return bad(c, 'guidance must be a string of at most 2000 characters');
    }
    if (body?.excludeRosterIds !== undefined &&
        (!Array.isArray(body.excludeRosterIds) ||
          body.excludeRosterIds.length > 2000 ||
          body.excludeRosterIds.some((id: unknown) => typeof id !== 'string'))) {
      return bad(c, 'excludeRosterIds must contain at most 2000 strings');
    }
    if (body?.limit !== undefined &&
        (typeof body.limit !== 'number' || !Number.isFinite(body.limit))) {
      return bad(c, 'limit must be a number');
    }
    const functions = Array.isArray(body?.functions)
      ? body.functions.filter(isFn)
      : undefined;
    const minSeniority = isSeniority(body?.minSeniority)
      ? body.minSeniority
      : undefined;
    const started = Date.now();
    const roster = await allSuggestionRoster(map.workspace_id, map.domain);
    const personas = body?.personasOnly
      ? await listPersonas(map.workspace_id)
      : undefined;
    let suggestion = buildChartSuggestion({
      roster,
      mapPeople: (map.state as MapState).people ?? [],
      mapEdges: (map.state as MapState).edges ?? [],
      personas,
      options: {
        functions,
        minSeniority,
        limit: typeof body?.limit === 'number' ? body.limit : undefined,
        personasOnly: body?.personasOnly === true,
        guidance: typeof body?.guidance === 'string' ? body.guidance : undefined,
        excludeRosterIds: body?.excludeRosterIds,
      },
    });
    const guidance = typeof body?.guidance === 'string' ? body.guidance.trim() : '';
    if (guidance && activeProvider() !== 'fixture') {
      suggestion = await refineWithLlm(suggestion, guidance);
    }
    return c.json({ suggestion, tookMs: Date.now() - started });
  });

  app.post('/api/maps/:id/suggest-chart/apply', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot apply chart suggestions', 403);
    const body = await c.req.json().catch(() => null);
    const accept = body?.accept;
    if (
      body?.decline?.rosterIds !== undefined &&
      (!Array.isArray(body.decline.rosterIds) ||
        body.decline.rosterIds.length > 2000 ||
        body.decline.rosterIds.some((id: unknown) => typeof id !== 'string'))
    ) {
      return bad(c, 'decline.rosterIds must contain at most 2000 strings');
    }
    const declineIds = Array.isArray(body?.decline?.rosterIds)
      ? body.decline.rosterIds as string[]
      : [];
    if (!accept || !Array.isArray(accept.people) || !Array.isArray(accept.groups)) {
      return bad(c, 'accept groups and people are required');
    }
    if (accept.people.length > 1000 || accept.groups.length > 200) {
      return bad(c, 'too many accepted people or groups');
    }
    const groups: MapGroup[] = accept.groups.flatMap((item: unknown): MapGroup[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      if (typeof value.id !== 'string' || typeof value.name !== 'string') return [];
      return [{
        id: value.id,
        name: value.name,
        parentGroupId:
          typeof value.parentGroupId === 'string' || value.parentGroupId === null
            ? value.parentGroupId
            : null,
        ...(typeof value.function === 'string' || value.function === null
          ? { function: value.function }
          : {}),
      }];
    });
    const acceptedPeople: {
      rosterId: string;
      groupId: string;
      reportsToRosterId: string | null;
      reportsToPersonId: string | null;
      confidence: Confidence;
    }[] = accept.people.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      if (typeof value.rosterId !== 'string' || typeof value.groupId !== 'string') return [];
      const confidence: Confidence =
        value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low'
          ? value.confidence
          : 'low';
      return [{
        rosterId: value.rosterId,
        groupId: value.groupId,
        reportsToRosterId:
          typeof value.reportsToRosterId === 'string' ? value.reportsToRosterId : null,
        reportsToPersonId:
          typeof value.reportsToPersonId === 'string' ? value.reportsToPersonId : null,
        confidence,
      }];
    });
    let added = 0;
    let responseMap = map;
    if (acceptedPeople.length > 0) {
      const acceptedIds = acceptedPeople.map((person) => person.rosterId);
      const rows = await query<RosterPersonRow>(
        `SELECT * FROM roster_people
         WHERE workspace_id = $1 AND domain = $2 AND id = ANY($3::text[]) AND status = 'suggested'`,
        [map.workspace_id, map.domain.trim().toLowerCase(), acceptedIds]
      );
      const materialized = await materializeRosterRows(map, user.id, rows, {
        groupIdByRosterId: new Map(acceptedPeople.map((person) => [person.rosterId, person.groupId])),
        reportsToRosterIdByRosterId: new Map(
          acceptedPeople
            .filter((person) => person.reportsToRosterId)
            .map((person) => [person.rosterId, person.reportsToRosterId!])
        ),
        reportsToPersonIdByRosterId: new Map(
          acceptedPeople
            .filter((person) => person.reportsToPersonId)
            .map((person) => [person.rosterId, person.reportsToPersonId!])
        ),
        confidenceByRosterId: new Map(acceptedPeople.map((person) => [person.rosterId, person.confidence])),
        groups,
      });
      responseMap = materialized.map;
      added = materialized.added;
    }
    const declineRows = await query<{ id: string }>(
      `SELECT id FROM roster_people
       WHERE workspace_id = $1 AND domain = $2 AND status = 'suggested' AND id = ANY($3::text[])`,
      [map.workspace_id, map.domain.trim().toLowerCase(), declineIds]
    );
    if (declineRows.length > 0) {
      await setRosterStatus(
        map.workspace_id,
        map.domain,
        declineRows.map((row) => row.id),
        'dismissed'
      );
    }
    return c.json({
      map: { ...responseMap, role },
      added,
      declined: declineRows.length,
    });
  });

  for (const action of ['dismiss', 'restore'] as const) {
    app.post(`/api/maps/:id/roster/${action}`, requireAuth, async (c) => {
      const user = c.get('user');
      const [map, role] = await mapForUser(user, param(c, 'id'));
      if (!map || !role) return bad(c, 'not found', 404);
      if (!canWrite(role)) return bad(c, 'viewers cannot update roster', 403);
      const body = await c.req.json().catch(() => null);
      const ids = Array.isArray(body?.ids)
        ? body.ids
            .filter((id: unknown): id is string => typeof id === 'string')
            .slice(0, 200)
        : [];
      await setRosterStatus(
        map.workspace_id,
        map.domain,
        ids,
        action === 'dismiss' ? 'dismissed' : 'suggested',
        undefined,
        action === 'restore'
      );
      return c.json({ ok: true });
    });
  }
}
