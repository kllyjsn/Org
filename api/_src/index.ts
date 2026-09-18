import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import { answerAccountQuestion } from './account-agent.js';
import {
  buildAccountBriefing,
  deepenAccountBriefing,
} from './briefing.js';
import type { AccountBriefing } from './briefing.js';
import { deepenAccountStrategy, strategyContext } from './strategy.js';
import type { StrategyInsights } from './strategy.js';
import { refreshNextDueMap } from './background-refresh.js';
import { compareMapStates } from './changes.js';
import { query, now } from './db.js';
import {
  DOMAIN_RE,
  deadSourceUrls,
  verifyTitleClaims,
} from './research.js';
import { applyVerification, toResearchedPerson } from './verify-person.js';
import {
  decryptSecret,
  encryptionKeyConfigured,
  encryptSecret,
  signPayload,
  signatureMatches,
} from './crypto.js';
import { adapterFor, providerStatus } from './integrations/registry.js';
import { committeeCoverage } from './notifications/coverage.js';
import {
  enqueuePreMeetingBriefs,
  enqueueWeeklyCoverage,
  notificationsConfigured,
  sendDue,
  sendThroughChannel,
} from './notifications/dispatch.js';
import {
  syncIntegration,
  syncNextDueIntegration,
  type IntegrationRow,
} from './integrations/sync.js';
import { initialCheckpoint } from './research-pipeline.js';
import {
  cancelJob,
  createJob,
  getJob,
  runJobTick,
  type ResearchJobRow,
} from './research-jobs.js';
import {
  researchSellerProfile,
  sanitizeSellerProfile,
} from './seller-profile.js';
import { activeProvider } from './llm.js';
import { stripePost, verifyStripeSignature } from './billing.js';
import {
  mapCreationMetrics,
  recordProductEvent,
  sanitizeClientEvent,
  valueSummary,
} from './analytics.js';
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
  MapEdge,
  MapRow,
  MapState,
  Person,
  StrategicInitiative,
  UserRow,
  MemberRow,
  ShareLinkRow,
  WorkspaceRow,
  SellerProfile,
  AccountStrategyPlan,
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

