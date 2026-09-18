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
import { DOMAIN_RE, canonicalPersonName } from './research.js';
import { exaCompanyProfile } from './exa.js';
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
import {
  MAX_PERSONAS,
  ensureDefaultPersonas,
  replacePersonas,
  sanitizePersonas,
  suggestPersonas,
} from './personas.js';
import { computeCoverage } from './coverage.js';
import { stripePost, verifyStripeSignature } from './billing.js';
import { sendEmail } from './email.js';
import {
  buildTerritoryWorkbook,
  type ExportAccount,
} from './territory-export.js';
import {
  INVITE_TTL_MS,
  evaluateInvite,
  hashInviteToken,
  isValidEmail,
  newInviteSecret,
  normalizeEmail,
  parseAccessRequest,
} from './invites.js';
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
  membership,
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
  CompanyProfile,
} from './types.js';
import {
  classifyTitle,
  functionToDepartment,
  seniorityToJobLevel,
} from './classify.js';
import type { Fn, Seniority } from './classify.js';
import { rowsFromCsv, rowsFromLinkedinUrls, linkedinSlug } from './csv.js';
import { configuredRosterProviders } from './roster-providers.js';
import {
  knownPersonKeys,
  listRoster,
  personKeyFor,
  rosterCounts,
  type RosterPersonRow,
  setRosterStatus,
  upsertRosterPeople,
} from './roster.js';
import {
  createRosterSyncJob,
  getRosterSyncJob,
  runRosterSync,
} from './roster-sync.js';
import {
  createExtensionToken,
  isExtensionOrigin,
  listExtensionTokens,
  lookupExtensionUser,
  makeRequireExtensionAuth,
  parseExtensionPeople,
  publicToken,
  revokeExtensionToken,
  rosterInputsFromExtension,
} from './extension-tokens.js';

type Vars = { user: UserRow };
const app = new Hono<{ Variables: Vars }>();

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function allowedWebOrigin(o: string): string | null {
  return ALLOWED_ORIGINS.includes(o) || /https:\/\/[^/]+\.vercel\.app$/.test(o)
    ? o
    : null;
}

