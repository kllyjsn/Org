import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  clientIp,
  perIp,
  perUser,
  type RateLimitStore,
} from './rate-limit.js';
import type { UserRow } from './types.js';

function memoryStore(): { store: RateLimitStore; buckets: Map<string, { count: number; resetAt: number }> } {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    buckets,
    store: {
      async hit(bucket: string, windowMs: number) {
        const nowMs = Date.now();
        const existing = buckets.get(bucket);
        if (!existing || existing.resetAt <= nowMs) {
          const entry = { count: 1, resetAt: nowMs + windowMs };
          buckets.set(bucket, entry);
          return { count: entry.count, resetAt: new Date(entry.resetAt).toISOString() };
        }
        existing.count += 1;
        return { count: existing.count, resetAt: new Date(existing.resetAt).toISOString() };
      },
    },
  };
}

function makeApp(middleware: (c: Context, next: () => Promise<void>) => Promise<Response | void>) {
  const app = new Hono();
  app.post('/x', middleware, (c) => c.json({ ok: true }));
  return app;
}

const USER: UserRow = {
  id: 'u1',
  email: 'ada@acme.com',
  name: 'Ada',
  password_hash: 'x',
  created_at: '2026-01-01T00:00:00.000Z',
};

test('clientIp prefers cf-connecting-ip, then first x-forwarded-for hop', () => {
  const app = new Hono();
  app.get('/ip', (c) => c.text(clientIp(c)));
  return (async () => {
    assert.equal(
      await (await app.request('/ip', { headers: { 'cf-connecting-ip': '1.2.3.4' } })).text(),
      '1.2.3.4'
    );
    assert.equal(
      await (
        await app.request('/ip', { headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' } })
      ).text(),
      '5.6.7.8'
    );
    assert.equal(await (await app.request('/ip')).text(), 'unknown');
  })();
});

test('perIp blocks past the limit with 429, retry-after and rate headers', async () => {
  const { store } = memoryStore();
  const app = makeApp(perIp('t', 3, 60_000, store));
  const headers = { 'cf-connecting-ip': '10.0.0.1' };

  for (const expectedRemaining of [2, 1, 0]) {
    const res = await app.request('/x', { method: 'POST', headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ratelimit-limit'), '3');
    assert.equal(res.headers.get('x-ratelimit-remaining'), String(expectedRemaining));
  }

  const res = await app.request('/x', { method: 'POST', headers });
  assert.equal(res.status, 429);
  assert.match((await res.json() as { error: string }).error, /rate limit/i);
  assert.equal(res.headers.get('x-ratelimit-remaining'), '0');
  const retryAfter = Number(res.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `retry-after ${retryAfter}`);

  // A different IP is a different bucket.
  const other = await app.request('/x', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '10.0.0.2' },
  });
  assert.equal(other.status, 200);
});

test('perUser keys on the authed user when present', async () => {
  const { store, buckets } = memoryStore();
  const app = new Hono<{ Variables: { user: UserRow } }>();
  app.use('/x', async (c, next) => {
    if (c.req.header('x-user')) c.set('user', USER);
    await next();
  });
  app.post('/x', perUser('t', 1, 60_000, store), (c) => c.json({ ok: true }));

  assert.equal((await app.request('/x', { method: 'POST', headers: { 'x-user': '1' } })).status, 200);
  assert.equal((await app.request('/x', { method: 'POST', headers: { 'x-user': '1' } })).status, 429);
  // Bucket is keyed by user id, not the spoofable client IP.
  assert.ok([...buckets.keys()].every((k) => k.startsWith('t:u1')));
});

test('the store window resets after expiry', async () => {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const store: RateLimitStore = {
    async hit(bucket: string, windowMs: number) {
      const nowMs = Date.now();
      const existing = buckets.get(bucket);
      if (!existing || existing.resetAt <= nowMs) {
        buckets.set(bucket, { count: 1, resetAt: nowMs + windowMs });
        return { count: 1, resetAt: new Date(nowMs + windowMs).toISOString() };
      }
      existing.count += 1;
      return { count: existing.count, resetAt: new Date(existing.resetAt).toISOString() };
    },
  };
  const app = makeApp(perIp('t', 1, 0, store)); // zero-length window: always fresh
  assert.equal((await app.request('/x', { method: 'POST' })).status, 200);
  assert.equal((await app.request('/x', { method: 'POST' })).status, 200);
});

test('a failing store fails open', async () => {
  const app = makeApp(
    perIp('t', 1, 60_000, {
      async hit() {
        throw new Error('db down');
      },
    })
  );
  assert.equal((await app.request('/x', { method: 'POST' })).status, 200);
});