function sessionUser(user: UserRow) {
  return { ...publicUser(user), isAdmin: isSuperAdmin(user) };
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
      seller_profile: SellerProfile | null;
    }>(
      `SELECT w.id, w.name, w.seller_profile,
              'pro'::text AS plan, 'owner'::text AS role
       FROM workspaces w ORDER BY w.created_at`
    );
  }
  return query<{
    id: string;
    name: string;
    role: string;
    plan: 'free' | 'pro';
    seller_profile: SellerProfile | null;
  }>(
    `SELECT w.id, w.name, w.plan, w.seller_profile, m.role FROM workspaces w
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

async function recordAnalytics(
  input: Parameters<typeof recordProductEvent>[0]
): Promise<void> {
  try {
    await recordProductEvent(input);
  } catch (error) {
    console.error('analytics event failed', error);
  }
}

function mapRefinementCounts(previous: MapState, next: MapState) {
  const nextPeople = new Map(
    (next.people ?? []).filter(Boolean).map((person) => [person.id, person])
  );
  let fieldChanges = 0;
  for (const person of (previous.people ?? []).filter(Boolean)) {
    const updated = nextPeople.get(person.id);
    if (!updated) continue;
    for (const field of [
      'title',
      'department',
      'team',
      'productLine',
      'role',
      'confidence',
    ] as const) {
      if ((person[field] ?? null) !== (updated[field] ?? null)) fieldChanges += 1;
    }
  }
  const edgeKey = (edge: MapState['edges'][number]) =>
    [edge.from, edge.to, edge.kind, edge.inferred ? 'inferred' : 'sourced'].join(
      ':'
    );
  const previousEdges = new Set(
    (previous.edges ?? []).filter(Boolean).map(edgeKey)
  );
  const nextEdges = new Set(
    (next.edges ?? []).filter(Boolean).map(edgeKey)
  );
  const relationshipChanges =
    [...previousEdges].filter((key) => !nextEdges.has(key)).length +
    [...nextEdges].filter((key) => !previousEdges.has(key)).length;
  return { fieldChanges, relationshipChanges };
}

function sanitizeStrategyPlan(
  input: unknown
): AccountStrategyPlan | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const rawStakeholders =
    value.stakeholders && typeof value.stakeholders === 'object'
      ? (value.stakeholders as Record<string, unknown>)
      : {};
  const stakeholders = Object.fromEntries(
    Object.entries(rawStakeholders)
      .slice(0, 500)
      .map(([id, item]) => {
        const row =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        const stance: AccountStrategyPlan['stakeholders'][string]['stance'] =
          row.stance === 'advocate' ||
          row.stance === 'neutral' ||
          row.stance === 'skeptic' ||
          row.stance === 'unknown'
            ? row.stance
            : 'unknown';
        return [
          id,
          {
            stance,
            nextStep:
              typeof row.nextStep === 'string'
                ? row.nextStep.slice(0, 500)
                : '',
            note: typeof row.note === 'string' ? row.note.slice(0, 500) : '',
          },
        ];
      })
  );
  const tasks = Array.isArray(value.tasks)
    ? value.tasks
        .slice(0, 50)
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          if (typeof row.id !== 'string' || typeof row.title !== 'string') {
            return null;
          }
          return {
            id: row.id.slice(0, 200),
            title: row.title.slice(0, 500),
            done: row.done === true,
            ...(typeof row.personId === 'string'
              ? { personId: row.personId.slice(0, 200) }
              : {}),
            source:
              row.source === 'manual'
                ? ('manual' as const)
                : ('generated' as const),
            createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];
  return {
    ...(typeof value.entryPersonId === 'string' ||
    value.entryPersonId === null
      ? { entryPersonId: value.entryPersonId }
      : {}),
    ...(typeof value.targetPersonId === 'string' ||
    value.targetPersonId === null
      ? { targetPersonId: value.targetPersonId }
      : {}),
    stakeholders,
    tasks,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

function sanitizeState(input: unknown): MapState {
  const s = (input ?? {}) as Partial<MapState>;
  // Normalize sub-fields too — stored states are read by every surface
  // (canvas, share links, analysis) and missing person/initiative fields
  // crash them.
  const people = (Array.isArray(s.people) ? s.people.slice(0, 500) : []).map(
    (p) => {
      const person = (p ?? {}) as Partial<Person>;
      return {
        ...person,
        name: person.name ?? '',
        title: person.title ?? '',
        role: person.role ?? 'none',
        notes: person.notes ?? '',
        sources: Array.isArray(person.sources) ? person.sources : [],
        email: person.email ?? null,
        linkedin: person.linkedin ?? null,
        metWith: person.metWith === true,
        confidence: person.confidence ?? 'low',
        x: typeof person.x === 'number' ? person.x : 0,
        y: typeof person.y === 'number' ? person.y : 0,
      } as Person;
    }
  );
  const edges = (Array.isArray(s.edges) ? s.edges.slice(0, 2000) : []).map(
    (e) => {
      const edge = (e ?? {}) as Partial<MapEdge>;
      return {
        ...edge,
        kind: edge.kind === 'influence' ? 'influence' : 'reports',
        label: edge.label ?? null,
      } as MapEdge;
    }
  );
  const meta = (s.meta ?? {}) as MapState['meta'];
  const strategy = sanitizeStrategyPlan(meta.strategy);
  return {
    people,
    edges,
    meta: {
      domain: typeof meta.domain === 'string' ? meta.domain : '',
      companyName: meta.companyName ?? null,
      researchedAt: meta.researchedAt ?? null,
      tier: meta.tier ?? 'manual',
      provider: meta.provider ?? null,
      refreshCadence:
        meta.refreshCadence === 'monthly' || meta.refreshCadence === 'manual'
          ? meta.refreshCadence
          : 'weekly',
      nextRefreshAt:
        typeof meta.nextRefreshAt === 'string' ? meta.nextRefreshAt : null,
      initiatives: (Array.isArray(meta.initiatives)
        ? meta.initiatives.slice(0, 20)
        : []
      ).map((i) => {
        const initiative = (i ?? {}) as Partial<StrategicInitiative>;
        return {
          ...initiative,
          name: initiative.name ?? 'Unnamed',
          summary: initiative.summary ?? '',
          category:
            initiative.category === 'growth' ||
            initiative.category === 'operations' ||
            initiative.category === 'technology' ||
            initiative.category === 'market' ||
            initiative.category === 'product'
              ? initiative.category
              : 'product',
          evidence: Array.isArray(initiative.evidence)
            ? initiative.evidence
            : [],
          relevantPeople: Array.isArray(initiative.relevantPeople)
            ? initiative.relevantPeople
            : [],
          relevantTeams: Array.isArray(initiative.relevantTeams)
            ? initiative.relevantTeams
            : [],
          salesAngles: Array.isArray(initiative.salesAngles)
            ? initiative.salesAngles
            : [],
        } as StrategicInitiative;
      }),
      ...(strategy ? { strategy } : {}),
    },
  };
}

// ---------- health ----------

app.get('/api/health', (c) =>
  c.json({ ok: true, provider: activeProvider() })
);

app.get('/api/cron/refresh', async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return bad(c, 'background refresh is not configured', 503);
  if (c.req.header('authorization') !== `Bearer ${secret}`) {
    return bad(c, 'unauthorized', 401);
  }
  try {
    await query('DELETE FROM sessions WHERE expires_at < $1', [now()]);
    await query(
      `DELETE FROM research_jobs
       WHERE created_at::timestamptz < NOW() - INTERVAL '7 days'`
    );
    const refresh = await refreshNextDueMap();
    const integrationSync = await syncNextDueIntegration().catch((error) => {
      console.error('integration sync failed', error);
      return { synced: false };
    });
    const notifications = await sendDue().catch((error) => {
      console.error('notification dispatch failed', error);
      return { sent: 0, failed: 0 };
    });
    return c.json({ ...refresh, integrationSync, notifications });
  } catch (error) {
    console.error('background refresh failed', error);
    return bad(c, 'background refresh failed', 500);
  }
});

app.get('/api/cron/notify', async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return bad(c, 'notifications are not configured', 503);
  if (c.req.header('authorization') !== `Bearer ${secret}`) {
    return bad(c, 'unauthorized', 401);
  }
  try {
    const briefs = await enqueuePreMeetingBriefs();
    const weekly = await enqueueWeeklyCoverage();
    const sent = await sendDue();
    return c.json({ briefs, weekly, sent });
  } catch (error) {
    console.error('notify cron failed', error);
    return bad(c, 'notification dispatch failed', 500);
  }
});

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
    user: sessionUser(users[0]),
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
      seller_profile: null,
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

app.post('/api/workspaces/:id/seller-profile/research', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  if (!canWrite(await workspaceRoleFor(user, workspaceId))) {
    return bad(c, 'insufficient role', 403);
  }
  const body = await c.req.json().catch(() => null);
  const domain =
    typeof body?.domain === 'string'
      ? body.domain
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*/, '')
      : '';
  if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid company domain');
  try {
    return c.json({ profile: await researchSellerProfile(domain) });
  } catch (error) {
    console.error('seller profile research failed', error);
    return bad(c, 'company research failed', 502);
  }
});

app.patch('/api/workspaces/:id/seller-profile', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  if (!canWrite(await workspaceRoleFor(user, workspaceId))) {
    return bad(c, 'insufficient role', 403);
  }
  const body = await c.req.json().catch(() => null);
  const profile = sanitizeSellerProfile(body?.profile);
  if (!DOMAIN_RE.test(profile.domain) || !profile.companyName) {
    return bad(c, 'company name and domain required');
  }
  await query('UPDATE workspaces SET seller_profile = $1 WHERE id = $2', [
    JSON.stringify(profile),
    workspaceId,
  ]);
  return c.json({ profile });
});

// ---------- research (T0) ----------

app.post('/api/research', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const domain =
    typeof body?.domain === 'string'
      ? body.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '')
      : '';
  const focus =
    typeof body?.focus === 'string' ? body.focus.trim().slice(0, 300) : '';
  if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
  try {
    const workspaceId =
      typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if (workspaceId && !(await workspaceRoleFor(user, workspaceId))) {
      return bad(c, 'not a member', 403);
    }
    const scopeColumn = workspaceId ? 'workspace_id' : 'user_id';
    const scopeValue = workspaceId || user.id;
    const busyRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM research_jobs
       WHERE ${scopeColumn} = $1 AND status IN ('queued','running')`,
      [scopeValue]
    );
    if (Number(busyRows[0]?.count ?? 0) >= 2) {
      return c.json(
        {
          error: 'research already running for this workspace — wait for it to finish',
          code: 'research_busy',
        },
        429
      );
    }
    let sellerProfile: SellerProfile | null = null;
    if (workspaceId) {
      const workspaces = await query<{ seller_profile: SellerProfile | null }>(
        'SELECT seller_profile FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      sellerProfile = workspaces[0]?.seller_profile ?? null;
    }
    const knownUrls = Array.isArray(body?.knownSources)
      ? body.knownSources
          .filter(
            (s: unknown): s is string =>
              typeof s === 'string' && /^https?:\/\//i.test(s)
          )
          .slice(0, 96)
      : [];
    const job = await createJob({
      workspaceId: workspaceId || null,
      userId: user.id,
      domain,
      focus: focus || null,
      checkpoint: initialCheckpoint({
        domain,
        focus: focus || null,
        sellerProfile,
        knownSources: knownUrls,
      }),
    });
    if (!process.env.VERCEL) {
      void runJobTick(job.id, 45_000).catch((error) => {
        console.error('research job tick failed', error);
      });
    }
    return c.json({ jobId: job.id }, 202);
  } catch (err) {
    console.error('research failed', err);
    return bad(c, 'research failed — try again or check LLM provider keys', 502);
  }
});

