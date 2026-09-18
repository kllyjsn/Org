import { createHash, randomBytes } from 'node:crypto';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newInviteSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isValidEmail(email: unknown): email is string {
  return (
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

export type AccessScope = 'all' | 'selected';

export function parseAccessRequest(
  body: unknown,
  workspaceMapIds: string[]
): { ok: true; scope: AccessScope; mapIds: string[] } | { ok: false; error: string } {
  const raw =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).accessScope
      : undefined;
  if (raw === undefined || raw === null || raw === 'all') {
    return { ok: true, scope: 'all', mapIds: [] };
  }
  if (raw !== 'selected') {
    return { ok: false, error: 'accessScope must be "all" or "selected"' };
  }
  const ids =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).mapIds
      : undefined;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'select at least one account' };
  }
  const mapIds = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (mapIds.length === 0) {
    return { ok: false, error: 'select at least one account' };
  }
  const known = new Set(workspaceMapIds);
  if (mapIds.some((id) => !known.has(id))) {
    return { ok: false, error: 'unknown account in selection' };
  }
  return { ok: true, scope: 'selected', mapIds };
}

export interface InviteLike {
  email: string;
  expires_at: string;
  accepted_at: string | null;
}

export function evaluateInvite(
  invite: InviteLike,
  ctx: { nowIso: string; sessionEmail?: string | null }
): { ok: true } | { ok: false; reason: 'expired' | 'accepted' | 'email_mismatch' } {
  if (invite.accepted_at) return { ok: false, reason: 'accepted' };
  if (Date.parse(invite.expires_at) <= Date.parse(ctx.nowIso)) {
    return { ok: false, reason: 'expired' };
  }
  if (
    ctx.sessionEmail &&
    normalizeEmail(ctx.sessionEmail) !== normalizeEmail(invite.email)
  ) {
    return { ok: false, reason: 'email_mismatch' };
  }
  return { ok: true };
}
