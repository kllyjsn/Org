import { bad, param, type App } from '../http.js';
import {
  isSuperAdmin,
  mapForUser,
  recordAnalytics,
  requireAuth,
  workspaceAccessFor,
} from '../authz.js';
import { sanitizeClientEvent, valueSummary } from '../analytics.js';

// Privacy-safe product value

export function registerAnalyticsRoutes(app: App): void {
  app.post('/api/maps/:id/events', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const body = await c.req.json().catch(() => null);
    const event = sanitizeClientEvent(body?.eventName, body?.properties);
    if (!event) return bad(c, 'unsupported event');
    const eventId =
      typeof body?.eventId === 'string' && /^[a-f0-9-]{36}$/i.test(body.eventId)
        ? body.eventId
        : null;
    await recordAnalytics({
      eventName: event.eventName,
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: event.properties,
      dedupeKey: eventId,
    });
    return c.json({ accepted: true });
  });

  app.get('/api/workspaces/:id/value', requireAuth, async (c) => {
    const user = c.get('user');
    const workspaceId = param(c, 'id');
    const access = await workspaceAccessFor(user, workspaceId);
    if (!access) {
      return bad(c, 'not a member', 403);
    }
    return c.json(
      await valueSummary(
        user.id,
        workspaceId,
        isSuperAdmin(user),
        access.scoped ? user.id : null
      )
    );
  });
}
