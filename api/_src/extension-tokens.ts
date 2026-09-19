import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { now, query } from './db.js';
import type { RosterUpsertInput } from './roster.js';
import type { UserRow } from './types.js';

export const EXTENSION_TOKEN_PREFIX = 'tdx_';
export type ExtensionSource = 'linkedin_url' | 'sales_navigator';

export interface ExtensionTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export function newExtensionToken(): string {
  return `${EXTENSION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashExtensionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Extracts the bearer token from an Authorization header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.trim().match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] ?? null;
  return token && token.startsWith(EXTENSION_TOKEN_PREFIX) ? token : null;
}

export function isExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

export type ExtensionUserLookup = (tokenHash: string) => Promise<UserRow | null>;

export async function lookupExtensionUser(tokenHash: string): Promise<UserRow | null> {
  const rows = await query<UserRow & { token_id: string }>(
    `SELECT u.*, t.id AS token_id FROM extension_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  void query('UPDATE extension_tokens SET last_used_at = $1 WHERE id = $2', [
    now(),
    row.token_id,
  ]).catch(() => undefined);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    password_hash: row.password_hash,
    created_at: row.created_at,
  };
}

export function makeRequireExtensionAuth(lookup: ExtensionUserLookup) {
  return async (c: Context, next: Next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ error: 'extension token required' }, 401);
    const user = await lookup(hashExtensionToken(token));
    if (!user) return c.json({ error: 'invalid extension token' }, 401);
    c.set('user', user);
    await next();
  };
}

export async function createExtensionToken(
  userId: string,
  label: string
): Promise<{ token: string; row: ExtensionTokenRow }> {
  const token = newExtensionToken();
  const row: ExtensionTokenRow = {
    id: randomUUID(),
    user_id: userId,
    token_hash: hashExtensionToken(token),
    label: label.trim().slice(0, 80) || 'Chrome extension',
    created_at: now(),
    last_used_at: null,
  };
  await query(
    `INSERT INTO extension_tokens (id, user_id, token_hash, label, created_at, last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [row.id, row.user_id, row.token_hash, row.label, row.created_at, row.last_used_at]
  );
  return { token, row };
}

export async function listExtensionTokens(userId: string) {
  const rows = await query<ExtensionTokenRow>(
    `SELECT id, user_id, token_hash, label, created_at, last_used_at
     FROM extension_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(publicToken);
}

export function publicToken(row: ExtensionTokenRow) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function revokeExtensionToken(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'DELETE FROM extension_tokens WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

export interface ExtensionPerson {
  name: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  location: string | null;
  email: string | null;
}

function str(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/** Normalises a LinkedIn profile or Sales Navigator lead URL, dropping query/hash noise. */
export function normalizeLinkedinUrl(value: unknown): string | null {
  const raw = str(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const profile = url.pathname.match(/^\/in\/([^/]+)/i);
    if (profile) {
      return `https://www.linkedin.com/in/${decodeURIComponent(profile[1]!).toLowerCase()}`;
    }
    const lead = url.pathname.match(/^\/sales\/(lead|people)\/([^/,]+)/i);
    if (lead) return `https://www.linkedin.com/sales/${lead[1]!.toLowerCase()}/${lead[2]}`;
    return null;
  } catch {
    return null;
  }
}

export function parseExtensionPeople(input: unknown): ExtensionPerson[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const people: ExtensionPerson[] = [];
  for (const item of input.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = str(record.name, 160);
    if (!name) continue;
    const linkedinUrl = normalizeLinkedinUrl(record.linkedinUrl);
    const key = linkedinUrl ?? name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({
      name,
      title: str(record.title),
      company: str(record.company, 160),
      linkedinUrl,
      location: str(record.location, 160),
      email: str(record.email, 200)?.toLowerCase() ?? null,
    });
  }
  return people;
}

export function rosterInputsFromExtension(
  people: ExtensionPerson[],
  source: ExtensionSource
): RosterUpsertInput[] {
  return people.map((person) => ({
    name: person.name,
    title: person.title,
    location: person.location,
    linkedin: person.linkedinUrl,
    email: person.email,
    managerKey: null,
    source,
    sourceUrl: person.linkedinUrl,
    confidence: source === 'linkedin_url' ? 'high' : 'medium',
    raw: person,
  }));
}
