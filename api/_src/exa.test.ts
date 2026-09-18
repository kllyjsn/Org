import assert from 'node:assert/strict';
import test from 'node:test';
import { exaCompanyProfile, normalizeCompanyProfile } from './exa.js';

test('normalizes company profile fields and annual revenue', () => {
  const profile = normalizeCompanyProfile(
    {
      headquarters: '181 Fremont Street...',
      annualReportUrl: 'Not publicly available',
      annualRevenue: '$2.00B (2026 annualized gross revenue)',
      funding: 'Series C, $484M - $558.6M total raised',
      engineerCount: 2,
      employeeCount: 9593,
      linkedinUrl: 'https://www.linkedin.com/company/mercor-ai/',
      fiscalYearEndMonth: 0,
      industry: 'Software Development',
    },
    [{ url: 'https://mercor.com/about' }],
    '2026-01-01T00:00:00.000Z'
  );
  assert.equal(profile.annualReportUrl, null);
  assert.equal(profile.engineerCount, null);
  assert.equal(profile.fiscalYearEndMonth, null);
  assert.equal(profile.annualRevenueUsd, 2_000_000_000);
  assert.equal(profile.employeeCount, 9593);
  assert.equal(profile.linkedinUrl, 'https://www.linkedin.com/company/mercor-ai');
  assert.deepEqual(profile.sources, ['https://mercor.com/about']);
  assert.equal(
    normalizeCompanyProfile({ employeeCount: 100, engineerCount: 500 }, [], '').engineerCount,
    null
  );
  assert.equal(
    normalizeCompanyProfile({ employeeCount: 9593, engineerCount: 300 }, [], '').engineerCount,
    300
  );
  assert.equal(
    normalizeCompanyProfile({ description: ' ' }, [], profile.retrievedAt).description,
    null
  );
});

test('exaCompanyProfile returns null for non-OK responses', async () => {
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'test-key';
  try {
    const profile = await exaCompanyProfile('mercor.com', {
      fetchImpl: async () => new Response('failed', { status: 500 }),
    });
    assert.equal(profile, null);
  } finally {
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});

test('exaCompanyProfile returns null without an API key', async () => {
  const previous = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  try {
    const profile = await exaCompanyProfile('mercor.com', {
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    });
    assert.equal(profile, null);
  } finally {
    if (previous !== undefined) process.env.EXA_API_KEY = previous;
  }
});
