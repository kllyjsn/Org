import assert from 'node:assert/strict';
import test from 'node:test';
import { sumbleAllPeople } from './sumble.js';

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
    const result = await sumbleAllPeople('org', 'key', {
      max: 2000,
      deadlineMs: Date.now() + 20_000,
      onProgress: (n) => progress.push(n),
    });
    assert.equal(result.people.length, 450);
    assert.equal(result.total, 450);
    assert.deepEqual(calls.map((init) => (JSON.parse(String(init.body)) as { offset?: number }).offset), [0, 200, 400]);
    assert.deepEqual(progress, [200, 400, 450]);
  } finally { globalThis.fetch = original; }
});

test('sumble surfaces credit errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'not enough credits' }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => sumbleAllPeople('org', 'key', {
        deadlineMs: Date.now() + 5000,
        onProgress: () => undefined,
      }),
      /not enough credits/
    );
  }
  finally { globalThis.fetch = original; }
});
