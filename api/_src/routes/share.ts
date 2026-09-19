import { randomBytes } from 'node:crypto';
import { bad, param, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  canWrite,
  mapForUser,
  recordAnalytics,
  requireAuth,
} from '../authz.js';
import type { MapRow, ShareLinkRow } from '../types.js';

export function registerShareRoutes(app: App): void {
  app.post('/api/maps/:id/share', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot share', 403);
    const body = await c.req.json().catch(() => ({}));
    const days =
      typeof body?.expiresInDays === 'number' && body.expiresInDays > 0
        ? body.expiresInDays
        : null;
    const token = randomBytes(12).toString('base64url');
    const expiresAt = days
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;
    await query(
      'INSERT INTO share_links (token, map_id, created_by, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
      [token, map.id, user.id, expiresAt, now()]
    );
    await recordAnalytics({
      eventName: 'share_created',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { expires: Boolean(expiresAt) },
    });
    return c.json({ token });
  });

  app.get('/api/maps/:id/share', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const links = await query<ShareLinkRow>(
      'SELECT * FROM share_links WHERE map_id = $1 ORDER BY created_at DESC',
      [map.id]
    );
    return c.json({ links });
  });

  app.delete('/api/maps/:id/share/:token', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot revoke links', 403);
    await query('DELETE FROM share_links WHERE token = $1 AND map_id = $2', [
      param(c, 'token'),
      map.id,
    ]);
    return c.json({ ok: true });
  });

  // Public, unauthenticated share view
  app.get('/api/share/:token', async (c) => {
    const links = await query<ShareLinkRow>(
      'SELECT * FROM share_links WHERE token = $1',
      [param(c, 'token')]
    );
    const link = links[0];
    if (!link) return bad(c, 'link not found', 404);
    if (link.expires_at && link.expires_at <= now())
      return bad(c, 'link expired', 410);
    const rows = await query<MapRow>(
      'SELECT name, domain, company_name, state, updated_at FROM maps WHERE id = $1',
      [link.map_id]
    );
    const map = rows[0];
    if (!map) return bad(c, 'map not found', 404);
    return c.json({
      map: {
        name: map.name,
        domain: map.domain,
        company_name: map.company_name,
        updated_at: map.updated_at,
        state: map.state,
      },
    });
  });
}
