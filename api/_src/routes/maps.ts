import { bad, param, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  canWrite,
  freeMapLimitReached,
  insertMap,
  mapForUser,
  PLAN_LIMIT_MESSAGE,
  recordAnalytics,
  requireAuth,
  saveMapState,
  workspaceAccessFor,
  workspaceSellerProfile,
} from '../authz.js';
import { sanitizeState, mapRefinementCounts } from '../sanitize.js';
import { answerAccountQuestion } from '../account-agent.js';
import {
  buildAccountBriefing,
  deepenAccountBriefing,
} from '../briefing.js';
import type { AccountBriefing } from '../briefing.js';
import { deepenAccountStrategy, strategyContext } from '../strategy.js';
import type { StrategyInsights } from '../strategy.js';
import { compareMapStates } from '../changes.js';
import { computeCoverage } from '../coverage.js';
import { ensureDefaultPersonas } from '../personas.js';
import { upsertRosterPeople } from '../roster.js';
import { perUser } from '../rate-limit.js';
import { mapCreationMetrics } from '../analytics.js';
import { randomUUID } from 'node:crypto';
import type {
  MapRow,
  MapState,
  SellerProfile,
} from '../types.js';

export function registerMapRoutes(app: App): void {
  app.get('/api/maps', requireAuth, async (c) => {
    const user = c.get('user');
    const wsId = c.req.query('workspaceId') || '';
    const access = await workspaceAccessFor(user, wsId);
    if (!access) return bad(c, 'not a member', 403);
    const rows = access.scoped
      ? await query<MapRow>(
          `SELECT id, name, domain, company_name, state, is_live_opportunity,
                  created_by, created_at, updated_at
           FROM maps WHERE workspace_id = $1
             AND id IN (
               SELECT map_id FROM member_map_access
               WHERE workspace_id = $1 AND user_id = $2
             )
           ORDER BY updated_at DESC`,
          [wsId, user.id]
        )
      : await query<MapRow>(
          `SELECT id, name, domain, company_name, state, is_live_opportunity,
                  created_by, created_at, updated_at
           FROM maps WHERE workspace_id = $1 ORDER BY updated_at DESC`,
          [wsId]
        );
    return c.json({
      maps: rows.map(({ state, ...m }) => ({
        ...m,
        peopleCount: (state as MapState).people?.length ?? 0,
        initiativeCount:
          (state as MapState).meta?.initiatives?.length ?? 0,
      })),
    });
  });

  app.post('/api/maps', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const access = await workspaceAccessFor(user, wsId);
    if (!access || !canWrite(access.role)) {
      return bad(c, 'insufficient role', 403);
    }
    const workspaceExists = await query('SELECT 1 FROM workspaces WHERE id = $1', [wsId]);
    if (!workspaceExists[0]) return bad(c, 'workspace not found', 404);
    if (await freeMapLimitReached(user, wsId)) {
      return c.json({ error: PLAN_LIMIT_MESSAGE, code: 'plan_limit' }, 402);
    }
    const domain = typeof body?.domain === 'string' ? body.domain.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || !domain) return bad(c, 'name and domain required');
    const state = sanitizeState(body?.state);
    const id = await insertMap({ wsId, name, domain, state, user, scoped: access.scoped });
    if (state.meta.researchedAt && state.people.length > 0) {
      void upsertRosterPeople(
        wsId,
        domain,
        state.people.map((person) => ({
          name: person.name,
          title: person.title,
          location: null,
          linkedin: person.linkedin,
          email: person.email,
          managerKey: null,
          source: 'research' as const,
          sourceUrl: person.sources[0] ?? null,
          confidence: person.confidence,
          status: 'added' as const,
          mapPersonId: person.id,
          jobLevel: person.jobLevel ?? null,
        }))
      ).catch((error) => console.error('research roster import failed', error));
    }
    const sourceCount =
      state.people.reduce((sum, person) => sum + person.sources.length, 0) +
      (state.meta.initiatives ?? []).reduce(
        (sum, initiative) => sum + initiative.evidence.length,
        0
      );
    const analytics =
      body?.analytics && typeof body.analytics === 'object'
        ? (body.analytics as Record<string, unknown>)
        : {};
    const creationMode =
      analytics.creationMode === 'researched' ||
      analytics.creationMode === 'template' ||
      analytics.creationMode === 'blank'
        ? analytics.creationMode
        : state.meta.researchedAt
          ? 'researched'
          : 'blank';
    await recordAnalytics({
      eventName: 'map_created',
      userId: user.id,
      workspaceId: wsId,
      mapId: id,
      properties: mapCreationMetrics({
        creationMode,
        provider: state.meta.provider,
        researchedAt: state.meta.researchedAt,
        peopleCount: state.people.length,
        sourceCount,
        initiativeCount: state.meta.initiatives?.length ?? 0,
        edgeCount: state.edges.length,
        researchStartedAt: analytics.researchStartedAt,
      }),
    });
    return c.json({ id });
  });

  app.get('/api/maps/:id', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    return c.json({ map: { ...map, role } });
  });

  app.get('/api/maps/:id/coverage', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const personas = await ensureDefaultPersonas(
      map.workspace_id,
      await workspaceSellerProfile(map.workspace_id)
    );
    const state = map.state as MapState;
    return c.json(computeCoverage(personas, state.people ?? []));
  });

  app.post('/api/maps/:id/ask', requireAuth, perUser('ask', 60, 60 * 60_000), async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const body = await c.req.json().catch(() => null);
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const messages = rawMessages.flatMap(
      (message: unknown): { role: 'user' | 'assistant'; content: string }[] => {
        if (!message || typeof message !== 'object') return [];
        const candidate = message as Record<string, unknown>;
        if (
          (candidate.role !== 'user' && candidate.role !== 'assistant') ||
          typeof candidate.content !== 'string' ||
          !candidate.content.trim()
        ) {
          return [];
        }
        return [{
          role: candidate.role,
          content: candidate.content.trim().slice(0, 2_000),
        }];
      }
    ).slice(-10);
    if (messages.length === 0 || messages.at(-1)?.role !== 'user') {
      return bad(c, 'a user question is required');
    }

    try {
      const answer = await answerAccountQuestion(map.state as MapState, messages);
      await recordAnalytics({
        eventName: 'account_agent_used',
        userId: user.id,
        workspaceId: map.workspace_id,
        mapId: map.id,
        properties: {
          citation_count: answer.citations.length,
          action_count: answer.actions.length,
        },
      });
      return c.json(answer);
    } catch (error) {
      console.error('account analyst failed', error);
      return bad(c, 'account analyst is temporarily unavailable', 502);
    }
  });

  app.patch('/api/maps/:id', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot edit', 403);
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : map.name;
    const state =
      body?.state !== undefined ? sanitizeState(body.state) : (map.state as MapState);
    const refinements =
      body?.state !== undefined
        ? mapRefinementCounts(map.state as MapState, state)
        : { fieldChanges: 0, relationshipChanges: 0 };
    // Version snapshots only on real state changes — name-only PATCHes and
    // autosave heartbeats would otherwise drown meaningful checkpoints.
    if (body?.state !== undefined) {
      await saveMapState(map, state, user.id, name);
    } else {
      await query(
        'UPDATE maps SET name = $1, state = $2, company_name = $3, updated_at = $4 WHERE id = $5',
        [name, JSON.stringify(state), state.meta?.companyName ?? map.company_name, now(), map.id]
      );
    }
    const updated = await query<{ updated_at: string }>(
      'SELECT updated_at FROM maps WHERE id = $1',
      [map.id]
    );
    if (refinements.fieldChanges > 0 || refinements.relationshipChanges > 0) {
      await recordAnalytics({
        eventName: 'map_refined',
        userId: user.id,
        workspaceId: map.workspace_id,
        mapId: map.id,
        properties: {
          field_changes: refinements.fieldChanges,
          relationship_changes: refinements.relationshipChanges,
        },
      });
    }
    return c.json({ ok: true, updatedAt: updated[0]?.updated_at ?? now() });
  });

  app.post('/api/maps/:id/opportunity', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot update opportunity status', 403);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.live !== 'boolean') return bad(c, 'live status required');
    await query(
      'UPDATE maps SET is_live_opportunity = $1, updated_at = $2 WHERE id = $3',
      [body.live, now(), map.id]
    );
    await recordAnalytics({
      eventName: 'live_opportunity_set',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { live: body.live },
    });
    return c.json({ live: body.live });
  });

  app.delete('/api/maps/:id', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot delete', 403);
    await query('DELETE FROM maps WHERE id = $1', [map.id]);
    return c.json({ ok: true });
  });

  // ---------- collaborative history and presence ----------

  app.get('/api/maps/:id/versions', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const versions = await query(
      `SELECT v.id, v.name, v.created_at, u.name AS author_name
       FROM map_versions v JOIN users u ON u.id = v.created_by
       WHERE v.map_id = $1 ORDER BY v.created_at DESC LIMIT 50`,
      [map.id]
    );
    return c.json({ versions });
  });

  app.get('/api/maps/:id/changes', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const versions = await query<{ state: MapState; created_at: string }>(
      `SELECT state, created_at FROM map_versions
       WHERE map_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [map.id]
    );
    const baseline = versions[0];
    if (!baseline) return c.json({ baselineAt: null, changes: [] });

    const changes = compareMapStates(baseline.state, map.state as MapState);
    return c.json({ baselineAt: baseline.created_at, changes });
  });

  app.get('/api/maps/:id/briefing', requireAuth, perUser('briefing', 30, 60 * 60_000), async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const versions = await query<{ state: MapState; created_at: string }>(
      `SELECT state, created_at FROM map_versions
       WHERE map_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [map.id]
    );
    const baseline = versions[0];
    const state = map.state as MapState;
    const changes = baseline ? compareMapStates(baseline.state, state) : [];
    const workspaces = await query<{ seller_profile: SellerProfile | null }>(
      'SELECT seller_profile FROM workspaces WHERE id = $1',
      [map.workspace_id]
    );
    const sellerProfile = workspaces[0]?.seller_profile ?? null;
    const cached = await query<{
      briefing: AccountBriefing;
      generated_at: string;
    }>(
      `SELECT briefing, generated_at FROM account_briefings
       WHERE map_id = $1
         AND map_updated_at = $2
         AND seller_profile IS NOT DISTINCT FROM $3::jsonb
         AND generated_at::timestamptz > NOW() - INTERVAL '6 hours'`,
      [map.id, map.updated_at, sellerProfile]
    );
    if (cached[0]) return c.json(cached[0].briefing);
    const briefing = buildAccountBriefing(
      state,
      changes,
      baseline?.created_at ?? null
    );
    const deepBriefing = await deepenAccountBriefing(
      briefing,
      state,
      sellerProfile
    );
    await query(
      `INSERT INTO account_briefings
         (map_id, map_updated_at, seller_profile, briefing, generated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id) DO UPDATE SET
         map_updated_at = EXCLUDED.map_updated_at,
         seller_profile = EXCLUDED.seller_profile,
         briefing = EXCLUDED.briefing,
         generated_at = EXCLUDED.generated_at`,
      [
        map.id,
        map.updated_at,
        sellerProfile,
        deepBriefing,
        deepBriefing.generatedAt,
      ]
    );
    return c.json(deepBriefing);
  });

  app.get('/api/maps/:id/strategy', requireAuth, perUser('strategy', 30, 60 * 60_000), async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const state = map.state as MapState;
    const workspaces = await query<{ seller_profile: SellerProfile | null }>(
      'SELECT seller_profile FROM workspaces WHERE id = $1',
      [map.workspace_id]
    );
    const sellerProfile = workspaces[0]?.seller_profile ?? null;
    const cached = await query<{ insights: StrategyInsights }>(
      `SELECT insights FROM account_strategies
       WHERE map_id = $1
         AND map_updated_at = $2
         AND seller_profile IS NOT DISTINCT FROM $3::jsonb
         AND generated_at::timestamptz > NOW() - INTERVAL '6 hours'`,
      [map.id, map.updated_at, sellerProfile]
    );
    if (!c.req.query('refresh') && cached[0]) return c.json(cached[0].insights);

    const insights = await deepenAccountStrategy(
      state,
      sellerProfile,
      strategyContext(state, sellerProfile)
    );
    await query(
      `INSERT INTO account_strategies
         (map_id, map_updated_at, seller_profile, insights, generated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id) DO UPDATE SET
         map_updated_at = EXCLUDED.map_updated_at,
         seller_profile = EXCLUDED.seller_profile,
         insights = EXCLUDED.insights,
         generated_at = EXCLUDED.generated_at`,
      [
        map.id,
        map.updated_at,
        sellerProfile,
        insights,
        insights.generatedAt,
      ]
    );
    return c.json(insights);
  });

  app.post('/api/maps/:id/versions/:versionId/restore', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot restore versions', 403);
    const versions = await query<{ name: string; state: MapState }>(
      'SELECT name, state FROM map_versions WHERE id = $1 AND map_id = $2',
      [param(c, 'versionId'), map.id]
    );
    const version = versions[0];
    if (!version) return bad(c, 'version not found', 404);
    await query(
      'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), map.id, map.name, JSON.stringify(map.state), user.id, now()]
    );
    await query(
      'UPDATE maps SET name = $1, state = $2, updated_at = $3 WHERE id = $4',
      [version.name, JSON.stringify(version.state), now(), map.id]
    );
    return c.json({ name: version.name, state: version.state });
  });

  app.post('/api/maps/:id/presence', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const body = await c.req.json().catch(() => null);
    const cursorX =
      typeof body?.cursorX === 'number' && Number.isFinite(body.cursorX)
        ? body.cursorX
        : null;
    const cursorY =
      typeof body?.cursorY === 'number' && Number.isFinite(body.cursorY)
        ? body.cursorY
        : null;
    const selectedPersonId =
      typeof body?.selectedPersonId === 'string' ? body.selectedPersonId : null;
    await query(
      `INSERT INTO map_presence
       (map_id, user_id, last_seen, cursor_x, cursor_y, selected_person_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (map_id, user_id) DO UPDATE SET
         last_seen = EXCLUDED.last_seen,
         cursor_x = EXCLUDED.cursor_x,
         cursor_y = EXCLUDED.cursor_y,
         selected_person_id = EXCLUDED.selected_person_id`,
      [map.id, user.id, now(), cursorX, cursorY, selectedPersonId]
    );
    const cutoff = new Date(Date.now() - 45_000).toISOString();
    await query('DELETE FROM map_presence WHERE last_seen < $1', [cutoff]);
    const people = await query(
      `SELECT u.id, u.name, u.email, p.last_seen, p.cursor_x, p.cursor_y,
              p.selected_person_id
       FROM map_presence p JOIN users u ON u.id = p.user_id
       WHERE p.map_id = $1 AND p.last_seen >= $2 ORDER BY p.last_seen DESC`,
      [map.id, cutoff]
    );
    return c.json({ people, selfId: user.id });
  });

  // ---------- comments ----------

  app.get('/api/maps/:id/comments', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const rows = await query(
      `SELECT c.id, c.person_id, c.body, c.created_at, u.name AS author_name
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.map_id = $1 ORDER BY c.created_at`,
      [map.id]
    );
    return c.json({ comments: rows });
  });

  app.post('/api/maps/:id/comments', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot comment', 403);
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) return bad(c, 'comment body required');
    const personId =
      typeof body?.personId === 'string' && body.personId ? body.personId : null;
    const id = randomUUID();
    await query(
      'INSERT INTO comments (id, map_id, person_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, map.id, personId, user.id, text, now()]
    );
    await recordAnalytics({
      eventName: 'comment_added',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { scoped_to_person: Boolean(personId) },
    });
    return c.json({ id });
  });
}
