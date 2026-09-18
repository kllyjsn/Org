import { createHash, randomBytes } from 'node:crypto';
import { verifyPassword } from './auth.js';

export const PASSCODE_MAX_ATTEMPTS = 5;
export const PASSCODE_LOCK_MS = 15 * 60 * 1000;
export const SHARE_GRANT_TTL_MS = 12 * 60 * 60 * 1000;

export function newShareSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAllowedEmails(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    seen.add(email);
    if (seen.size >= 50) break;
  }
  return seen.size > 0 ? [...seen] : null;
}

export function isValidPasscode(passcode: unknown): passcode is string {
  if (typeof passcode !== 'string') return false;
  const length = passcode.trim().length;
  return length >= 6 && length <= 128;
}

export interface ShareAccessLink {
  expires_at: string | null;
  passcode_hash: string | null;
  allowed_emails: string[] | null;
  locked_until: string | null;
}

export interface ShareAccessContext {
  passcode?: string | null;
  userEmail?: string | null;
}

export type ShareAccessResult =
  | { kind: 'expired' }
  | { kind: 'login_required' }
  | { kind: 'not_allowed' }
  | { kind: 'locked'; retryAfterSec: number }
  | { kind: 'passcode_required' }
  | { kind: 'wrong_passcode' }
  | { kind: 'ok' };

export function evaluateShareAccess(
  link: ShareAccessLink,
  ctx: ShareAccessContext,
  nowIso: string
): ShareAccessResult {
  if (link.expires_at && link.expires_at <= nowIso) return { kind: 'expired' };
  if (link.allowed_emails && link.allowed_emails.length > 0) {
    const email = ctx.userEmail?.trim().toLowerCase();
    if (!email) return { kind: 'login_required' };
    if (!link.allowed_emails.includes(email)) return { kind: 'not_allowed' };
  }
  if (link.passcode_hash) {
    if (link.locked_until && link.locked_until > nowIso) {
      return {
        kind: 'locked',
        retryAfterSec: Math.max(
          1,
          Math.ceil((Date.parse(link.locked_until) - Date.parse(nowIso)) / 1000)
        ),
      };
    }
    if (!ctx.passcode) return { kind: 'passcode_required' };
    if (!verifyPassword(ctx.passcode, link.passcode_hash)) {
      return { kind: 'wrong_passcode' };
    }
  }
  return { kind: 'ok' };
}
