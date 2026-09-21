import type { Context, Next } from 'hono';
import { query } from './db.js';

export interface RateLimitHit {
  count: number;
  resetAt: string;
}

export interface RateLimitStore {
  hit(bucket: string, windowMs: number): Promise<RateLimitHit>;
}

// Postgres-backed fixed window: one row per bucket, reset lazily when the
// window lapses. Survives restarts and is shared across replicas.
const pgStore: RateLimitStore = {
  async hit(bucket, windowMs) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + windowMs);
    const rows = await query<{ count: number; reset_at: string }>(
      `INSERT INTO rate_limits (bucket, count, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= $3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= $3 THEN $2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
      [bucket, resetAt.toISOString(), now.toISOString()]
    );
    // Occasional sweep of expired buckets so the table doesn't grow forever.
    if (Math.random() < 0.02) {
      void query(`DELETE FROM rate_limits WHERE reset_at <= $1`, [
        now.toISOString(),
      ]).catch(() => undefined);
    }
    return { count: rows[0]!.count, resetAt: rows[0]!.reset_at };
  },
};

export function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
  key: (c: Context) => string;
  store?: RateLimitStore;
}) {
  const store = opts.store ?? pgStore;
  return async (c: Context, next: Next) => {
    let hit: RateLimitHit;
    try {
      hit = await store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    } catch {
      // A limiter outage shouldn't take the API down with it.
      await next();
      return;
    }
    c.header('x-ratelimit-limit', String(opts.limit));
    c.header('x-ratelimit-remaining', String(Math.max(0, opts.limit - hit.count)));
    if (hit.count > opts.limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((Date.parse(hit.resetAt) - Date.now()) / 1000)
      );
      c.header('retry-after', String(retryAfter));
      return c.json(
        { error: 'rate limit exceeded — please wait and try again' },
        429
      );
    }
    await next();
  };
}

// Unauthenticated or anonymous endpoints (register, login, invite accept).
export const perIp = (
  name: string,
  limit: number,
  windowMs: number,
  store?: RateLimitStore
) => rateLimit({ name, limit, windowMs, key: clientIp, store });

// Must run after requireAuth/requireExtensionAuth so c.get('user') is set;
// falls back to IP for bearer-authed callers without a session user.
export const perUser = (
  name: string,
  limit: number,
  windowMs: number,
  store?: RateLimitStore
) =>
  rateLimit({
    name,
    limit,
    windowMs,
    key: (c) => c.get('user')?.id ?? clientIp(c),
    store,
  });
