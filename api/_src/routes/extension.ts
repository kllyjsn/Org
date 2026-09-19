import { bad, param, type App } from '../http.js';
import { query } from '../db.js';
import {
  canWrite,
  freeMapLimitReached,
  insertMap,
  mapForUser,
  PLAN_LIMIT_MESSAGE,
  recordAnalytics,
  requireAuth,
  requireExtensionAuth,
  workspaceAccessFor,
  workspacesFor,
} from '../authz.js';
import { sanitizeState } from '../sanitize.js';
import { DOMAIN_RE } from '../research.js';
import { mapCreationMetrics } from '../analytics.js';
import { publicUser } from '../auth.js';
import {
  createExtensionToken,
  listExtensionTokens,
  parseExtensionPeople,
  publicToken,
  revokeExtensionToken,
  rosterInputsFromExtension,
} from '../extension-tokens.js';
import {
  knownPersonKeys,
  personKeyFor,
  rosterCounts,
  upsertRosterPeople,
} from '../roster.js';
import type { MapRow } from '../types.js';

// Token management uses the web session; data routes use bearer tokens.

function normalizeDomain(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '')
    : '';
}

export function registerExtensionRoutes(app: App): void {
  app.get('/api/extension/tokens', requireAuth, async (c) => {
    return c.json({ tokens: await listExtensionTokens(c.get('user').id) });
  });

  app.post('/api/extension/tokens', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const label = typeof body?.label === 'string' ? body.label : '';
    const existing = await listExtensionTokens(user.id);
    if (existing.length >= 10) return bad(c, 'revoke an existing token first (max 10)');
    const { token, row } = await createExtensionToken(user.id, label);
    return c.json({ token, record: publicToken(row) }, 201);
  });

  app.delete('/api/extension/tokens/:id', requireAuth, async (c) => {
    const removed = await revokeExtensionToken(c.get('user').id, param(c, 'id'));
    if (!removed) return bad(c, 'token not found', 404);
    return c.json({ ok: true });
  });

  app.get('/api/extension/me', requireExtensionAuth, async (c) => {
    const user = c.get('user');
    const workspaces = await workspacesFor(user);
    return c.json({
      user: publicUser(user),
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    });
  });

  app.get('/api/extension/accounts', requireExtensionAuth, async (c) => {
    const user = c.get('user');
    const domain = normalizeDomain(c.req.query('domain'));
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
    const workspaces = await workspacesFor(user);
    const accounts: {
      id: string;
      name: string;
      domain: string;
      companyName: string | null;
      workspace: { id: string; name: string };
      peopleCount: number;
      match: 'domain' | 'query' | null;
    }[] = [];
    for (const workspace of workspaces) {
      const access = await workspaceAccessFor(user, workspace.id);
      if (!access) continue;
      const rows = await query<MapRow & { people_count: number }>(
        `SELECT id, name, domain, company_name,
                COALESCE(jsonb_array_length(state->'people'), 0)::int AS people_count
         FROM maps WHERE workspace_id = $1
         ${access.scoped
           ? 'AND id IN (SELECT map_id FROM member_map_access WHERE workspace_id = $1 AND user_id = $2)'
           : ''}
         ORDER BY updated_at DESC LIMIT 200`,
        access.scoped ? [workspace.id, user.id] : [workspace.id]
      );
      for (const row of rows) {
        const rowDomain = normalizeDomain(row.domain);
        const haystack = `${row.name} ${rowDomain} ${row.company_name ?? ''}`.toLowerCase();
        const match: 'domain' | 'query' | null =
          domain && rowDomain === domain
            ? 'domain'
            : q && haystack.includes(q)
              ? 'query'
              : null;
        if ((domain || q) && !match) continue;
        accounts.push({
          id: row.id,
          name: row.name,
          domain: row.domain,
          companyName: row.company_name,
          workspace: { id: workspace.id, name: workspace.name },
          peopleCount: row.people_count,
          match,
        });
      }
    }
    accounts.sort((a, b) => (a.match === 'domain' ? -1 : 0) - (b.match === 'domain' ? -1 : 0));
    return c.json({ accounts: accounts.slice(0, 50) });
  });

  app.post('/api/extension/accounts', requireExtensionAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const domain = normalizeDomain(body?.domain);
    if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
    const workspaces = await workspacesFor(user);
    const wsId =
      typeof body?.workspaceId === 'string' && body.workspaceId
        ? body.workspaceId
        : workspaces[0]?.id ?? '';
    const access = await workspaceAccessFor(user, wsId);
    if (!access || !canWrite(access.role)) return bad(c, 'insufficient role', 403);
    const existing = await query<{ id: string }>(
      'SELECT id FROM maps WHERE workspace_id = $1 AND LOWER(domain) = $2 LIMIT 1',
      [wsId, domain]
    );
    if (existing[0]) return c.json({ id: existing[0].id, created: false });
    if (await freeMapLimitReached(user, wsId)) {
      return c.json({ error: PLAN_LIMIT_MESSAGE, code: 'plan_limit' }, 402);
    }
    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : domain;
    // Blank state with a refresh cadence: the background refresher
    // (`/api/cron/refresh`) researches it on its next tick.
    const state = sanitizeState({ meta: { companyName: name, refreshCadence: 'weekly' } });
    const id = await insertMap({ wsId, name, domain, state, user, scoped: access.scoped });
    await recordAnalytics({
      eventName: 'map_created',
      userId: user.id,
      workspaceId: wsId,
      mapId: id,
      properties: mapCreationMetrics({
        creationMode: 'blank',
        provider: null,
        researchedAt: null,
        peopleCount: 0,
        sourceCount: 0,
        initiativeCount: 0,
        edgeCount: 0,
        researchStartedAt: undefined,
      }),
    });
    return c.json({ id, created: true }, 201);
  });

  app.post('/api/extension/roster', requireExtensionAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const mapId = typeof body?.mapId === 'string' ? body.mapId : '';
    const [map, role] = await mapForUser(user, mapId);
    if (!map || !role) return bad(c, 'account not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot add roster people', 403);
    const source = body?.source === 'sales_navigator' ? 'sales_navigator' : 'linkedin_url';
    const people = parseExtensionPeople(body?.people);
    if (people.length === 0) return bad(c, 'people required');
    const inputs = rosterInputsFromExtension(people, source);
    const known = await knownPersonKeys(map.workspace_id, map.domain, inputs);
    const result = await upsertRosterPeople(map.workspace_id, map.domain, inputs);
    const alreadyKnown = inputs.filter((input) =>
      known.has(personKeyFor(input.name, input.linkedin))
    ).length;
    await recordAnalytics({
      eventName: 'roster_imported',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { source, count: people.length, already_known: alreadyKnown },
    });
    return c.json({
      upserted: result.upserted,
      alreadyKnown,
      counts: await rosterCounts(map.workspace_id, map.domain),
    });
  });
}
