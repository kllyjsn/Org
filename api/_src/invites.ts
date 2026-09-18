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
