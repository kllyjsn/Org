import { randomUUID } from 'node:crypto';
import { bad, param, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  isSuperAdmin,
  requireAuth,
  workspaceRoleFor,
} from '../authz.js';

const FEEDBACK_CATEGORIES = new Set([
  'bug',
  'idea',
  'research_quality',
  'other',
]);
const FEEDBACK_STATUSES = new Set(['new', 'reviewing', 'resolved']);

export function registerFeedbackRoutes(app: App): void {
  app.post('/api/feedback', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const category =
      typeof body?.category === 'string' && FEEDBACK_CATEGORIES.has(body.category)
        ? body.category
        : 'other';
    const message =
      typeof body?.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    if (message.length < 3) return bad(c, 'tell us a little more');
    const pagePath =
      typeof body?.pagePath === 'string'
        ? body.pagePath.trim().slice(0, 300)
        : null;
    const workspaceId =
      typeof body?.workspaceId === 'string' &&
      (await workspaceRoleFor(user, body.workspaceId))
        ? body.workspaceId
        : null;
    await query(
      `INSERT INTO feedback
         (id, user_id, workspace_id, category, message, page_path, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'new',$7)`,
      [
        randomUUID(),
        user.id,
        workspaceId,
        category,
        message,
        pagePath,
        now(),
      ]
    );
    return c.json({ received: true });
  });

  app.get('/api/admin/feedback', requireAuth, async (c) => {
    const user = c.get('user');
    if (!isSuperAdmin(user)) return bad(c, 'admin only', 403);
    const items = await query(
      `SELECT f.id, f.category, f.message, f.page_path, f.status, f.created_at,
              u.name AS author_name, u.email AS author_email,
              w.name AS workspace_name
         FROM feedback f
         JOIN users u ON u.id = f.user_id
         LEFT JOIN workspaces w ON w.id = f.workspace_id
        ORDER BY f.created_at DESC
        LIMIT 200`
    );
    return c.json({ items });
  });

  app.patch('/api/admin/feedback/:id', requireAuth, async (c) => {
    const user = c.get('user');
    if (!isSuperAdmin(user)) return bad(c, 'admin only', 403);
    const body = await c.req.json().catch(() => null);
    const status =
      typeof body?.status === 'string' && FEEDBACK_STATUSES.has(body.status)
        ? body.status
        : '';
    if (!status) return bad(c, 'unsupported status');
    await query('UPDATE feedback SET status = $1 WHERE id = $2', [
      status,
      param(c, 'id'),
    ]);
    return c.json({ status });
  });
}
