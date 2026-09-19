import type { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { query, now } from './db.js';
import { recordProductEvent } from './analytics.js';
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  getSessionUser,
  memberRole,
  membership,
  publicUser,
} from './auth.js';
import {
  lookupExtensionUser,
  makeRequireExtensionAuth,
} from './extension-tokens.js';
import type {
  MapRow,
  MapState,
  MemberRow,
  SellerProfile,
  UserRow,
} from './types.js';

export async function requireAuth(c: Context, next: Next) {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
}

export const requireExtensionAuth = makeRequireExtensionAuth(
  lookupExtensionUser
);

export { createSession, deleteSession, getSessionUser };

export function setSessionCookie(c: Context, token: string) {
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

export function sessionUser(user: UserRow) {
  return { ...publicUser(user), isAdmin: isSuperAdmin(user) };
}

export function isSuperAdmin(user: UserRow): boolean {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .includes(user.email.toLowerCase());
}

export async function workspaceRoleFor(
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
export async function workspaceAccessFor(
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
export async function mapAccessFor(
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

export async function insertMapAccessRows(
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

export async function workspacesFor(user: UserRow) {
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
export async function mapForUser(
  user: UserRow,
  mapId: string
): Promise<[MapRow | null, MemberRow['role'] | null]> {
  const rows = await query<MapRow>('SELECT * FROM maps WHERE id = $1', [mapId]);
  const map = rows[0];
  if (!map) return [null, null];
  return [map, await mapAccessFor(user, map.workspace_id, map.id)];
}

export function canWrite(role: MemberRow['role'] | null): boolean {
  return role === 'owner' || role === 'member';
}

export async function saveMapState(map: MapRow, state: MapState, userId: string, name = map.name) {
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

export async function recordAnalytics(
  input: Parameters<typeof recordProductEvent>[0]
): Promise<void> {
  try {
    await recordProductEvent(input);
  } catch (error) {
    console.error('analytics event failed', error);
  }
}

export async function freeMapLimitReached(user: UserRow, wsId: string): Promise<boolean> {
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

export const PLAN_LIMIT_MESSAGE =
  'Free workspaces include two account maps. Upgrade to Pro for unlimited maps.';

export async function insertMap(input: {
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

export async function workspaceSellerProfile(
  workspaceId: string
): Promise<SellerProfile | null> {
  const rows = await query<{ seller_profile: SellerProfile | null }>(
    'SELECT seller_profile FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  return rows[0]?.seller_profile ?? null;
}