// Extension routes additionally accept chrome-extension:// origins (bearer
// auth, no cookies). Registered first so it owns the preflight response.
app.use(
  '/api/extension/*',
  cors({
    origin: (o) => (isExtensionOrigin(o) ? o : allowedWebOrigin(o)),
    allowHeaders: ['authorization', 'content-type'],
    credentials: true,
  })
);
app.use(
  '/api/*',
  cors({
    origin: (o, c) =>
      allowedWebOrigin(o) ??
      (c.req.path.startsWith('/api/extension/') && isExtensionOrigin(o) ? o : null),
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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!
  );
}

function appUrl(c: Context): string {
  return (
    process.env.APP_URL ||
    c.req.header('origin') ||
    'https://topdown.sh'
  );
}

function exportFilename(name: string): string {
  return name
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
}

async function exportAccountForMap(
  map: MapRow,
  origin: string
): Promise<ExportAccount> {
  const [strategyRows, briefingRows] = await Promise.all([
    query<{ insights: StrategyInsights }>(
      `SELECT insights FROM account_strategies
       WHERE map_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [map.id]
    ),
    query<{ briefing: AccountBriefing }>(
      `SELECT briefing FROM account_briefings
       WHERE map_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [map.id]
    ),
  ]);
  let state = map.state as MapState;
  let companyProfile = state.meta?.companyProfile ?? null;
  if (!companyProfile && process.env.EXA_API_KEY) {
    companyProfile = await exaCompanyProfile(map.domain);
    if (companyProfile) {
      state = {
        ...state,
        meta: { ...state.meta, companyProfile },
      };
      await query(
        `UPDATE maps
         SET state = jsonb_set(state, '{meta,companyProfile}', $2::jsonb)
         WHERE id = $1`,
        [map.id, JSON.stringify(companyProfile)]
      );
    }
  }
  return {
    id: map.id,
    name: map.name,
    domain: map.domain,
    companyName: map.company_name,
    isLiveOpportunity: map.is_live_opportunity,
    state,
    strategy: strategyRows[0]?.insights ?? null,
    briefing: briefingRows[0]?.briefing ?? null,
    mapUrl: `${origin}/maps/${map.id}`,
  };
}

function sendWorkbook(
  c: Context,
  workbook: Buffer,
  filename: string
) {
  const asciiSafe = exportFilename(filename);
  const body = new Uint8Array(workbook) as unknown as Uint8Array<ArrayBuffer>;
  return c.body(body, 200, {
    'content-type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
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

/**
 * The user's role plus whether map-level restrictions apply.
 * Owners and super admins are never scoped.
 */
async function workspaceAccessFor(
  user: UserRow,
  workspaceId: string
): Promise<{ role: MemberRow['role']; scoped: boolean } | null> {
  if (isSuperAdmin(user)) return { role: 'owner', scoped: false };
  const member = await membership(user.id, workspaceId);
  if (!member) return null;
  return {
    role: member.role,
    scoped: member.role !== 'owner' && member.access_scope === 'selected',
  };
}

/** Role if the user may access this specific map; null otherwise. */
async function mapAccessFor(
  user: UserRow,
  workspaceId: string,
  mapId: string
): Promise<MemberRow['role'] | null> {
  const access = await workspaceAccessFor(user, workspaceId);
  if (!access) return null;
  if (!access.scoped) return access.role;
  const rows = await query(
    `SELECT 1 FROM member_map_access
     WHERE workspace_id = $1 AND user_id = $2 AND map_id = $3`,
    [workspaceId, user.id, mapId]
  );
  return rows.length ? access.role : null;
}

async function insertMapAccessRows(
  workspaceId: string,
  userId: string,
  mapIds: string[]
): Promise<void> {
  for (const mapId of mapIds) {
    await query(
      `INSERT INTO member_map_access (workspace_id, user_id, map_id, created_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [workspaceId, userId, mapId, now()]
    );
  }
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
  return [map, await mapAccessFor(user, map.workspace_id, map.id)];
}

function canWrite(role: MemberRow['role'] | null): boolean {
  return role === 'owner' || role === 'member';
}

async function saveMapState(map: MapRow, state: MapState, userId: string, name = map.name) {
  await query(
    'INSERT INTO map_versions (id, map_id, name, state, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), map.id, map.name, JSON.stringify(map.state), userId, now()]
  );
  await query(
    'UPDATE maps SET name = $1, state = $2, company_name = $3, updated_at = $4 WHERE id = $5',
    [name, JSON.stringify(state), state.meta?.companyName ?? map.company_name, now(), map.id]
  );
  await query(
    `DELETE FROM map_versions WHERE map_id = $1 AND id NOT IN
     (SELECT id FROM map_versions WHERE map_id = $1 ORDER BY created_at DESC LIMIT 50)`,
    [map.id]
  );
  const updated = await query<MapRow>('SELECT * FROM maps WHERE id = $1', [map.id]);
  return updated[0] ?? { ...map, name, state, updated_at: now() };
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

function sanitizeCompanyProfile(input: unknown): CompanyProfile | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const text = (key: string): string | null => {
    const raw = value[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed || null;
  };
  const number = (key: string): number | null => {
    const raw = value[key];
    const parsed =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const url = (key: string): string | null => {
    const raw = text(key);
    return raw && /^https?:\/\//i.test(raw) ? raw : null;
  };
  const fiscalYearEndMonth = number('fiscalYearEndMonth');
  return {
    companyName: text('companyName'),
    description: text('description'),
    mission: text('mission'),
    headquarters: text('headquarters'),
    annualRevenue: text('annualRevenue'),
    annualRevenueUsd: number('annualRevenueUsd'),
    employeeCount: number('employeeCount'),
    engineerCount: number('engineerCount'),
    industry: text('industry'),
    fiscalYearEndMonth:
      fiscalYearEndMonth !== null &&
      fiscalYearEndMonth >= 1 &&
      fiscalYearEndMonth <= 12
        ? fiscalYearEndMonth
        : null,
    linkedinUrl: url('linkedinUrl')?.replace(/\/+$/, '') ?? null,
    annualReportUrl: url('annualReportUrl'),
    funding: text('funding'),
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (item): item is string =>
            typeof item === 'string' && /^https?:\/\//i.test(item)
        )
      : [],
    retrievedAt: typeof value.retrievedAt === 'string' ? value.retrievedAt : '',
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
      companyProfile: sanitizeCompanyProfile(meta.companyProfile),
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
    return c.json(await refreshNextDueMap());
  } catch (error) {
    console.error('background refresh failed', error);
    return bad(c, 'background refresh failed', 500);
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
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    role: string;
    access_scope: 'all' | 'selected';
  }>(
    `SELECT u.id, u.name, u.email, m.role, m.access_scope
     FROM workspace_members m
     JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`,
    [wsId]
  );
  const accessRows = await query<{ user_id: string; map_id: string }>(
    'SELECT user_id, map_id FROM member_map_access WHERE workspace_id = $1',
    [wsId]
  );
  const mapIdsByUser = new Map<string, string[]>();
  for (const row of accessRows) {
    const list = mapIdsByUser.get(row.user_id) ?? [];
    list.push(row.map_id);
    mapIdsByUser.set(row.user_id, list);
  }
  const invites = await query<{
    id: string;
    email: string;
    created_at: string;
    expires_at: string;
    access_scope: 'all' | 'selected';
    map_ids: string[];
  }>(
    `SELECT id, email, created_at, expires_at, access_scope, map_ids
     FROM workspace_invites
     WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > $2
     ORDER BY created_at`,
    [wsId, now()]
  );
  return c.json({
    members: rows.map((m) => ({
      ...m,
      map_ids: m.access_scope === 'selected' ? (mapIdsByUser.get(m.id) ?? []) : [],
    })),
    invites: invites.map((inv) => ({
      ...inv,
      map_ids: inv.access_scope === 'selected' ? inv.map_ids : [],
    })),
  });
});

app.post('/api/workspaces/:id/members', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const selfAccess = await workspaceAccessFor(user, wsId);
  if (!selfAccess || !canWrite(selfAccess.role))
    return bad(c, 'insufficient role', 403);
  if (selfAccess.scoped)
    return bad(c, 'members with limited account access cannot manage members', 403);
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email)) return bad(c, 'valid email required');
  const workspaceMaps = await query<{ id: string; name: string }>(
    'SELECT id, name FROM maps WHERE workspace_id = $1',
    [wsId]
  );
  const access = parseAccessRequest(
    body,
    workspaceMaps.map((m) => m.id)
  );
  if (!access.ok) return bad(c, access.error);
  const accountNames = workspaceMaps
    .filter((m) => access.mapIds.includes(m.id))
    .map((m) => m.name);
  const target = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );
  if (target[0]) {
    try {
      await query(
        `INSERT INTO workspace_members
         (workspace_id, user_id, role, access_scope, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [wsId, target[0].id, 'member', access.scope, now()]
      );
    } catch {
      return bad(c, 'already a member', 409);
    }
    if (access.scope === 'selected') {
      await insertMapAccessRows(wsId, target[0].id, access.mapIds);
    }
    return c.json({ ok: true, added: true });
  }
  await query(
    'DELETE FROM workspace_invites WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL',
    [wsId, email]
  );
  const secret = newInviteSecret();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await query(
    `INSERT INTO workspace_invites
     (id, workspace_id, email, token_hash, role, invited_by, created_at, expires_at, access_scope, map_ids)
     VALUES ($1,$2,$3,$4,'member',$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      wsId,
      email,
      hashInviteToken(secret),
      user.id,
      now(),
      expiresAt,
      access.scope,
      JSON.stringify(access.scope === 'selected' ? access.mapIds : []),
    ]
  );
  const inviteUrl = `${appUrl(c)}/invite/${secret}`;
  const workspace = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1',
    [wsId]
  );
  const workspaceName = workspace[0]?.name ?? 'a workspace';
  const scopeNote =
    access.scope === 'selected'
      ? `\n\nYou'll have access to ${accountNames.length} account(s): ${
          accountNames.slice(0, 5).join(', ') +
          (accountNames.length > 5
            ? ` and ${accountNames.length - 5} more`
            : '')
        }`
      : '';
  const emailSent = await sendEmail({
    to: email,
    subject: `${user.name} invited you to ${workspaceName} on TopDown`,
    text: `${user.name} invited you to join ${workspaceName} on TopDown.${scopeNote}\n\nAccept the invite: ${inviteUrl}\n\nThis link expires in 7 days.`,
    html: `<p>${escapeHtml(user.name)} invited you to join <strong>${escapeHtml(
      workspaceName
    )}</strong> on TopDown.</p>${
      access.scope === 'selected'
        ? `<p>You'll have access to ${accountNames.length} account(s): ${escapeHtml(
            accountNames.slice(0, 5).join(', ') +
              (accountNames.length > 5
                ? ` and ${accountNames.length - 5} more`
                : '')
          )}</p>`
        : ''
    }<p><a href="${inviteUrl}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
  });
  return c.json({ ok: true, invited: true, inviteUrl, emailSent });
});

app.patch('/api/workspaces/:id/members/:userId/access', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const selfAccess = await workspaceAccessFor(user, wsId);
  if (!selfAccess || !canWrite(selfAccess.role)) {
    return bad(c, 'insufficient role', 403);
  }
  if (selfAccess.scoped) {
    return bad(c, 'members with limited account access cannot manage members', 403);
  }
  const target = await membership(param(c, 'userId'), wsId);
  if (!target) return bad(c, 'not a member', 404);
  if (target.role === 'owner') {
    return bad(c, 'owners always have full access');
  }
  const body = await c.req.json().catch(() => null);
  const workspaceMaps = await query<{ id: string }>(
    'SELECT id FROM maps WHERE workspace_id = $1',
    [wsId]
  );
  const access = parseAccessRequest(
    body,
    workspaceMaps.map((m) => m.id)
  );
  if (!access.ok) return bad(c, access.error);
  await query(
    'UPDATE workspace_members SET access_scope = $1 WHERE workspace_id = $2 AND user_id = $3',
    [access.scope, wsId, param(c, 'userId')]
  );
  await query(
    'DELETE FROM member_map_access WHERE workspace_id = $1 AND user_id = $2',
    [wsId, param(c, 'userId')]
  );
  if (access.scope === 'selected') {
    await insertMapAccessRows(wsId, param(c, 'userId'), access.mapIds);
  }
  return c.json({ ok: true });
});