async function researchJobForUser(
  user: UserRow,
  id: string
): Promise<ResearchJobRow | null> {
  const job = await getJob(id);
  if (!job) return null;
  if (job.user_id === user.id) return job;
  if (!job.workspace_id || !(await workspaceRoleFor(user, job.workspace_id))) {
    return null;
  }
  return job;
}

function researchJobView(job: ResearchJobRow) {
  return {
    id: job.id,
    status: job.status,
    step: job.checkpoint.step,
    domain: job.domain,
    focus: job.focus,
    events: job.events,
    partial: job.partial,
    result: job.result,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

app.get('/api/research/jobs/:id/stream', requireAuth, async (c) => {
  const user = c.get('user');
  const id = param(c, 'id');
  const authorized = await researchJobForUser(user, id);
  if (!authorized) return bad(c, 'research job not found', 404);
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const endAt = Date.now() + 50_000;
    const after = Number(c.req.query('after'));
    let sentEvents = Number.isFinite(after) ? Math.max(0, after) : 0;
    let sentPeople = -1;
    let tickStarted = false;
    while (Date.now() < endAt) {
      const job = await getJob(id);
      if (!job) {
        await stream.writeSSE({
          event: 'failed',
          data: JSON.stringify({ error: 'research job not found' }),
        });
        return;
      }
      const claimable =
        (job.status === 'queued' || job.status === 'running') &&
        (!job.lease_until || Date.parse(job.lease_until) < Date.now());
      if (claimable && !tickStarted) {
        tickStarted = true;
        const budget = Math.max(1_000, endAt - Date.now() - 3_000);
        void runJobTick(id, budget)
          .catch((error) => console.error('research stream tick failed', error))
          .finally(() => {
            tickStarted = false;
          });
      }
      for (const event of job.events.slice(sentEvents)) {
        await stream.writeSSE({
          event: 'progress',
          data: JSON.stringify(event),
        });
      }
      sentEvents = job.events.length;
      const peopleCount = job.partial?.people.length ?? 0;
      if (job.partial && peopleCount !== sentPeople) {
        sentPeople = peopleCount;
        await stream.writeSSE({
          event: 'partial',
          data: JSON.stringify(job.partial),
        });
      }
      if (job.status === 'done' && job.result) {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify(job.result),
        });
        return;
      }
      if (job.status === 'failed') {
        await stream.writeSSE({
          event: 'failed',
          data: JSON.stringify({ error: job.error ?? 'research failed' }),
        });
        return;
      }
      if (job.status === 'cancelled') {
        await stream.writeSSE({ event: 'cancelled', data: '{}' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await stream.writeSSE({ event: 'continue', data: '{}' });
  });
});

app.get('/api/research/jobs/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const job = await researchJobForUser(user, param(c, 'id'));
  if (!job) return bad(c, 'research job not found', 404);
  return c.json({ job: researchJobView(job) });
});

app.post('/api/research/jobs/:id/cancel', requireAuth, async (c) => {
  const user = c.get('user');
  const job = await researchJobForUser(user, param(c, 'id'));
  if (!job) return bad(c, 'research job not found', 404);
  const cancelled = await cancelJob(job.id);
  return c.json({ job: cancelled ? researchJobView(cancelled) : researchJobView(job) });
});

// ---------- integrations ----------

function publicAppUrl(): string {
  return process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

function integrationsConfigured(): boolean {
  return encryptionKeyConfigured();
}

app.get('/api/workspaces/:id/integrations', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  if (!(await workspaceRoleFor(user, wsId))) return bad(c, 'not a member', 403);
  const connections = await query<IntegrationRow>(
    'SELECT * FROM integrations WHERE workspace_id = $1 AND user_id = $2',
    [wsId, user.id]
  );
  const byProvider = new Map(connections.map((row) => [row.provider, row]));
  return c.json({
    providers: providerStatus().map((provider) => {
      const connection = byProvider.get(provider.id);
      return {
        ...provider,
        connection: connection
          ? {
              id: connection.id,
              accountEmail: connection.account_email,
              status: connection.status,
              lastSyncedAt: connection.last_synced_at,
              lastError: connection.last_error,
            }
          : null,
      };
    }),
  });
});

app.post(
  '/api/workspaces/:id/integrations/:provider/connect',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    if (!canWrite(await workspaceRoleFor(user, wsId))) {
      return bad(c, 'insufficient role', 403);
    }
    const adapter = adapterFor(param(c, 'provider'));
    if (!adapter || !adapter.configured() || !integrationsConfigured()) {
      return bad(c, 'integrations are not configured', 503);
    }
    const payload = Buffer.from(
      JSON.stringify({
        ws: wsId,
        uid: user.id,
        provider: adapter.id,
        nonce: randomUUID(),
        exp: Date.now() + 10 * 60_000,
      })
    ).toString('base64url');
    const state = `${payload}.${signPayload(payload)}`;
    const redirectUri = `${publicAppUrl()}/api/integrations/callback`;
    return c.json({ url: adapter.authUrl(state, redirectUri) });
  }
);

