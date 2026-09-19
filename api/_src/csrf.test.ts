import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { csrfOriginGuard } from './authz.js';
import { SESSION_COOKIE } from './auth.js';

function makeApp() {
  const app = new Hono();
  app.use('/api/*', csrfOriginGuard);
  app.get('/api/x', (c) => c.json({ ok: true }));
  app.post('/api/x', (c) => c.json({ ok: true }));
  return app;
}

const COOKIE = `${SESSION_COOKIE}=sess_abc`;
const ALLOWED = 'http://localhost:5173';

async function withSecure<T>(value: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prev;
  }
}

test('allowed origin passes for cookie-authed mutations', async () =>
  withSecure('1', async () => {
    const res = await makeApp().request('/api/x', {
      method: 'POST',
      headers: { cookie: COOKIE, origin: ALLOWED },
    });
    assert.equal(res.status, 200);
  }));

test('cookie-authed mutation without an allowlisted origin is rejected', async () =>
  withSecure('1', async () => {
    const app = makeApp();
    const evil = await app.request('/api/x', {
      method: 'POST',
      headers: { cookie: COOKIE, origin: 'https://evil.example' },
    });
    assert.equal(evil.status, 403);
    const missing = await app.request('/api/x', {
      method: 'POST',
      headers: { cookie: COOKIE },
    });
    assert.equal(missing.status, 403);
  }));

test('extension origins are allowed (bearer clients that also hold cookies)', async () =>
  withSecure('1', async () => {
    const res = await makeApp().request('/api/x', {
      method: 'POST',
      headers: {
        cookie: COOKIE,
        origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      },
    });
    assert.equal(res.status, 200);
  }));

test('GET requests and cookie-less mutations are unaffected', async () =>
  withSecure('1', async () => {
    const app = makeApp();
    assert.equal(
      (
        await app.request('/api/x', {
          headers: { cookie: COOKIE, origin: 'https://evil.example' },
        })
      ).status,
      200
    );
    // No session cookie: webhooks, cron, bearer calls.
    assert.equal(
      (
        await app.request('/api/x', {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
        })
      ).status,
      200
    );
    assert.equal(
      (await app.request('/api/x', { method: 'POST' })).status,
      200
    );
  }));

test('guard is a no-op unless COOKIE_SECURE=1', async () =>
  withSecure('0', async () => {
    const res = await makeApp().request('/api/x', {
      method: 'POST',
      headers: { cookie: COOKIE, origin: 'https://evil.example' },
    });
    assert.equal(res.status, 200);
  }));
