import { getCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { appUrl, bad, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  SESSION_COOKIE,
  createWorkspaceForUser,
  deleteSession,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import {
  createSession,
  requireAuth,
  sessionUser,
  setSessionCookie,
  workspacesFor,
} from '../authz.js';
import { perIp } from '../rate-limit.js';
import { sendEmail } from '../email.js';
import { hashInviteToken, newInviteSecret } from '../invites.js';
import type { Context } from 'hono';
import type { UserRow } from '../types.js';

// 10 attempts per IP per 5 minutes on credential endpoints — enough for a
// human who typos, far too small for brute force.
const authLimit = perIp('auth', 10, 5 * 60_000);
// Reset requests are unauthenticated and send email — tighter cap.
const resetLimit = perIp('password-reset', 5, 15 * 60_000);

type EmailTokenKind = 'verify' | 'reset';
const EMAIL_TOKEN_TTL_MS: Record<EmailTokenKind, number> = {
  verify: 24 * 60 * 60_000,
  reset: 30 * 60_000,
};

async function issueEmailToken(
  userId: string,
  kind: EmailTokenKind
): Promise<string> {
  const secret = newInviteSecret();
  await query(
    `INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      hashInviteToken(secret),
      userId,
      kind,
      new Date(Date.now() + EMAIL_TOKEN_TTL_MS[kind]).toISOString(),
      now(),
    ]
  );
  return secret;
}

// Single-statement consume: atomic across concurrent requests, and expired
// or used tokens can't match the UPDATE predicate.
async function consumeEmailToken(
  secret: string,
  kind: EmailTokenKind
): Promise<string | null> {
  const rows = await query<{ user_id: string }>(
    `UPDATE email_tokens SET used_at = $1
     WHERE token_hash = $2 AND kind = $3 AND used_at IS NULL AND expires_at > $1
     RETURNING user_id`,
    [now(), hashInviteToken(secret), kind]
  );
  return rows[0]?.user_id ?? null;
}

async function sendVerifyEmail(
  c: Context,
  userId: string,
  email: string
): Promise<boolean> {
  const secret = await issueEmailToken(userId, 'verify');
  const link = `${appUrl(c)}/verify-email?token=${secret}`;
  return sendEmail({
    to: email,
    subject: 'Verify your TopDown email',
    text: `Confirm this address for your TopDown account:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Confirm this address for your TopDown account:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export function registerAuthRoutes(app: App): void {
  app.post('/api/auth/register', authLimit, async (c) => {
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
    void sendVerifyEmail(c, userId, email.toLowerCase()).catch(() => undefined);

    const token = await createSession(userId);
    setSessionCookie(c, token);
    const users = await query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    return c.json({
      user: sessionUser(users[0]),
      workspaces: await workspacesFor(users[0]),
    });
  });

  app.post('/api/auth/login', authLimit, async (c) => {
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

  app.post('/api/auth/verify/request', requireAuth, async (c) => {
    const user = c.get('user');
    if (user.email_verified_at) {
      return c.json({ ok: true, alreadyVerified: true });
    }
    const sent = await sendVerifyEmail(c, user.id, user.email);
    return c.json({ ok: true, sent });
  });

  app.post('/api/auth/verify/confirm', async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token : '';
    const userId = token ? await consumeEmailToken(token, 'verify') : null;
    if (!userId) return bad(c, 'link is invalid or expired');
    await query('UPDATE users SET email_verified_at = $1 WHERE id = $2', [
      now(),
      userId,
    ]);
    return c.json({ ok: true });
  });

  app.post('/api/auth/forgot-password', resetLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Always ok — a 404 would leak which emails hold accounts.
    if (email) {
      const users = await query<UserRow>(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      const user = users[0];
      if (user) {
        const secret = await issueEmailToken(user.id, 'reset');
        const link = `${appUrl(c)}/reset-password?token=${secret}`;
        void sendEmail({
          to: user.email,
          subject: 'Reset your TopDown password',
          text: `Reset your TopDown password:\n\n${link}\n\nThis link expires in 30 minutes. If you did not ask for it, ignore this email.`,
          html: `<p>Reset your TopDown password:</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not ask for it, ignore this email.</p>`,
        }).catch(() => undefined);
      }
    }
    return c.json({ ok: true });
  });

  app.post('/api/auth/reset-password', resetLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (password.length < 8)
      return bad(c, 'password must be at least 8 characters');
    const userId = token ? await consumeEmailToken(token, 'reset') : null;
    if (!userId) return bad(c, 'link is invalid or expired');
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hashPassword(password),
      userId,
    ]);
    // A reset implies a possibly-lost credential — sign every session out.
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return c.json({ ok: true });
  });

  app.get('/api/me', requireAuth, async (c) => {
    const user = c.get('user');
    return c.json({
      user: sessionUser(user),
      workspaces: await workspacesFor(user),
    });
  });
}