app.get('/api/integrations/callback', async (c) => {
  const code = c.req.query('code') ?? '';
  const stateParam = c.req.query('state') ?? '';
  const redirectBase = `${publicAppUrl()}/app`;
  const fail = (provider = '') =>
    c.redirect(`${redirectBase}?integration=${provider}&error=1`);

  const dot = stateParam.lastIndexOf('.');
  if (!code || dot <= 0) return fail();
  const payload = stateParam.slice(0, dot);
  const signature = stateParam.slice(dot + 1);
  if (!encryptionKeyConfigured() || !signatureMatches(payload, signature)) {
    return fail();
  }
  let state: { ws?: string; uid?: string; provider?: string; exp?: number };
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return fail();
  }
  const adapter = adapterFor(state.provider ?? '');
  if (!adapter || !state.ws || !state.uid) return fail(state.provider ?? '');
  if (!state.exp || state.exp < Date.now()) return fail(adapter.id);

  try {
    const redirectUri = `${publicAppUrl()}/api/integrations/callback`;
    const tokens = await adapter.exchangeCode(code, redirectUri);
    await query(
      `INSERT INTO integrations
        (id, workspace_id, user_id, provider, account_email, access_token,
         refresh_token, expires_at, scopes, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'connected',$10)
       ON CONFLICT (workspace_id, user_id, provider) DO UPDATE SET
         account_email = EXCLUDED.account_email,
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, integrations.refresh_token),
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         status = 'connected',
         last_error = NULL`,
      [
        randomUUID(),
        state.ws,
        state.uid,
        adapter.id,
        tokens.accountEmail,
        encryptSecret(tokens.accessToken),
        tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        tokens.expiresAt,
        tokens.scopes,
        now(),
      ]
    );
    const rows = await query<{ id: string }>(
      'SELECT id FROM integrations WHERE workspace_id = $1 AND user_id = $2 AND provider = $3',
      [state.ws, state.uid, adapter.id]
    );
    if (rows[0]) {
      void syncIntegration(rows[0].id).catch((error) =>
        console.error('initial integration sync failed', error)
      );
    }
    return c.redirect(
      `${redirectBase}?integration=${adapter.id}&connected=1`
    );
  } catch (error) {
    console.error('integration callback failed', error);
    return fail(adapter.id);
  }
});

