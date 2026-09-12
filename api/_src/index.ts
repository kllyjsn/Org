import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import { answerAccountQuestion } from './account-agent.js';
import { buildAccountBriefing } from './briefing.js';
import { compareMapStates } from './changes.js';
import { query, now } from './db.js';
import { researchOrg } from './research.js';
import { activeProvider } from './llm.js';
import { stripePost, verifyStripeSignature } from './billing.js';
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
  WorkspaceRow,
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

function isSuperAdmin(user: UserRow): boolean {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .includes(user.email.toLowerCase());
}

async function workspaceRoleFor(
  user: UserRow,
  workspaceId: string
): Promise<MemberRow['role'] | null> {
  return isSuperAdmin(user)
    ? 'owner'
    : memberRole(user.id, workspaceId);
}

async function workspacesFor(user: UserRow) {
  if (isSuperAdmin(user)) {
    return query<{
      id: string;
      name: string;
      role: string;
      plan: 'pro';
    }>(
      `SELECT w.id, w.name, 'pro'::text AS plan, 'owner'::text AS role
       FROM workspaces w ORDER BY w.created_at`
    );
  }
  return query<{ id: string; name: string; role: string; plan: 'free' | 'pro' }>(
    `SELECT w.id, w.name, w.plan, m.role FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1 ORDER BY w.created_at`,
    [user.id]
  );
}

/** Fetch map if the user belongs to its workspace; returns [map, role]. */
async function mapForUser(
  user: UserRow,
  mapId: string
): Promise<[MapRow | null, MemberRow['role'] | null]> {
  const rows = await query<MapRow>('SELECT * FROM maps WHERE id = $1', [mapId]);
  const map = rows[0];
  if (!map) return [null, null];
  return [map, await workspaceRoleFor(user, map.workspace_id)];
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
      initiatives: Array.isArray(meta.initiatives)
        ? meta.initiatives.slice(0, 20)
        : [],
    },
  };
}

// ---------- health ----------

app.get('/api/health', (c) =>
  c.json({ ok: true, provider: activeProvider() })
);

// ---------- billing ----------

app.post('/api/billing/checkout', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const workspaceId =
    typeof body?.workspaceId === 'string' ? body.workspaceId : '';
  if ((await workspaceRoleFor(user, workspaceId)) !== 'owner') {
    return bad(c, 'only workspace owners can manage billing', 403);
  }
  const workspaces = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  const workspace = workspaces[0];
  if (!workspace) return bad(c, 'workspace not found', 404);
  if (workspace.plan === 'pro') return bad(c, 'workspace is already on Pro', 409);

  try {
    const origin = process.env.PUBLIC_APP_URL || 'https://topdown.sh';
    const checkoutParams: Record<string, string> = {
      mode: 'subscription',
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/app?checkout=cancelled`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '1000',
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'TopDown Pro',
      'metadata[workspace_id]': workspaceId,
      'subscription_data[metadata][workspace_id]': workspaceId,
      allow_promotion_codes: 'true',
    };
    if (workspace.stripe_customer_id) {
      checkoutParams.customer = workspace.stripe_customer_id;
    } else {
      checkoutParams.customer_email = user.email;
    }
    const session = await stripePost('/checkout/sessions', checkoutParams);
    if (typeof session.url !== 'string') throw new Error('Stripe returned no checkout URL');
    return c.json({ url: session.url });
  } catch (error) {
    console.error('checkout failed', error);
    return bad(c, 'billing is temporarily unavailable', 502);
  }
});

app.post('/api/billing/portal', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const workspaceId =
    typeof body?.workspaceId === 'string' ? body.workspaceId : '';
  if ((await workspaceRoleFor(user, workspaceId)) !== 'owner') {
    return bad(c, 'only workspace owners can manage billing', 403);
  }
  const rows = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  const customer = rows[0]?.stripe_customer_id;
  if (!customer) return bad(c, 'no billing account found', 404);
  try {
    const origin = process.env.PUBLIC_APP_URL || 'https://topdown.sh';
    const session = await stripePost('/billing_portal/sessions', {
      customer,
      return_url: `${origin}/app`,
    });
    if (typeof session.url !== 'string') throw new Error('Stripe returned no portal URL');
    return c.json({ url: session.url });
  } catch (error) {
    console.error('billing portal failed', error);
    return bad(c, 'billing is temporarily unavailable', 502);
  }
});

app.post('/api/billing/webhook', async (c) => {
  const payload = await c.req.text();
  if (!verifyStripeSignature(payload, c.req.header('stripe-signature'))) {
    return c.json({ error: 'invalid signature' }, 400);
  }
  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = event.data?.object;
  if (!object) return c.json({ received: true });

  if (event.type === 'checkout.session.completed') {
    const metadata = object.metadata as Record<string, string> | undefined;
    const workspaceId = metadata?.workspace_id;
    const customer =
      typeof object.customer === 'string' ? object.customer : null;
    const subscription =
      typeof object.subscription === 'string' ? object.subscription : null;
    if (workspaceId) {
      await query(
        `UPDATE workspaces SET plan = 'pro', stripe_customer_id = $1,
         stripe_subscription_id = $2 WHERE id = $3`,
        [customer, subscription, workspaceId]
      );
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const metadata = object.metadata as Record<string, string> | undefined;
    const workspaceId = metadata?.workspace_id;
    const status = typeof object.status === 'string' ? object.status : '';
    const plan =
      event.type === 'customer.subscription.updated' &&
      (status === 'active' || status === 'trialing')
        ? 'pro'
        : 'free';
    if (workspaceId) {
      await query('UPDATE workspaces SET plan = $1 WHERE id = $2', [
        plan,
        workspaceId,
      ]);
    }
  }
  return c.json({ received: true });
});

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
    user: publicUser(users[0]),
    workspaces: await workspacesFor(users[0]),
  });
});

app.post('/api/auth/login', async (c) => {
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
    user: publicUser(user),
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
    user: publicUser(user),
    workspaces: await workspacesFor(user),
  });
});

// ---------- workspaces ----------

app.post('/api/workspaces', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad(c, 'name required');
  const ws = await createWorkspaceForUser(user.id, name);
  return c.json({
    workspace: {
      ...ws,
      plan: isSuperAdmin(user) ? 'pro' : ws.plan,
      role: 'owner',
    },
  });
});

app.get('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  if (!(await workspaceRoleFor(user, wsId))) return bad(c, 'not a member', 403);
  const rows = await query(
    `SELECT u.id, u.name, u.email, m.role FROM workspace_members m
     JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`,
    [wsId]
  );
  return c.json({ members: rows });
});

app.post('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const role = await workspaceRoleFor(user, wsId);
  if (role !== 'owner' && role !== 'member')
    return bad(c, 'insufficient role', 403);
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const target = await query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if (!target[0])
    return bad(
      c,
      'no account with that email — they need to register first',
      404
    );
  try {
    await query(
      'INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1,$2,$3,$4)',
      [wsId, target[0].id, 'member', now()]
    );
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
  const focus =
    typeof body?.focus === 'string' ? body.focus.trim().slice(0, 300) : '';
  if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
  try {
    const result = await researchOrg(domain, focus || undefined);
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
  if (!(await workspaceRoleFor(user, wsId))) return bad(c, 'not a member', 403);
  const rows = await query<MapRow>(
    `SELECT id, name, domain, company_name, state, created_by, created_at, updated_at
     FROM maps WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [wsId]
  );
  return c.json({
    maps: rows.map(({ state, ...m }) => ({
      ...m,
      peopleCount: (state as MapState).people?.length ?? 0,
      initiativeCount:
        (state as MapState).meta.initiatives?.length ?? 0,
    })),
  });
});

