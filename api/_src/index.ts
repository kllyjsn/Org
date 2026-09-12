import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  users,
  workspaces,
  members,
  maps,
  shareLinks,
  comments,
  now,
} from './db.js';
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
} from './types.js';

type Vars = { user: UserRow };
const app = new Hono<{ Variables: Vars }>();

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  '/api/*',
  cors({
    origin: (o) =>
      ALLOWED_ORIGINS.includes(o) || /https:\/\/[^/]+\.vercel\.app$/.test(o)
        ? o
        : null,
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
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
}

function setSessionCookie(c: Context, token: string) {
  // COOKIE_SECURE=1 for production (https + cross-site preview origins).
  const secure = process.env.COOKIE_SECURE === '1';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: secure ? 'None' : 'Lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

async function workspacesFor(userId: string) {
  const ms = await (await members()).find({ user_id: userId }).toArray();
  if (!ms.length) return [] as { id: string; name: string; role: string }[];
  const ids = ms.map((m) => m.workspace_id);
  const ws = await (await workspaces()).find({ id: { $in: ids } }).toArray();
  const roleById = new Map(ms.map((m) => [m.workspace_id, m.role]));
  return ws
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((w) => ({ id: w.id, name: w.name, role: roleById.get(w.id)! }));
}

/** Fetch map if the user belongs to its workspace; returns [map, role]. */
async function mapForUser(
  userId: string,
  mapId: string
): Promise<[MapRow | null, MemberRow['role'] | null]> {
  const map = await (await maps()).findOne({ id: mapId });
  if (!map) return [null, null];
  return [map, await memberRole(userId, map.workspace_id)];
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

  const exists = await (
    await users()
  ).findOne({ email: email.toLowerCase() }, { projection: { id: 1 } });
  if (exists) return bad(c, 'an account with that email already exists', 409);

  const userId = randomUUID();
  await (
    await users()
  ).insertOne({
    id: userId,
    email: email.toLowerCase(),
    name,
    password_hash: hashPassword(password),
    created_at: now(),
  });
  await createWorkspaceForUser(userId, workspaceName || `${name}'s workspace`);

  const token = await createSession(userId);
  setSessionCookie(c, token);
  const user = await (await users()).findOne({ id: userId });
  return c.json({
    user: publicUser(user as UserRow),
    workspaces: await workspacesFor(userId),
  });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const user = await (
    await users()
  ).findOne({ email: email.toLowerCase() });
  if (!user || !verifyPassword(password, user.password_hash)) {
    return bad(c, 'invalid email or password', 401);
  }
  const token = await createSession(user.id);
  setSessionCookie(c, token);
  return c.json({
    user: publicUser(user),
    workspaces: await workspacesFor(user.id),
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
    user: publicUser(user),
    workspaces: await workspacesFor(user.id),
  });
});

// ---------- workspaces ----------

app.post('/api/workspaces', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad(c, 'name required');
  const ws = await createWorkspaceForUser(user.id, name);
  return c.json({ workspace: { ...ws, role: 'owner' } });
});

app.get('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  if (!(await memberRole(user.id, wsId))) return bad(c, 'not a member', 403);
  const ms = await (await members()).find({ workspace_id: wsId }).toArray();
  const us = await (
    await users()
  )
    .find(
      { id: { $in: ms.map((m) => m.user_id) } },
      { projection: { id: 1, name: 1, email: 1 } }
    )
    .toArray();
  const byId = new Map(us.map((u) => [u.id, u]));
  const out = ms.map((m) => ({
    id: m.user_id,
    name: byId.get(m.user_id)?.name ?? '',
    email: byId.get(m.user_id)?.email ?? '',
    role: m.role,
  }));
  return c.json({ members: out });
});