/** Caller must own the connection row or be an owner of its workspace. */
async function integrationForUser(
  user: UserRow,
  id: string
): Promise<[IntegrationRow | null, boolean]> {
  const rows = await query<IntegrationRow>(
    'SELECT * FROM integrations WHERE id = $1',
    [id]
  );
  const integration = rows[0];
  if (!integration) return [null, false];
  if (integration.user_id === user.id) return [integration, true];
  const role = await workspaceRoleFor(user, integration.workspace_id);
  return [integration, role === 'owner'];
}

app.post('/api/integrations/:id/sync', requireAuth, async (c) => {
  const user = c.get('user');
  const [integration, allowed] = await integrationForUser(
    user,
    param(c, 'id')
  );
  if (!integration) return bad(c, 'not found', 404);
  if (!allowed) return bad(c, 'insufficient role', 403);
  if (!integrationsConfigured()) {
    return bad(c, 'integrations are not configured', 503);
  }
  try {
    return c.json(await syncIntegration(integration.id));
  } catch (error) {
    console.error('integration sync failed', error);
    return bad(c, 'sync failed — try again', 502);
  }
});

app.delete('/api/integrations/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const [integration, allowed] = await integrationForUser(
    user,
    param(c, 'id')
  );
  if (!integration) return bad(c, 'not found', 404);
  if (!allowed) return bad(c, 'insufficient role', 403);
  // Touchpoint rows cascade; touch stats on people stay as last known.
  await query('DELETE FROM integrations WHERE id = $1', [integration.id]);
  return c.json({ ok: true });
});

