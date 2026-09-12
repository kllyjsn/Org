import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, now } from './db.js';
import { researchOrg } from './research.js';
import { activeProvider } from './llm.js';
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  getSessionUser,
  hashPassword,
  verifyPassword,
  createWorkspaceForUser,
  memberRole,
  publicUser,
} from './auth.js';
import type {
  MapRow,
  MapState,
  UserRow,
  MemberRow,
  ShareLinkRow,
  CommentRow,
} from './types.js';

type Vars = { user: UserRow };
const app = new Hono<{ Variables: Vars }>();

app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

function bad(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as 400);
}

function param(c: Context, key: string): string {
  const v = c.req.param(key);
  if (!v) throw new Error(`missing route param: ${key}`);
  return v;
}

async function requireAuth(c: Context, next: Next) {
  const user = getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
}

function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

function workspacesFor(userId: string) {
  return db
    .prepare(
      `SELECT w.id, w.name, m.role FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.created_at`
    )
    .all(userId) as { id: string; name: string; role: string }[];
}

/** Fetch map if the user belongs to its workspace; returns [map, role]. */
function mapForUser(
  userId: string,
  mapId: string
): [MapRow | null, MemberRow['role'] | null] {
  const map = db
    .prepare('SELECT * FROM maps WHERE id = ?')
    .get(mapId) as MapRow | undefined;
  if (!map) return [null, null];
  return [map, memberRole(userId, map.workspace_id)];
}

function canWrite(role: MemberRow['role'] | null): boolean {
  return role === 'owner' || role === 'member';
}

function sanitizeState(input: unknown): MapState {
  const s = (input ?? {}) as Partial<MapState>;
  const people = Array.isArray(s.people) ? s.people.slice(0, 500) : [];
  const edges = Array.isArray(s.edges) ? s.edges.slice(0, 2000) : [];
  const meta = (s.meta ?? {}) as MapState['meta'];
  return {
    people,
    edges,
    meta: {
      domain: typeof meta.domain === 'string' ? meta.domain : '',
      companyName: meta.companyName ?? null,
      researchedAt: meta.researchedAt ?? null,
      tier: meta.tier ?? 'manual',
      provider: meta.provider ?? null,
    },
  };
}

// ---------- health ----------

app.get('/api/health', (c) =>
  c.json({ ok: true, provider: activeProvider() })
);

// ---------- auth ----------

app.post('/api/auth/register', async (c) => {
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

  const exists = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email) as { id: string } | undefined;
  if (exists) return bad(c, 'an account with that email already exists', 409);

  const userId = randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)'
  ).run(userId, email, name, hashPassword(password), now());
  createWorkspaceForUser(userId, workspaceName || `${name}'s workspace`);

  const token = createSession(userId);
  setSessionCookie(c, token);
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as UserRow;
  return c.json({ user: publicUser(user), workspaces: workspacesFor(userId) });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return bad(c, 'invalid email or password', 401);
  }
  const token = createSession(user.id);
  setSessionCookie(c, token);
  return c.json({ user: publicUser(user), workspaces: workspacesFor(user.id) });
});

app.post('/api/auth/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ user: publicUser(user), workspaces: workspacesFor(user.id) });
});

// ---------- workspaces ----------

app.post('/api/workspaces', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad(c, 'name required');
  const ws = createWorkspaceForUser(user.id, name);
  return c.json({ workspace: { ...ws, role: 'owner' } });
});

