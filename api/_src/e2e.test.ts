import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

// Golden-path API coverage against a real Postgres database. Skipped without
// E2E_POSTGRES_URL — CI provides a postgres service; for a local run:
//   E2E_POSTGRES_URL=postgres://postgres:dev@localhost:5432/topdown_e2e npm run test -w api
// (point it at a scratch database — the suite writes real rows).
// With no LLM keys configured the pipeline self-selects the demo 'fixture'
// provider, so research completes with no external calls.

const E2E_DB = process.env.E2E_POSTGRES_URL;
if (E2E_DB) {
  process.env.POSTGRES_URL = E2E_DB;
  // Force the fixture provider even when the surrounding shell exports real
  // LLM keys — research must stay off the network.
  for (const key of [
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'PERPLEXITY_API_KEY',
    'Perplexity_API_KEY',
    'LLM_PROVIDER_PRIORITY',
    'RESEND_API_KEY',
  ]) {
    delete process.env[key];
  }
}

// Without RESEND_API_KEY, sendEmail logs the email text (which contains the
// verify/reset links). Capture those lines and pull tokens out of them — the
// whole flow is exercised through HTTP, no test hooks.
const emailLines: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.includes('[email]')) emailLines.push(line);
  realLog(...args);
};
after(() => {
  console.log = realLog;
});

function emailToken(linkFragment: string): Promise<string> {
  return waitFor(() => {
    const line = emailLines.find((l) => l.includes(linkFragment));
    return line?.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
  }, 'an email containing ' + linkFragment);
}

async function waitFor<T>(
  fn: () => Promise<T | null> | T | null,
  label: string,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

type App = typeof import('./index.js').default;
let app: App;
let cookie = '';

async function api(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {}
) {
  const res = await app.fetch(
    new Request(`http://e2e.test${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(opts.cookie ? { cookie: `org_session=${opts.cookie}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  );
  const setCookie = res.headers.getSetCookie().find((h) => h.startsWith('org_session='));
  return {
    res,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: () => res.json() as Promise<any>,
    sessionCookie: setCookie?.split(';')[0].split('=').slice(1).join('='),
  };
}

test('golden path: register → verify → research → map → share → export → reset', { skip: !E2E_DB }, async () => {
  // Dynamic import so POSTGRES_URL above is in place before the pool is built.
  ({ default: app } = await import('./index.js'));

  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'e2e-password-1234';

  // register → session cookie + workspace
  const reg = await api('/api/auth/register', {
    body: { email, password, name: 'E2E Tester', workspaceName: 'E2E WS' },
  });
  assert.equal(reg.res.status, 200, await reg.res.clone().text());
  cookie = reg.sessionCookie!;
  assert.ok(cookie);
  const regBody = await reg.json();
  const workspaceId = regBody.workspaces[0].id as string;
  assert.equal(regBody.user.emailVerified, false);

  // unauthenticated requests are rejected
  const unauth = await api('/api/maps?workspaceId=' + workspaceId);
  assert.equal(unauth.res.status, 401);

  // email verify link (captured from the would-send log) → confirm
  const verifyToken = await emailToken('/verify-email?token=');
  const verify = await api('/api/auth/verify/confirm', { body: { token: verifyToken } });
  assert.equal(verify.res.status, 200);
  const me = await api('/api/me', { cookie });
  assert.equal((await me.json()).user.emailVerified, true);

  // research with the fixture provider → poll the job to done
  const research = await api('/api/research', { cookie, body: { domain: 'acme.test' } });
  assert.equal(research.res.status, 202, await research.res.clone().text());
  const jobId = (await research.json()).jobId as string;
  const job = await waitFor(async () => {
    const j = await api(`/api/research/jobs/${jobId}`, { cookie });
    const body = await j.json();
    if (body.job.status === 'failed') throw new Error(`job failed: ${body.job.error}`);
    return body.job.status === 'done' ? body.job : null;
  }, 'research job to finish');
  assert.equal(job.result.provider, 'fixture');
  assert.ok(job.result.people.length >= 5, 'fixture yields people');

  // map creation mirrors the client's stateFromResearch shape
  const state = {
    people: job.result.people.map(
      (p: { name: string; title: string; department: string | null }, i: number) => ({
        id: randomUUID(),
        name: p.name,
        title: p.title,
        department: p.department,
        role: 'none',
        confidence: 'low',
        sources: [],
        notes: '',
        email: null,
        linkedin: null,
        x: (i % 3) * 300,
        y: Math.floor(i / 3) * 180,
      })
    ),
    edges: [],
    meta: {
      domain: job.result.domain,
      companyName: job.result.companyName,
      researchedAt: new Date().toISOString(),
      tier: 'T0',
      provider: 'fixture',
      initiatives: [],
    },
  };
  const map = await api('/api/maps', {
    cookie,
    body: { workspaceId, name: 'Acme', domain: 'acme.test', state },
  });
  assert.equal(map.res.status, 200, await map.res.clone().text());
  const mapId = (await map.json()).id as string;

  const fetched = await api(`/api/maps/${mapId}`, { cookie });
  const fetchedBody = await fetched.json();
  assert.equal(fetchedBody.map.state.people.length, state.people.length);

  // share link → public unauthenticated view
  const share = await api(`/api/maps/${mapId}/share`, { cookie, body: {} });
  assert.equal(share.res.status, 200);
  const token = (await share.json()).token as string;
  const shared = await api(`/api/share/${token}`); // no cookie
  assert.equal(shared.res.status, 200);
  assert.equal((await shared.json()).map.name, 'Acme');
  assert.equal((await api('/api/share/no-such-token')).res.status, 404);

  // workbook export
  const xlsx = await api(`/api/maps/${mapId}/export.xlsx`, { cookie });
  assert.equal(xlsx.res.status, 200);
  assert.match(xlsx.res.headers.get('content-type') ?? '', /spreadsheet|octet-stream/);
  assert.ok((await xlsx.res.arrayBuffer()).byteLength > 1_000);

  // forgot → reset kills every session, new password logs back in
  const forgot = await api('/api/auth/forgot-password', { body: { email } });
  assert.equal(forgot.res.status, 200);
  const resetToken = await emailToken('/reset-password?token=');
  const reset = await api('/api/auth/reset-password', {
    body: { token: resetToken, password: 'e2e-new-password-5678' },
  });
  assert.equal(reset.res.status, 200);
  assert.equal((await api('/api/me', { cookie })).res.status, 401);
  const login = await api('/api/auth/login', {
    body: { email, password: 'e2e-new-password-5678' },
  });
  assert.equal(login.res.status, 200);
  cookie = login.sessionCookie!;
  assert.ok(cookie);
});
