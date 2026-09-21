import { getCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { bad, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  SESSION_COOKIE,
  createWorkspaceForUser,
  deleteSession,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import {
  createSession,
  requireAuth,
  sessionUser,
  setSessionCookie,
  workspacesFor,
} from '../authz.js';
import { perIp } from '../rate-limit.js';
import type { UserRow } from '../types.js';

// 10 attempts per IP per 5 minutes on credential endpoints — enough for a
// human who typos, far too small for brute force.
const authLimit = perIp('auth', 10, 5 * 60_000);

export function registerAuthRoutes(app: App): void {
  app.post('/api/auth/register', authLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const workspaceName =
      typeof body?.workspaceName === 'string' ? body.workspaceName.trim() : '';
    if (!email || !email.includes('@')) return bad(c, 'valid email required');
    if (password.length < 8)
      return bad(c, 'password must be at least 8 characters');
    if (!name) return bad(c, 'name required');

    const exists = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (exists.length) return bad(c, 'an account with that email already exists', 409);

    const userId = randomUUID();
    await query(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
      [userId, email.toLowerCase(), name, hashPassword(password), now()]
    );
    await createWorkspaceForUser(userId, workspaceName || `${name}'s workspace`);

    const token = await createSession(userId);
    setSessionCookie(c, token);
    const users = await query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    return c.json({
      user: sessionUser(users[0]),
      workspaces: await workspacesFor(users[0]),
    });
  });

  app.post('/api/auth/login', authLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const users = await query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = users[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return bad(c, 'invalid email or password', 401);
    }
    const token = await createSession(user.id);
    setSessionCookie(c, token);
    return c.json({
      user: sessionUser(user),
      workspaces: await workspacesFor(user),
    });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', requireAuth, async (c) => {
    const user = c.get('user');
    return c.json({
      user: sessionUser(user),
      workspaces: await workspacesFor(user),
    });
  });
}