app.post('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const role = await memberRole(user.id, wsId);
  if (role !== 'owner' && role !== 'member')
    return bad(c, 'insufficient role', 403);
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const target = await (
    await users()
  ).findOne({ email: email.toLowerCase() }, { projection: { id: 1 } });
  if (!target)
    return bad(
      c,
      'no account with that email — they need to register first',
      404
    );
  try {
    await (
      await members()
    ).insertOne({
      workspace_id: wsId,
      user_id: target.id,
      role: 'member',
      created_at: now(),
    });
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

app.get('/api/maps', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = c.req.query('workspaceId') || '';
  if (!(await memberRole(user.id, wsId))) return bad(c, 'not a member', 403);
  const rows = await (
    await maps()
  )
    .find({ workspace_id: wsId })
    .sort({ updated_at: -1 })
    .toArray();
  return c.json({
    maps: rows.map((m) => ({
      id: m.id,
      name: m.name,
      domain: m.domain,
      company_name: m.company_name,
      created_by: m.created_by,
      created_at: m.created_at,
      updated_at: m.updated_at,
      peopleCount: m.state?.people?.length ?? 0,
    })),
  });
});

app.post('/api/maps', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
  const role = await memberRole(user.id, wsId);
  if (!canWrite(role)) return bad(c, 'insufficient role', 403);
  const domain = typeof body?.domain === 'string' ? body.domain.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || !domain) return bad(c, 'name and domain required');
  const state = sanitizeState(body?.state);
  const id = randomUUID();
  await (
    await maps()
  ).insertOne({
    id,
    workspace_id: wsId,
    name,
    domain,
    company_name: state.meta.companyName ?? null,
    state,
    created_by: user.id,
    created_at: now(),
    updated_at: now(),
  });
  return c.json({ id });
});

app.get('/api/maps/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  return c.json({ map: { ...map, _id: undefined, role } });
});

app.patch('/api/maps/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot edit', 403);
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : map.name;
  const state =
    body?.state !== undefined ? sanitizeState(body.state) : map.state;
  await (
    await maps()
  ).updateOne(
    { id: map.id },
    { $set: { name, state, updated_at: now(), company_name: state.meta.companyName ?? map.company_name } }
  );
  return c.json({ ok: true });
});

app.delete('/api/maps/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot delete', 403);
  await (await maps()).deleteOne({ id: map.id });
  await (await comments()).deleteMany({ map_id: map.id });
  await (await shareLinks()).deleteMany({ map_id: map.id });
  return c.json({ ok: true });
});

// ---------- comments ----------

app.get('/api/maps/:id/comments', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const rows = await (
    await comments()
  )
    .find({ map_id: map.id })
    .sort({ created_at: 1 })
    .toArray();
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authors = await (
    await users()
  )
    .find({ id: { $in: authorIds } }, { projection: { id: 1, name: 1 } })
    .toArray();
  const nameById = new Map(authors.map((a) => [a.id, a.name]));
  return c.json({
    comments: rows.map((r) => ({
      id: r.id,
      person_id: r.person_id,
      body: r.body,
      created_at: r.created_at,
      author_name: nameById.get(r.author_id) ?? 'unknown',
    })),
  });
});

app.post('/api/maps/:id/comments', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return bad(c, 'comment body required');
  const personId =
    typeof body?.personId === 'string' && body.personId ? body.personId : null;
  const id = randomUUID();
  await (
    await comments()
  ).insertOne({
    id,
    map_id: map.id,
    person_id: personId,
    author_id: user.id,
    body: text,
    created_at: now(),
  });
  return c.json({ id });
});

// ---------- share links ----------

app.post('/api/maps/:id/share', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
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
  await (
    await shareLinks()
  ).insertOne({
    token,
    map_id: map.id,
    created_by: user.id,
    expires_at: expiresAt,
    created_at: now(),
  });
  return c.json({ token });
});

app.get('/api/maps/:id/share', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const links = await (
    await shareLinks()
  )
    .find({ map_id: map.id })
    .sort({ created_at: -1 })
    .toArray();
  return c.json({ links });
});

app.delete('/api/maps/:id/share/:token', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user.id, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot revoke links', 403);
  await (
    await shareLinks()
  ).deleteOne({ token: param(c, 'token'), map_id: map.id });
  return c.json({ ok: true });
});

// Public, unauthenticated share view
app.get('/api/share/:token', async (c) => {
  const link = await (
    await shareLinks()
  ).findOne({ token: param(c, 'token') });
  if (!link) return bad(c, 'link not found', 404);
  if (link.expires_at && link.expires_at <= now())
    return bad(c, 'link expired', 410);
  const map = await (
    await maps()
  ).findOne(
    { id: link.map_id },
    { projection: { name: 1, domain: 1, company_name: 1, state: 1, updated_at: 1 } }
  );
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

export default app;
