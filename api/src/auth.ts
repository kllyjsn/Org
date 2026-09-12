import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { db, now } from './db.js';
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

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)'
  ).run(token, userId, now(), expires);
  return token;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionUser(token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, now()) as UserRow | undefined;
  return row ?? null;
}

export function createWorkspaceForUser(
  userId: string,
  name: string
): { id: string; name: string } {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?,?,?,?)'
  ).run(id, name, userId, now());
  db.prepare(
    'INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)'
  ).run(id, userId, 'owner', now());
  return { id, name };
}

export function memberRole(
  userId: string,
  workspaceId: string
): MemberRow['role'] | null {
  const row = db
    .prepare(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
    )
    .get(workspaceId, userId) as { role: MemberRow['role'] } | undefined;
  return row?.role ?? null;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name };
}