// ---------- notifications ----------

interface ChannelRow {
  id: string;
  workspace_id: string;
  kind: 'slack_webhook' | 'email';
  target: string;
  label: string | null;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

/** Slack webhook URLs never leave the API — only a location hint. */
function targetHint(channel: ChannelRow): string {
  if (channel.kind !== 'slack_webhook') return 'workspace members';
  try {
    const url = new URL(decryptSecret(channel.target));
    const tail = url.pathname.slice(-4);
    return `${url.hostname}/…${tail}`;
  } catch {
    return 'slack webhook';
  }
}

app.get('/api/workspaces/:id/notifications', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  if (!(await workspaceRoleFor(user, wsId))) return bad(c, 'not a member', 403);
  const channels = await query<ChannelRow>(
    `SELECT * FROM notification_channels
     WHERE workspace_id = $1 ORDER BY created_at`,
    [wsId]
  );
  const prefs = await query<{
    notify_email: boolean;
    notify_briefs: boolean;
  }>(
    `SELECT notify_email, notify_briefs FROM workspace_members
     WHERE workspace_id = $1 AND user_id = $2`,
    [wsId, user.id]
  );
  const recent = await query<{
    kind: string;
    payload: { title?: string };
    scheduled_for: string;
    sent_at: string | null;
    last_error: string | null;
  }>(
    `SELECT kind, payload, scheduled_for, sent_at, last_error
     FROM notification_outbox
     WHERE workspace_id = $1 ORDER BY scheduled_for DESC LIMIT 10`,
    [wsId]
  );
  const configured = notificationsConfigured();
  return c.json({
    channels: channels.map((channel) => ({
      id: channel.id,
      kind: channel.kind,
      label: channel.label,
      enabled: channel.enabled,
      createdAt: channel.created_at,
      targetHint: targetHint(channel),
    })),
    prefs: {
      notifyEmail: prefs[0]?.notify_email ?? true,
      notifyBriefs: prefs[0]?.notify_briefs ?? true,
    },
    emailConfigured: configured.email,
    encryptionConfigured: configured.encryption,
    recent: recent.map((row) => ({
      kind: row.kind,
      title: row.payload?.title ?? '',
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      lastError: row.last_error,
    })),
  });
});