app.get('/api/workspaces/:id/members', requireAuth, (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  if (!memberRole(user.id, wsId)) return bad(c, 'not a member', 403);
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, m.role FROM workspace_members m
       JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`
    )
    .all(wsId);
  return c.json({ members });
});

app.post('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const role = memberRole(user.id, wsId);
  if (role !== 'owner' && role !== 'member')
    return bad(c, 'insufficient role', 403);
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const target = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email) as { id: string } | undefined;
  if (!target)
    return bad(
      c,
      'no account with that email — they need to register first',
      404
    );
  try {
    db.prepare(
      'INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)'
    ).run(wsId, target.id, 'member', now());
  } catch {
    return bad(c, 'already a member', 409);
  }
  return c.json({ ok: true });
});

// ---------- research (T0) ----------

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

app.post('/api/research', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const domain =
    typeof body?.domain === 'string'
      ? body.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '')
      : '';
  if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
  try {
    const result = await researchOrg(domain);
    return c.json(result);
  } catch (err) {
    console.error('research failed', err);
    return bad(c, 'research failed — try again or check LLM provider keys', 502);
  }
});

// ---------- maps ----------

app.get('/api/maps', requireAuth, (c) => {
  const user = c.get('user');
  const wsId = c.req.query('workspaceId') || '';
  if (!memberRole(user.id, wsId)) return bad(c, 'not a member', 403);
  const rows = db
    .prepare(
      `SELECT id, name, domain, company_name, state_json, created_by, created_at, updated_at
       FROM maps WHERE workspace_id = ? ORDER BY updated_at DESC`
    )
    .all(wsId) as MapRow[];
  return c.json({
    maps: rows.map(({ state_json, ...m }) => ({
      ...m,
      peopleCount:
        (JSON.parse(state_json) as MapState).people?.length ?? 0,
    })),
  });
});

app.post('/api/maps', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
  const role = memberRole(user.id, wsId);
  if (!canWrite(role)) return bad(c, 'insufficient role', 403);
  const domain = typeof body?.domain === 'string' ? body.domain.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || !domain) return bad(c, 'name and domain required');
  const state = sanitizeState(body?.state);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO maps (id, workspace_id, name, domain, company_name, state_json, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    wsId,
    name,
    domain,
    state.meta.companyName ?? null,
    JSON.stringify(state),
    user.id,
    now(),
    now()
  );
  return c.json({ id });
});

app.get('/api/maps/:id', requireAuth, (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  return c.json({ map: { ...map, state: JSON.parse(map.state_json), role } });
});

app.patch('/api/maps/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot edit', 403);
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : map.name;
  const state =
    body?.state !== undefined ? sanitizeState(body.state) : JSON.parse(map.state_json);
  db.prepare(
    'UPDATE maps SET name = ?, state_json = ?, updated_at = ? WHERE id = ?'
  ).run(name, JSON.stringify(state), now(), map.id);
  return c.json({ ok: true });
});

app.delete('/api/maps/:id', requireAuth, (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot delete', 403);
  db.prepare('DELETE FROM maps WHERE id = ?').run(map.id);
  return c.json({ ok: true });
});

// ---------- comments ----------

app.get('/api/maps/:id/comments', requireAuth, (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const rows = db
    .prepare(
      `SELECT c.id, c.person_id, c.body, c.created_at, u.name AS author_name
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.map_id = ? ORDER BY c.created_at`
    )
    .all(map.id) as (CommentRow & { author_name: string })[];
  return c.json({ comments: rows });
});

app.post('/api/maps/:id/comments', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return bad(c, 'comment body required');
  const personId =
    typeof body?.personId === 'string' && body.personId ? body.personId : null;
  const id = randomUUID();
  db.prepare(
    'INSERT INTO comments (id, map_id, person_id, author_id, body, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, map.id, personId, user.id, text, now());
  return c.json({ id });
});

// ---------- share links ----------

app.post('/api/maps/:id/share', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
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
  db.prepare(
    'INSERT INTO share_links (token, map_id, created_by, expires_at, created_at) VALUES (?,?,?,?,?)'
  ).run(token, map.id, user.id, expiresAt, now());
  return c.json({ token });
});

app.get('/api/maps/:id/share', requireAuth, (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const links = db
    .prepare('SELECT * FROM share_links WHERE map_id = ? ORDER BY created_at DESC')
    .all(map.id) as ShareLinkRow[];
  return c.json({ links });
});

app.delete('/api/maps/:id/share/:token', requireAuth, (c) => {
  const user = c.get('user');
  const [map, role] = mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot revoke links', 403);
  db.prepare('DELETE FROM share_links WHERE token = ? AND map_id = ?').run(
    param(c, 'token'),
    map.id
  );
  return c.json({ ok: true });
});

// Public, unauthenticated share view
app.get('/api/share/:token', (c) => {
  const link = db
    .prepare('SELECT * FROM share_links WHERE token = ?')
    .get(param(c, 'token')) as ShareLinkRow | undefined;
  if (!link) return bad(c, 'link not found', 404);
  if (link.expires_at && link.expires_at <= now())
    return bad(c, 'link expired', 410);
  const map = db
    .prepare('SELECT name, domain, company_name, state_json, updated_at FROM maps WHERE id = ?')
    .get(link.map_id) as MapRow | undefined;
  if (!map) return bad(c, 'map not found', 404);
  return c.json({
    map: {
      name: map.name,
      domain: map.domain,
      company_name: map.company_name,
      updated_at: map.updated_at,
      state: JSON.parse(map.state_json),
    },
  });
});

const port = Number(process.env.PORT) || 8787;
console.log(`org api listening on :${port} (provider: ${activeProvider()})`);
serve({ fetch: app.fetch, port });
