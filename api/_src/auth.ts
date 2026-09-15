import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { query, now } from './db.js';
import type { UserRow, MemberRow } from './types.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'org_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hash = scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)',
    [token, userId, now(), expires]
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function getSessionUser(
  token: string | undefined
): Promise<UserRow | null> {
  if (!token) return null;
  const rows = await query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2`,
    [token, now()]
  );
  return rows[0] ?? null;
}

export async function createWorkspaceForUser(
  userId: string,
  name: string
): Promise<{ id: string; name: string; plan: 'free' }> {
  const id = randomUUID();
  await query(
    'INSERT INTO workspaces (id, name, created_by, created_at) VALUES ($1,$2,$3,$4)',
    [id, name, userId, now()]
  );
  await query(
    'INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1,$2,$3,$4)',
    [id, userId, 'owner', now()]
  );
  return { id, name, plan: 'free' };
}

export async function memberRole(
  userId: string,
  workspaceId: string
): Promise<MemberRow['role'] | null> {
  const rows = await query<{ role: MemberRow['role'] }>(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );
  return rows[0]?.role ?? null;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name };
}
