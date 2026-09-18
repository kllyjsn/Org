import assert from 'node:assert/strict';
import test from 'node:test';
import { sumbleAllPeople } from './sumble.js';
import { rosterProviders } from './roster-providers.js';

test('sumble paginates all people and reports progress', async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    calls.push(init ?? {});
    const body = JSON.parse(String(init?.body)) as { offset?: number };
    const count = body.offset === 400 ? 50 : 200;
    return new Response(JSON.stringify({ status: 'succeeded', people: Array.from({ length: count }, (_, i) => ({ name: `Person ${i + (body.offset ?? 0)}` })), total: 450 }), { status: 200 });
  }) as typeof fetch;
  try {
    const progress: number[] = [];
    const people = await sumbleAllPeople('org', 'key', { max: 2000, deadlineMs: Date.now() + 20_000, onProgress: (n) => progress.push(n) });
    assert.equal(people.length, 450);
    assert.deepEqual(calls.map((init) => (JSON.parse(String(init.body)) as { offset?: number }).offset), [0, 200, 400]);
    assert.deepEqual(progress, [200, 400, 450]);
  } finally { globalThis.fetch = original; }
});

test('sumble surfaces credit errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'not enough credits' }), { status: 200 })) as typeof fetch;
  try { await assert.rejects(() => sumbleAllPeople('org', 'key', { deadlineMs: Date.now() + 5000, onProgress: () => undefined }), /not enough credits/); }
  finally { globalThis.fetch = original; }
});

test('crustdata follows cursor pages and uses bearer authentication', async () => {
  const original = globalThis.fetch;
  const previous = process.env.CRUSTDATA_API_KEY;
  process.env.CRUSTDATA_API_KEY = 'secret';
  const seen: Record<string, string>[] = [];
  globalThis.fetch = (async (_input, init) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    const cursor = (JSON.parse(String(init?.body)) as { cursor?: string }).cursor;
    return new Response(JSON.stringify({ profiles: [{ basic_profile: { name: cursor ? 'B' : 'A' }, experience: { employment_details: { current: { title: 'Engineer' } } } }], next_cursor: cursor ? null : 'next' }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = rosterProviders()[1];
    const rows = await provider.fetch('acme.com', { max: 2000, deadlineMs: Date.now() + 10_000, onProgress: () => undefined });
    assert.equal(rows.length, 2);
    assert.equal(seen[0].Authorization, 'Bearer secret');
  } finally { globalThis.fetch = original; if (previous === undefined) delete process.env.CRUSTDATA_API_KEY; else process.env.CRUSTDATA_API_KEY = previous; }
});