app.delete('/api/workspaces/:id/invites/:inviteId', requireAuth, async (c) => {
  const user = c.get('user');
  const wsId = param(c, 'id');
  const role = await workspaceRoleFor(user, wsId);
  if (role !== 'owner' && role !== 'member')
    return bad(c, 'insufficient role', 403);
  await query(
    'DELETE FROM workspace_invites WHERE id = $1 AND workspace_id = $2',
    [param(c, 'inviteId'), wsId]
  );
  return c.json({ ok: true });
});

app.get('/api/invites/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  const rows = await query<{
    email: string;
    expires_at: string;
    accepted_at: string | null;
    workspace_name: string;
    inviter_name: string;
    workspace_id: string;
    access_scope: 'all' | 'selected';
    map_ids: string[];
  }>(
    `SELECT i.email, i.expires_at, i.accepted_at, i.workspace_id,
            i.access_scope, i.map_ids,
            w.name AS workspace_name, u.name AS inviter_name
     FROM workspace_invites i
     JOIN workspaces w ON w.id = i.workspace_id
     JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = $1`,
    [hashInviteToken(param(c, 'token'))]
  );
  const invite = rows[0];
  if (!invite) return bad(c, 'invite not found', 404);
  const accountNames =
    invite.access_scope === 'selected' && invite.map_ids.length
      ? (
          await query<{ name: string }>(
            'SELECT name FROM maps WHERE workspace_id = $1 AND id = ANY($2)',
            [invite.workspace_id, invite.map_ids]
          )
        ).map((m) => m.name)
      : [];
  const hasAccount =
    (await query('SELECT id FROM users WHERE email = $1', [invite.email]))
      .length > 0;
  const status = invite.accepted_at
    ? 'accepted'
    : Date.parse(invite.expires_at) <= Date.now()
      ? 'expired'
      : 'ok';
  return c.json({
    invite: {
      email: invite.email,
      workspaceName: invite.workspace_name,
      inviterName: invite.inviter_name,
      expiresAt: invite.expires_at,
      hasAccount,
      status,
      accessScope: invite.access_scope,
      accountNames,
    },
  });
});

