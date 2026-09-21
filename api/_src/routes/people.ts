import { bad, param, type App } from '../http.js';
import {
  canWrite,
  mapForUser,
  recordAnalytics,
  requireAuth,
  workspaceAccessFor,
  workspaceSellerProfile,
} from '../authz.js';
import { draftOutreach } from '../outreach.js';
import {
  dismissSignal,
  listWorkspaceSignals,
  toggleWatch,
  watchForPerson,
} from '../watchlist.js';
import type { MapState, Person } from '../types.js';

function personFromState(map: { state: unknown }, personId: string): Person | null {
  return (
    ((map.state as MapState).people ?? []).find((p) => p.id === personId) ?? null
  );
}

export function registerPeopleRoutes(app: App): void {
  // Grounded outreach draft for a single stakeholder: email, LinkedIn note,
  // and call-prep bullets. Works without an LLM key via the template fallback.
  app.post('/api/maps/:id/people/:personId/outreach', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const person = personFromState(map, param(c, 'personId'));
    if (!person) return bad(c, 'person not found', 404);
    const sellerProfile = await workspaceSellerProfile(map.workspace_id);
    const draft = await draftOutreach(
      map.state as MapState,
      person,
      sellerProfile
    );
    await recordAnalytics({
      eventName: 'outreach_drafted',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { provider: draft.provider },
    });
    return c.json({ draft });
  });

  // Toggle job-move tracking for a stakeholder.
  app.post('/api/maps/:id/people/:personId/watch', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot manage watches', 403);
    const person = personFromState(map, param(c, 'personId'));
    if (!person) return bad(c, 'person not found', 404);
    const result = await toggleWatch(map, person.id, user.id);
    await recordAnalytics({
      eventName: 'person_watch_set',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { watching: result.watching },
    });
    return c.json(result);
  });

  app.get('/api/maps/:id/people/:personId/watch', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const watch = await watchForPerson(map.id, param(c, 'personId'));
    return c.json({ watching: !!watch, watch });
  });

  // Workspace-wide signal feed: watched people who moved or departed.
  app.get('/api/workspaces/:id/signals', requireAuth, async (c) => {
    const user = c.get('user');
    const access = await workspaceAccessFor(user, param(c, 'id'));
    if (!access) return bad(c, 'not a member', 403);
    return c.json({ signals: await listWorkspaceSignals(param(c, 'id')) });
  });

  app.post('/api/signals/:id/dismiss', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const workspaceId =
      typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const access = await workspaceAccessFor(user, workspaceId);
    if (!access) return bad(c, 'not a member', 403);
    const dismissed = await dismissSignal(workspaceId, param(c, 'id'));
    if (!dismissed) return bad(c, 'signal not found', 404);
    return c.json({ ok: true });
  });
}
