import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialCheckpoint,
  nextStep,
  partialResult,
  runStep,
  runToCompletion,
  type PipelineDeps,
} from './research-pipeline.js';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? 'pipeline-test';

const person = (name: string, title = 'Director of Engineering') => ({
  name,
  title,
  department: 'Engineering',
  team: 'Platform',
  sources: ['https://example.com/team'],
  confidence: 'high',
});

function deps(overrides: Partial<PipelineDeps> = {}): Partial<PipelineDeps> {
  return {
    exaPeopleContext: async () => '',
    sumbleOrgPeople: async () => null,
    resolveSourceUrls: async () => undefined,
    verifyTitleClaims: async () => undefined,
    deadSourceUrls: async () => new Set<string>(),
    chat: async (messages) => {
      const prompt = messages.at(-1)?.content ?? '';
      if (prompt.toLowerCase().includes('initiative')) {
        return {
          content: JSON.stringify({
            initiatives: [
              {
                name: 'Platform modernization',
                summary: 'Modernize the platform',
                category: 'technology',
                evidence: ['https://example.com/roadmap'],
                relevantPeople: ['Ada Lovelace'],
                relevantTeams: ['Platform'],
                salesAngles: ['Modernization'],
              },
            ],
          }),
          provider: 'gemini',
          model: 'test',
          webSearch: true,
        };
      }
      return {
        content: JSON.stringify({
          companyName: 'Example',
          people: [person('Ada Lovelace'), person('Bob Stone', 'VP Engineering')],
        }),
        provider: 'gemini',
        model: 'test',
        webSearch: true,
      };
    },
    ...overrides,
  };
}

test('pipeline completes, normalizes people, and emits each pass', async () => {
  const events: { message: string }[] = [];
  const checkpoint = await runToCompletion(
    initialCheckpoint({ domain: 'example.com' }),
    {
      deadlineMs: Date.now() + 30_000,
      deps: deps(),
      emit: (event) => events.push(event),
    }
  );
  const result = partialResult(checkpoint);
  assert.equal(checkpoint.step, 'done');
  assert.equal(result.complete, true);
  assert.equal(result.people.length, 2);
  assert.equal(events.filter((event) => event.message.includes('pass:')).length, 5);
});

test('checkpoint can be serialized and resumed', async () => {
  const first = await runStep(initialCheckpoint({ domain: 'example.com' }), {
    deadlineMs: Date.now() + 30_000,
    deps: deps(),
    emit: () => undefined,
  });
  const resumed = await runToCompletion(JSON.parse(JSON.stringify(first)), {
    deadlineMs: Date.now() + 30_000,
    deps: deps(),
  });
  assert.equal(partialResult(resumed).people.length, 2);
});

test('expired deadline returns an incomplete checkpoint without throwing', async () => {
  const first = await runStep(initialCheckpoint({ domain: 'example.com' }), {
    deadlineMs: Date.now() + 30_000,
    deps: deps(),
    emit: () => undefined,
  });
  const resumed = await runToCompletion(first, {
    deadlineMs: Date.now(),
    deps: deps(),
  });
  assert.notEqual(resumed.step, 'done');
  assert.equal(partialResult(resumed).complete, false);
});

test('all company research passes failing rejects with the settled error', async () => {
  await assert.rejects(
    () =>
      runToCompletion(initialCheckpoint({ domain: 'example.com' }), {
        deadlineMs: Date.now() + 30_000,
        deps: deps({
          chat: async () => {
            throw new Error('timeout');
          },
        }),
      }),
    { message: 'All company research passes failed' }
  );
});

test('focused research skips sumble, initiatives, and follow-up', async () => {
  const calls: string[] = [];
  const focusedDeps = deps({
    exaPeopleContext: async () => {
      calls.push('discover');
      return '';
    },
    sumbleOrgPeople: async () => {
      calls.push('sumble');
      return null;
    },
    chat: async (messages, options) => {
      calls.push(options?.json ? 'initiatives' : 'pass');
      return {
        content: JSON.stringify({ people: [person('Ada Lovelace')] }),
        provider: 'gemini',
        model: 'test',
        webSearch: true,
      };
    },
  });
  const checkpoint = initialCheckpoint({
    domain: 'example.com',
    focus: 'security',
  });
  assert.equal(nextStep({ ...checkpoint, step: 'discover' }), 'passes');
  const result = await runToCompletion(checkpoint, {
    deadlineMs: Date.now() + 30_000,
    deps: focusedDeps,
  });
  assert.equal(result.step, 'done');
  assert.deepEqual(calls, ['discover', 'pass']);
});
