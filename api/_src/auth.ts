import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { sessions, users, workspaces, members, now } from './db.js';
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
  await (
    await sessions()
  ).insertOne({
    token,
    user_id: userId,
    created_at: now(),
    expires_at: expires,
  });
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await (await sessions()).deleteOne({ token });
}

export async function getSessionUser(
  token: string | undefined
): Promise<UserRow | null> {
  if (!token) return null;
  const s = await (
    await sessions()
  ).findOne({ token, expires_at: { $gt: now() } });
  if (!s) return null;
  const u = await (await users()).findOne({ id: s.user_id });
  return u ?? null;
}

export async function createWorkspaceForUser(
  userId: string,
  name: string
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  await (
    await workspaces()
  ).insertOne({ id, name, created_by: userId, created_at: now() });
  await (
    await members()
  ).insertOne({
    workspace_id: id,
    user_id: userId,
    role: 'owner',
    created_at: now(),
  });
  return { id, name };
}

export async function memberRole(
  userId: string,
  workspaceId: string
): Promise<MemberRow['role'] | null> {
  const row = await (
    await members()
  ).findOne(
    { workspace_id: workspaceId, user_id: userId },
    { projection: { role: 1 } }
  );
  return row?.role ?? null;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name };
}