app.post('/api/invites/:token/accept', async (c) => {
  c.header('Cache-Control', 'no-store');
  const rows = await query<{
    id: string;
    workspace_id: string;
    email: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
    access_scope: 'all' | 'selected';
    map_ids: string[];
  }>('SELECT * FROM workspace_invites WHERE token_hash = $1', [
    hashInviteToken(param(c, 'token')),
  ]);
  const invite = rows[0];
  if (!invite) return bad(c, 'invite not found', 404);
  if (invite.accepted_at || Date.parse(invite.expires_at) <= Date.now()) {
    return bad(c, 'invite is no longer valid', 410);
  }
  const session = await getSessionUser(getCookie(c, SESSION_COOKIE));
  const existing = await query<UserRow>(
    'SELECT * FROM users WHERE email = $1',
    [invite.email]
  );
  let user: UserRow;
  if (existing[0]) {
    const verdict = evaluateInvite(invite, {
      nowIso: now(),
      sessionEmail: session?.email ?? null,
    });
    if (!verdict.ok)
      return c.json(
        { error: `sign in as ${invite.email} to accept`, requires: 'login' },
        401
      );
    user = existing[0];
  } else {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const password =
      typeof body?.password === 'string' ? body.password : '';
    if (!name) return bad(c, 'name required');
    if (password.length < 8)
      return bad(c, 'password must be at least 8 characters');
    const userId = randomUUID();
    await query(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
      [userId, invite.email, name, hashPassword(password), now()]
    );
    user = (await query<UserRow>('SELECT * FROM users WHERE id = $1', [
      userId,
    ]))[0];
  }
  await query(
    `INSERT INTO workspace_members
     (workspace_id, user_id, role, access_scope, created_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [invite.workspace_id, user.id, invite.role, invite.access_scope, now()]
  );
  if (invite.access_scope === 'selected' && invite.map_ids.length) {
    await query(
      `INSERT INTO member_map_access (workspace_id, user_id, map_id, created_at)
       SELECT $1, $2, id, $4 FROM maps
       WHERE id = ANY($3) AND workspace_id = $1
       ON CONFLICT DO NOTHING`,
      [invite.workspace_id, user.id, invite.map_ids, now()]
    );
  }
  await query(
    'UPDATE workspace_invites SET accepted_at = $1 WHERE id = $2',
    [now(), invite.id]
  );
  const token = await createSession(user.id);
  setSessionCookie(c, token);
  return c.json({
    user: sessionUser(user),
    workspaces: await workspacesFor(user),
    workspaceId: invite.workspace_id,
  });
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

// ---------- personas (F3) ----------

async function workspaceSellerProfile(
  workspaceId: string
): Promise<SellerProfile | null> {
  const rows = await query<{ seller_profile: SellerProfile | null }>(
    'SELECT seller_profile FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  return rows[0]?.seller_profile ?? null;
}

app.get('/api/workspaces/:id/personas', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  if (!(await workspaceRoleFor(user, workspaceId))) return bad(c, 'not found', 404);
  return c.json({
    personas: await ensureDefaultPersonas(
      workspaceId,
      await workspaceSellerProfile(workspaceId)
    ),
  });
});

app.put('/api/workspaces/:id/personas', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  if (!canWrite(await workspaceRoleFor(user, workspaceId))) {
    return bad(c, 'insufficient role', 403);
  }
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body?.personas)) return bad(c, 'personas array required');
  const personas = sanitizePersonas(body.personas);
  if (personas.length !== body.personas.length) {
    return bad(c, 'each persona needs a name, valid functions and a seniority');
  }
  if (personas.length > MAX_PERSONAS) {
    return bad(c, `at most ${MAX_PERSONAS} personas`);
  }
  return c.json({ personas: await replacePersonas(workspaceId, personas) });
});

app.post('/api/workspaces/:id/personas/suggest', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  if (!canWrite(await workspaceRoleFor(user, workspaceId))) {
    return bad(c, 'insufficient role', 403);
  }
  const suggestion = await suggestPersonas(
    await workspaceSellerProfile(workspaceId)
  );
  return c.json(suggestion);
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
  if (!job.workspace_id) return null;
  const access = await workspaceAccessFor(user, job.workspace_id);
  if (!access) return null;
  if (access.scoped && job.map_id) {
    const rows = await query(
      `SELECT 1 FROM member_map_access
       WHERE workspace_id = $1 AND user_id = $2 AND map_id = $3`,
      [job.workspace_id, user.id, job.map_id]
    );
    if (!rows.length) return null;
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

// ---------- maps ----------

app.get('/api/maps/:id/export.xlsx', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const account = await exportAccountForMap(map, appUrl(c));
  const workbook = await buildTerritoryWorkbook([account], {
    includeTerritorySheet: false,
  });
  return sendWorkbook(
    c,
    workbook,
    `${account.companyName || account.name} - Account Plan.xlsx`
  );
});

app.get('/api/workspaces/:id/export.xlsx', requireAuth, async (c) => {
  const user = c.get('user');
  const workspaceId = param(c, 'id');
  const access = await workspaceAccessFor(user, workspaceId);
  if (!access) return bad(c, 'not a member', 403);
  const rows = access.scoped
    ? await query<MapRow>(
        `SELECT id, workspace_id, name, domain, company_name, state,
                is_live_opportunity, created_by, created_at, updated_at
         FROM maps WHERE workspace_id = $1
           AND id IN (
             SELECT map_id FROM member_map_access
             WHERE workspace_id = $1 AND user_id = $2
           )
         ORDER BY updated_at DESC`,
        [workspaceId, user.id]
      )
    : await query<MapRow>(
        `SELECT id, workspace_id, name, domain, company_name, state,
                is_live_opportunity, created_by, created_at, updated_at
         FROM maps WHERE workspace_id = $1 ORDER BY updated_at DESC`,
        [workspaceId]
      );
  const workspaces = await query<{ name: string }>(
    'SELECT name FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (!workspaces[0]) return bad(c, 'workspace not found', 404);
  const accounts = await Promise.all(
    rows.map((map) => exportAccountForMap(map, appUrl(c)))
  );
  const workbook = await buildTerritoryWorkbook(accounts, {
    includeTerritorySheet: true,
  });
  return sendWorkbook(
    c,
    workbook,
    `Territory - ${workspaces[0].name}.xlsx`
  );
});

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

async function freeMapLimitReached(user: UserRow, wsId: string): Promise<boolean> {
  const workspaces = await query<{ plan: 'free' | 'pro' }>(
    'SELECT plan FROM workspaces WHERE id = $1',
    [wsId]
  );
  if (!workspaces[0]) throw new Error('workspace not found');
  if (isSuperAdmin(user) || workspaces[0].plan !== 'free') return false;
  const counts = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM maps WHERE workspace_id = $1',
    [wsId]
  );
  return Number(counts[0]?.count ?? 0) >= 2;
}

const PLAN_LIMIT_MESSAGE =
  'Free workspaces include two account maps. Upgrade to Pro for unlimited maps.';

async function insertMap(input: {
  wsId: string;
  name: string;
  domain: string;
  state: MapState;
  user: UserRow;
  scoped: boolean;
}): Promise<string> {
  const { wsId, name, domain, state, user } = input;
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
  if (input.scoped) {
    await insertMapAccessRows(wsId, user.id, [id]);
  }
  return id;
}

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

app.get('/api/maps/:id/roster', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(c.req.query('pageSize') ?? 50) || 50)
  );
  const page = Math.max(0, Number(c.req.query('page') ?? 0) || 0);
  const data = await listRoster(map.workspace_id, map.domain, {
    q: c.req.query('q') || undefined,
    function: c.req.query('function') || undefined,
    seniority: c.req.query('seniority') || undefined,
    status: c.req.query('status') || 'suggested',
    source: c.req.query('source') || undefined,
    page,
    pageSize,
  });
  return c.json({
    ...data,
    counts: await rosterCounts(map.workspace_id, map.domain),
    providers: configuredRosterProviders(),
  });
});

app.post('/api/maps/:id/roster/sync', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot sync roster', 403);
  const existing = await query<{ id: string }>(
    `SELECT id FROM roster_sync_jobs
     WHERE map_id = $1 AND status IN ('queued', 'running')
     LIMIT 1`,
    [map.id]
  );
  if (existing[0]) {
    return c.json(
      {
        error: 'roster sync already running',
        jobId: existing[0].id,
      },
      409
    );
  }
  const job = await createRosterSyncJob({
    workspaceId: map.workspace_id,
    mapId: map.id,
    userId: user.id,
    domain: map.domain,
  });
  if (!process.env.VERCEL) {
    void runRosterSync(job.id).catch((error) =>
      console.error('roster sync failed', error)
    );
  }
  return c.json({ jobId: job.id }, 202);
});

app.get('/api/maps/:id/roster/sync/:jobId', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  const job = await getRosterSyncJob(param(c, 'jobId'));
  if (!job || job.map_id !== map.id) return bad(c, 'roster sync job not found', 404);
  if (job.status === 'queued' && !process.env.VERCEL) {
    void runRosterSync(job.id).catch((error) =>
      console.error('roster sync tick failed', error)
    );
  }
  return c.json({
    job: {
      id: job.id,
      status: job.status,
      events: job.events,
      summary: job.summary,
      error: job.error,
    },
  });
});

app.post('/api/maps/:id/roster/import', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot import roster', 403);
  const body = await c.req.json().catch(() => null);
  const rows =
    typeof body?.csv === 'string'
      ? rowsFromCsv(body.csv).map((row) => ({
          ...row,
          source: 'csv' as const,
          confidence: 'medium' as const,
        }))
      : Array.isArray(body?.linkedinUrls)
        ? rowsFromLinkedinUrls(
            body.linkedinUrls.filter(
              (value: unknown): value is string => typeof value === 'string'
            )
          ).map((row) => ({
            ...row,
            source: 'linkedin_url' as const,
            confidence: 'low' as const,
          }))
        : [];
  if (rows.length === 0) return bad(c, 'csv or linkedinUrls required');
  const result = await upsertRosterPeople(
    map.workspace_id,
    map.domain,
    rows.map((row) => ({
      name: row.name,
      title: row.title,
      location: row.location,
      linkedin: row.linkedin,
      email: row.email,
      managerKey: row.manager
        ? canonicalPersonName(row.manager)
        : null,
      source: row.source,
      confidence: row.confidence,
      sourceUrl: row.linkedin,
      raw: row,
    }))
  );
  return c.json({
    imported: result.upserted,
    counts: await rosterCounts(map.workspace_id, map.domain),
  });
});

app.post('/api/maps/:id/roster/add', requireAuth, async (c) => {
  const user = c.get('user');
  const [map, role] = await mapForUser(user, param(c, 'id'));
  if (!map || !role) return bad(c, 'not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot add roster people', 403);
  const body = await c.req.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? body.ids
        .filter((id: unknown): id is string => typeof id === 'string')
        .slice(0, 200)
    : [];
  const rows = await query<RosterPersonRow>(
    `SELECT * FROM roster_people WHERE workspace_id = $1 AND domain = $2 AND id = ANY($3::text[])`,
    [map.workspace_id, map.domain.trim().toLowerCase(), ids]
  );
  const pending = rows.filter((row) => row.status !== 'added');
  if (pending.length === 0) return c.json({ map: { ...map, role }, added: 0 });
  const state = map.state as MapState;
  const existing = state.people;
  const baseX = existing.length ? Math.min(...existing.map((person) => person.x)) : 0;
  const baseY = existing.length ? Math.max(...existing.map((person) => person.y)) + 240 : 0;
  const additions = pending.map((row, index) => {
    const classified = classifyTitle(row.title);
    const fn = (row.function || classified.function) as Fn;
    return {
      id: randomUUID(),
      name: row.name,
      title: row.title ?? 'Employee',
      department: functionToDepartment(fn),
      team: null,
      role: 'none' as const,
      confidence: row.confidence,
      sources: row.source_url
        ? [row.source_url]
        : row.linkedin
          ? [row.linkedin]
          : [],
      notes: '',
      email: row.email,
      linkedin: row.linkedin,
      jobLevel: seniorityToJobLevel(
        (row.seniority || classified.seniority) as Seniority
      ),
      x: baseX + (index % 4) * 260,
      y: baseY + Math.floor(index / 4) * 140,
    };
  });
  const keyToId = new Map<string, string>();
  const rosterManagers = await query<{
    person_key: string;
    map_person_id: string;
  }>(
    `SELECT person_key, map_person_id FROM roster_people
     WHERE workspace_id = $1 AND domain = $2 AND status = 'added' AND map_person_id IS NOT NULL`,
    [map.workspace_id, map.domain.trim().toLowerCase()]
  );
  for (const row of rosterManagers) {
    keyToId.set(row.person_key, row.map_person_id);
  }
  for (const person of existing) {
    keyToId.set(canonicalPersonName(person.name), person.id);
    const linkedinKey = linkedinSlug(person.linkedin);
    if (linkedinKey) keyToId.set(linkedinKey, person.id);
  }
  for (const person of additions) {
    keyToId.set(canonicalPersonName(person.name), person.id);
    const linkedinKey = linkedinSlug(person.linkedin);
    if (linkedinKey) keyToId.set(linkedinKey, person.id);
  }
  const edges = [...state.edges];
  for (let index = 0; index < pending.length; index += 1) {
    const manager = pending[index].manager_key ? keyToId.get(pending[index].manager_key!) : undefined;
    if (manager && manager !== additions[index].id) {
      edges.push({
        id: randomUUID(),
        from: manager,
        to: additions[index].id,
        kind: 'reports',
        label: null,
      });
    }
  }
  const updated = await saveMapState(map, { ...state, people: [...existing, ...additions], edges }, user.id);
  await setRosterStatus(
    map.workspace_id,
    map.domain,
    pending.map((row) => row.id),
    'added',
    new Map(
      pending.map((row, index) => [row.id, additions[index].id])
    )
  );
  return c.json({ map: { ...updated, role }, added: additions.length });
});

for (const action of ['dismiss', 'restore'] as const) {
  app.post(`/api/maps/:id/roster/${action}`, requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    if (!canWrite(role)) return bad(c, 'viewers cannot update roster', 403);
    const body = await c.req.json().catch(() => null);
    const ids = Array.isArray(body?.ids)
      ? body.ids
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 200)
      : [];
    await setRosterStatus(
      map.workspace_id,
      map.domain,
      ids,
      action === 'dismiss' ? 'dismissed' : 'suggested',
      undefined,
      action === 'restore'
    );
    return c.json({ ok: true });
  });
}

// ---------- Chrome extension ----------
// Token management uses the web session; data routes use bearer tokens.

app.get('/api/extension/tokens', requireAuth, async (c) => {
  return c.json({ tokens: await listExtensionTokens(c.get('user').id) });
});

app.post('/api/extension/tokens', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const label = typeof body?.label === 'string' ? body.label : '';
  const existing = await listExtensionTokens(user.id);
  if (existing.length >= 10) return bad(c, 'revoke an existing token first (max 10)');
  const { token, row } = await createExtensionToken(user.id, label);
  return c.json({ token, record: publicToken(row) }, 201);
});

app.delete('/api/extension/tokens/:id', requireAuth, async (c) => {
  const removed = await revokeExtensionToken(c.get('user').id, param(c, 'id'));
  if (!removed) return bad(c, 'token not found', 404);
  return c.json({ ok: true });
});

const requireExtensionAuth = makeRequireExtensionAuth(lookupExtensionUser);

function normalizeDomain(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '')
    : '';
}

app.get('/api/extension/me', requireExtensionAuth, async (c) => {
  const user = c.get('user');
  const workspaces = await workspacesFor(user);
  return c.json({
    user: publicUser(user),
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
  });
});

app.get('/api/extension/accounts', requireExtensionAuth, async (c) => {
  const user = c.get('user');
  const domain = normalizeDomain(c.req.query('domain'));
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
  const workspaces = await workspacesFor(user);
  const accounts: {
    id: string;
    name: string;
    domain: string;
    companyName: string | null;
    workspace: { id: string; name: string };
    peopleCount: number;
    match: 'domain' | 'query' | null;
  }[] = [];
  for (const workspace of workspaces) {
    const access = await workspaceAccessFor(user, workspace.id);
    if (!access) continue;
    const rows = await query<MapRow & { people_count: number }>(
      `SELECT id, name, domain, company_name,
              COALESCE(jsonb_array_length(state->'people'), 0)::int AS people_count
       FROM maps WHERE workspace_id = $1
       ${access.scoped
         ? 'AND id IN (SELECT map_id FROM member_map_access WHERE workspace_id = $1 AND user_id = $2)'
         : ''}
       ORDER BY updated_at DESC LIMIT 200`,
      access.scoped ? [workspace.id, user.id] : [workspace.id]
    );
    for (const row of rows) {
      const rowDomain = normalizeDomain(row.domain);
      const haystack = `${row.name} ${rowDomain} ${row.company_name ?? ''}`.toLowerCase();
      const match: 'domain' | 'query' | null =
        domain && rowDomain === domain
          ? 'domain'
          : q && haystack.includes(q)
            ? 'query'
            : null;
      if ((domain || q) && !match) continue;
      accounts.push({
        id: row.id,
        name: row.name,
        domain: row.domain,
        companyName: row.company_name,
        workspace: { id: workspace.id, name: workspace.name },
        peopleCount: row.people_count,
        match,
      });
    }
  }
  accounts.sort((a, b) => (a.match === 'domain' ? -1 : 0) - (b.match === 'domain' ? -1 : 0));
  return c.json({ accounts: accounts.slice(0, 50) });
});

app.post('/api/extension/accounts', requireExtensionAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const domain = normalizeDomain(body?.domain);
  if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
  const workspaces = await workspacesFor(user);
  const wsId =
    typeof body?.workspaceId === 'string' && body.workspaceId
      ? body.workspaceId
      : workspaces[0]?.id ?? '';
  const access = await workspaceAccessFor(user, wsId);
  if (!access || !canWrite(access.role)) return bad(c, 'insufficient role', 403);
  const existing = await query<{ id: string }>(
    'SELECT id FROM maps WHERE workspace_id = $1 AND LOWER(domain) = $2 LIMIT 1',
    [wsId, domain]
  );
  if (existing[0]) return c.json({ id: existing[0].id, created: false });
  if (await freeMapLimitReached(user, wsId)) {
    return c.json({ error: PLAN_LIMIT_MESSAGE, code: 'plan_limit' }, 402);
  }
  const name =
    typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : domain;
  // Blank state with a refresh cadence: the background refresher
  // (`/api/cron/refresh`) researches it on its next tick.
  const state = sanitizeState({ meta: { companyName: name, refreshCadence: 'weekly' } });
  const id = await insertMap({ wsId, name, domain, state, user, scoped: access.scoped });
  await recordAnalytics({
    eventName: 'map_created',
    userId: user.id,
    workspaceId: wsId,
    mapId: id,
    properties: mapCreationMetrics({
      creationMode: 'blank',
      provider: null,
      researchedAt: null,
      peopleCount: 0,
      sourceCount: 0,
      initiativeCount: 0,
      edgeCount: 0,
      researchStartedAt: undefined,
    }),
  });
  return c.json({ id, created: true }, 201);
});

app.post('/api/extension/roster', requireExtensionAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const mapId = typeof body?.mapId === 'string' ? body.mapId : '';
  const [map, role] = await mapForUser(user, mapId);
  if (!map || !role) return bad(c, 'account not found', 404);
  if (!canWrite(role)) return bad(c, 'viewers cannot add roster people', 403);
  const source = body?.source === 'sales_navigator' ? 'sales_navigator' : 'linkedin_url';
  const people = parseExtensionPeople(body?.people);
  if (people.length === 0) return bad(c, 'people required');
  const inputs = rosterInputsFromExtension(people, source);
  const known = await knownPersonKeys(map.workspace_id, map.domain, inputs);
  const result = await upsertRosterPeople(map.workspace_id, map.domain, inputs);
  const alreadyKnown = inputs.filter((input) =>
    known.has(personKeyFor(input.name, input.linkedin))
  ).length;
  await recordAnalytics({
    eventName: 'roster_imported',
    userId: user.id,
    workspaceId: map.workspace_id,
    mapId: map.id,
    properties: { source, count: people.length, already_known: alreadyKnown },
  });
  return c.json({
    upserted: result.upserted,
    alreadyKnown,
    counts: await rosterCounts(map.workspace_id, map.domain),
  });
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