app.post(
  '/api/workspaces/:id/notifications/channels',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    if (!canWrite(await workspaceRoleFor(user, wsId))) {
      return bad(c, 'insufficient role', 403);
    }
    const body = await c.req.json().catch(() => null);
    const kind = body?.kind;
    if (kind === 'email') {
      // One email channel row per workspace.
      await query(
        `INSERT INTO notification_channels
          (id, workspace_id, kind, target, label, created_by, enabled, created_at)
         VALUES ($1,$2,'email','members','Workspace email',$3,TRUE,$4)
         ON CONFLICT DO NOTHING`,
        [randomUUID(), wsId, user.id, now()]
      );
      return c.json({ ok: true });
    }
    if (kind !== 'slack_webhook') return bad(c, 'unknown channel kind', 400);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url.startsWith('https://hooks.slack.com/')) {
      return bad(c, 'must be a https://hooks.slack.com/ webhook URL', 400);
    }
    if (!notificationsConfigured().encryption) {
      return bad(c, 'notifications are not configured', 503);
    }
    const label =
      typeof body?.label === 'string' ? body.label.trim().slice(0, 120) : null;
    await query(
      `INSERT INTO notification_channels
        (id, workspace_id, kind, target, label, created_by, enabled, created_at)
       VALUES ($1,$2,'slack_webhook',$3,$4,$5,TRUE,$6)`,
      [randomUUID(), wsId, encryptSecret(url), label, user.id, now()]
    );
    return c.json({ ok: true });
  }
);

/** Channel must live in a workspace the caller can write to. */
async function channelForUser(
  user: UserRow,
  channelId: string
): Promise<[ChannelRow | null, boolean]> {
  const rows = await query<ChannelRow>(
    'SELECT * FROM notification_channels WHERE id = $1',
    [channelId]
  );
  const channel = rows[0];
  if (!channel) return [null, false];
  return [channel, canWrite(await workspaceRoleFor(user, channel.workspace_id))];
}

app.post(
  '/api/workspaces/:id/notifications/channels/:channelId/test',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    if (!canWrite(await workspaceRoleFor(user, wsId))) {
      return bad(c, 'insufficient role', 403);
    }
    const [channel, allowed] = await channelForUser(
      user,
      param(c, 'channelId')
    );
    if (!channel || channel.workspace_id !== wsId) {
      return bad(c, 'not found', 404);
    }
    if (!allowed) return bad(c, 'insufficient role', 403);
    try {
      await sendThroughChannel(channel.id, {
        title: 'TopDown connected',
        lines: ['Notifications from this workspace will arrive here.'],
        ctaLabel: 'Open TopDown',
        ctaUrl: `${publicAppUrl()}/app`,
      });
      return c.json({ ok: true });
    } catch (error) {
      return bad(
        c,
        error instanceof Error ? error.message : 'test send failed',
        502
      );
    }
  }
);

app.patch(
  '/api/workspaces/:id/notifications/channels/:channelId',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    const [channel, allowed] = await channelForUser(
      user,
      param(c, 'channelId')
    );
    if (!channel || channel.workspace_id !== wsId) {
      return bad(c, 'not found', 404);
    }
    if (!allowed) return bad(c, 'insufficient role', 403);
    const body = await c.req.json().catch(() => null);
    await query(
      'UPDATE notification_channels SET enabled = $1 WHERE id = $2',
      [body?.enabled === true, channel.id]
    );
    return c.json({ ok: true });
  }
);

app.delete(
  '/api/workspaces/:id/notifications/channels/:channelId',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    const [channel, allowed] = await channelForUser(
      user,
      param(c, 'channelId')
    );
    if (!channel || channel.workspace_id !== wsId) {
      return bad(c, 'not found', 404);
    }
    if (!allowed) return bad(c, 'insufficient role', 403);
    await query('DELETE FROM notification_channels WHERE id = $1', [
      channel.id,
    ]);
    return c.json({ ok: true });
  }
);

