import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword } from './auth.js';
import {
  evaluateShareAccess,
  hashShareToken,
  newShareSecret,
  normalizeAllowedEmails,
  isValidPasscode,
} from './share.js';
import type { ShareAccessLink } from './share.js';

const NOW = '2030-01-01T00:00:00.000Z';

function link(overrides: Partial<ShareAccessLink> = {}): ShareAccessLink {
  return {
    expires_at: null,
    passcode_hash: null,
    allowed_emails: null,
    locked_until: null,
    ...overrides,
  };
}

test('share secrets hash deterministically and differ per secret', () => {
  const a = newShareSecret();
  const b = newShareSecret();
  assert.notEqual(a, b);
  assert.equal(hashShareToken(a), hashShareToken(a));
  assert.notEqual(hashShareToken(a), hashShareToken(b));
  assert.match(hashShareToken(a), /^[0-9a-f]{64}$/);
});

test('normalizeAllowedEmails trims, lowercases, dedupes, and drops junk', () => {
  assert.deepEqual(
    normalizeAllowedEmails([
      '  Ana@Example.COM ',
      'ana@example.com',
      'not-an-email',
      'bob@corp.io',
      42,
      '',
      'a@b',
    ]),
    ['ana@example.com', 'bob@corp.io']
  );
});

test('normalizeAllowedEmails returns null on empty or non-array input', () => {
  assert.equal(normalizeAllowedEmails([]), null);
  assert.equal(normalizeAllowedEmails(['nope', '']), null);
  assert.equal(normalizeAllowedEmails('a@b.co'), null);
  assert.equal(normalizeAllowedEmails(null), null);
  assert.equal(normalizeAllowedEmails(undefined), null);
});

test('isValidPasscode enforces 6–128 characters after trim', () => {
  assert.equal(isValidPasscode('12345'), false);
  assert.equal(isValidPasscode('  12345  '), false);
  assert.equal(isValidPasscode('123456'), true);
  assert.equal(isValidPasscode('x'.repeat(128)), true);
  assert.equal(isValidPasscode('x'.repeat(129)), false);
  assert.equal(isValidPasscode(123456), false);
});

test('evaluateShareAccess: expired beats everything', () => {
  assert.deepEqual(
    evaluateShareAccess(
      link({
        expires_at: '2029-12-31T00:00:00.000Z',
        allowed_emails: ['a@b.co'],
        passcode_hash: 'x',
        locked_until: '2031-01-01T00:00:00.000Z',
      }),
      {},
      NOW
    ),
    { kind: 'expired' }
  );
});

test('evaluateShareAccess: email gate runs before passcode', () => {
  const gated = link({
    allowed_emails: ['invited@corp.io'],
    passcode_hash: hashPassword('secret1'),
  });
  assert.deepEqual(evaluateShareAccess(gated, {}, NOW), {
    kind: 'login_required',
  });
  assert.deepEqual(
    evaluateShareAccess(gated, { userEmail: 'other@corp.io' }, NOW),
    { kind: 'not_allowed' }
  );
  assert.deepEqual(
    evaluateShareAccess(gated, { userEmail: 'Invited@Corp.IO' }, NOW),
    { kind: 'passcode_required' }
  );
});

test('evaluateShareAccess: lock is checked before the passcode itself', () => {
  const locked = link({
    passcode_hash: hashPassword('secret1'),
    locked_until: '2030-01-01T00:15:00.000Z',
  });
  const result = evaluateShareAccess(locked, { passcode: 'secret1' }, NOW);
  assert.equal(result.kind, 'locked');
  if (result.kind === 'locked') {
    assert.equal(result.retryAfterSec, 900);
  }
});

test('evaluateShareAccess: passcode branches and ok', () => {
  const protectedLink = link({ passcode_hash: hashPassword('secret1') });
  assert.deepEqual(evaluateShareAccess(protectedLink, {}, NOW), {
    kind: 'passcode_required',
  });
  assert.deepEqual(
    evaluateShareAccess(protectedLink, { passcode: 'nope!!' }, NOW),
    { kind: 'wrong_passcode' }
  );
  assert.deepEqual(
    evaluateShareAccess(protectedLink, { passcode: 'secret1' }, NOW),
    { kind: 'ok' }
  );
  assert.deepEqual(evaluateShareAccess(link(), {}, NOW), { kind: 'ok' });
});