app.post('/api/maps', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
  const role = await workspaceRoleFor(user, wsId);
  if (!canWrite(role)) return bad(c, 'insufficient role', 403);
  const workspaces = await query<{ plan: 'free' | 'pro' }>(
    'SELECT plan FROM workspaces WHERE id = $1',
    [wsId]
  );
  if (!workspaces[0]) return bad(c, 'workspace not found', 404);
  if (!isSuperAdmin(user) && workspaces[0].plan === 'free') {
    const counts = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM maps WHERE workspace_id = $1',
      [wsId]
    );
    if (Number(counts[0]?.count ?? 0) >= 2) {
      return c.json(
        {
          error: 'Free workspaces include two account maps. Upgrade to Pro for unlimited maps.',
          code: 'plan_limit',
        },
        402
      );
    }
  }
  const domain = typeof body?.domain === 'string' ? body.domain.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || !domain) return bad(c, 'name and domain required');
  const state = sanitizeState(body?.state);
  const id = randomUUID();
  await query(
    `INSERT INTO maps (id, workspace_id, name, domain, company_name, state, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      wsId,
      name,
      domain,
      state.meta.companyName ?? null,
      JSON.stringify(state),
      user.id,
      now(),
      now(),
    ]
  );
  await query(
    'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), id, name, JSON.stringify(state), user.id, now()]
  );
  return c.json({ id });
});

app.get('/api/maps/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  return c.json({ map: { ...map, role } });
});

app.post('/api/maps/:id/ask', requireAuth, async (c) => {
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
    return c.json(await answerAccountQuestion(map.state as MapState, messages));
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
  await query(
    'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), map.id, map.name, JSON.stringify(map.state), user.id, now()]
  );
  await query(
    'UPDATE maps SET name = $1, state = $2, company_name = $3, updated_at = $4 WHERE id = $5',
    [
      name,
      JSON.stringify(state),
      state.meta.companyName ?? map.company_name,
      now(),
      map.id,
    ]
  );
  await query(
    `DELETE FROM map_versions WHERE map_id = $1 AND id NOT IN
     (SELECT id FROM map_versions WHERE map_id = $1 ORDER BY created_at DESC LIMIT 50)`,
    [map.id]
  );
  const updated = await query<{ updated_at: string }>(
    'SELECT updated_at FROM maps WHERE id = $1',
    [map.id]
  );
  return c.json({ ok: true, updatedAt: updated[0]?.updated_at ?? now() });
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

app.get('/api/maps/:id/briefing', requireAuth, async (c) => {
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
  return c.json(
    buildAccountBriefing(state, changes, baseline?.created_at ?? null)
  );
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
  return c.json({ id });
});

// ---------- share links ----------

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

export default app;
