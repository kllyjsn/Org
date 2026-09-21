import { getCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { appUrl, bad, escapeHtml, param, type App } from '../http.js';
import { query, now } from '../db.js';
import {
  SESSION_COOKIE,
  createWorkspaceForUser,
  hashPassword,
  membership,
} from '../auth.js';
import {
  canWrite,
  createSession,
  getSessionUser,
  insertMapAccessRows,
  isSuperAdmin,
  requireAuth,
  sessionUser,
  setSessionCookie,
  workspaceAccessFor,
  workspaceRoleFor,
  workspaceSellerProfile,
  workspacesFor,
} from '../authz.js';
import {
  INVITE_TTL_MS,
  evaluateInvite,
  hashInviteToken,
  isValidEmail,
  newInviteSecret,
  normalizeEmail,
  parseAccessRequest,
} from '../invites.js';
import { perIp, perUser } from '../rate-limit.js';
import { sendEmail } from '../email.js';
import { DOMAIN_RE } from '../research.js';
import {
  researchSellerProfile,
  sanitizeSellerProfile,
} from '../seller-profile.js';
import {
  MAX_PERSONAS,
  ensureDefaultPersonas,
  replacePersonas,
  sanitizePersonas,
  suggestPersonas,
} from '../personas.js';
import type { UserRow, WorkspaceRow } from '../types.js';

export function registerWorkspaceRoutes(app: App): void {
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

  app.post('/api/invites/:token/accept', perIp('invite-accept', 10, 5 * 60_000), async (c) => {
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

  app.post('/api/workspaces/:id/seller-profile/research', requireAuth, perUser('seller-research', 12, 60 * 60_000), async (c) => {
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

  app.post('/api/workspaces/:id/personas/suggest', requireAuth, perUser('personas-suggest', 12, 60 * 60_000), async (c) => {
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
}