app.patch(
  '/api/workspaces/:id/notifications/prefs',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const wsId = param(c, 'id');
    if (!(await workspaceRoleFor(user, wsId))) {
      return bad(c, 'not a member', 403);
    }
    const body = await c.req.json().catch(() => null);
    const updates: string[] = [];
    const params: unknown[] = [];
    if (typeof body?.notifyEmail === 'boolean') {
      params.push(body.notifyEmail);
      updates.push(`notify_email = $${params.length}`);
    }
    if (typeof body?.notifyBriefs === 'boolean') {
      params.push(body.notifyBriefs);
      updates.push(`notify_briefs = $${params.length}`);
    }
    if (updates.length === 0) return bad(c, 'nothing to update', 400);
    params.push(wsId, user.id);
    await query(
      `UPDATE workspace_members SET ${updates.join(', ')}
       WHERE workspace_id = $${params.length - 1} AND user_id = $${params.length}`,
      params
    );
    return c.json({ ok: true });
  }
);

app.post(
  '/api/maps/:id/notifications/coverage-preview',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map) return bad(c, 'not found', 404);
    if (!role) return bad(c, 'not a member', 403);
    return c.json(committeeCoverage(map.state as MapState));
  }
);

// ---------- maps ----------

app.get('/api/maps', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = c.req.query('workspaceId') || '';
  if (!(await workspaceRoleFor(user, wsId))) return bad(c, 'not a member', 403);
  const rows = await query<MapRow>(
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
    await query(
      'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), map.id, map.name, JSON.stringify(map.state), user.id, now()]
    );
  }
  await query(
    'UPDATE maps SET name = $1, state = $2, company_name = $3, updated_at = $4 WHERE id = $5',
    [
      name,
      JSON.stringify(state),
      state.meta?.companyName ?? map.company_name,
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

app.post('/api/maps/:id/people/:personId/verify', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot edit', 403);
  const state = map.state as MapState;
  const personId = param(c, 'personId');
  const person = (state.people ?? []).find((p) => p.id === personId);
  if (!person) return bad(c, 'person not found', 404);

  try {
    const deadline = Date.now() + 20_000;
    const researched = toResearchedPerson(person);
    const dead = await deadSourceUrls(
      researched.sourceDetails.map((source) => source.url),
      deadline
    );
    if (dead.size > 0) {
      researched.sourceDetails = researched.sourceDetails.filter(
        (source) => !dead.has(source.url)
      );
      researched.sources = researched.sources.filter((url) => !dead.has(url));
      researched.source = researched.sources[0] ?? null;
    }
    await verifyTitleClaims([researched], deadline);
    const verified = applyVerification(person, researched, dead);
    const nextState: MapState = {
      ...state,
      people: state.people.map((p) => (p.id === personId ? verified : p)),
    };

    // Same persistence path as PATCH: snapshot the prior state, then write.
    await query(
      'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), map.id, map.name, JSON.stringify(map.state), user.id, now()]
    );
    await query(
      'UPDATE maps SET state = $1, updated_at = $2 WHERE id = $3',
      [JSON.stringify(nextState), now(), map.id]
    );
    await query(
      `DELETE FROM map_versions WHERE map_id = $1 AND id NOT IN
       (SELECT id FROM map_versions WHERE map_id = $1 ORDER BY created_at DESC LIMIT 50)`,
      [map.id]
    );
    await recordAnalytics({
      eventName: 'person_verified',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: {
        person_id: personId,
        research_status: verified.researchStatus ?? 'unknown',
      },
    });
    return c.json({ person: verified });
  } catch (error) {
    console.error('person verification failed', error);
    return bad(c, 'verification failed — try again', 502);
  }
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

app.get('/api/maps/:id/strategy', requireAuth, async (c) => {
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
  await recordAnalytics({
    eventName: 'share_created',
    userId: user.id,
    workspaceId: map.workspace_id,
    mapId: map.id,
    properties: { expires: Boolean(expiresAt) },
  });
  return c.json({ token });
});

// ---------- privacy-safe product value ----------

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
  if (!(await workspaceRoleFor(user, workspaceId))) {
    return bad(c, 'not a member', 403);
  }
  return c.json(
    await valueSummary(user.id, workspaceId, isSuperAdmin(user))
  );
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

// ---------- product feedback ----------

const FEEDBACK_CATEGORIES = new Set([
  'bug',
  'idea',
  'research_quality',
  'other',
]);
const FEEDBACK_STATUSES = new Set(['new', 'reviewing', 'resolved']);

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
      crypto.randomUUID(),
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
