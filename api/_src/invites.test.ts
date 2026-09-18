import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateInvite,
  hashInviteToken,
  isValidEmail,
  newInviteSecret,
  normalizeEmail,
} from './invites.js';

const NOW = '2026-01-01T00:00:00.000Z';
const FRESH = {
  email: 'teammate@company.com',
  expires_at: '2026-01-08T00:00:00.000Z',
  accepted_at: null,
};

test('fresh invite evaluates ok', () => {
  assert.deepEqual(evaluateInvite(FRESH, { nowIso: NOW }), { ok: true });
});

test('expired invite is rejected', () => {
  assert.deepEqual(
    evaluateInvite(
      { ...FRESH, expires_at: '2025-12-31T23:59:59.000Z' },
      { nowIso: NOW }
    ),
    { ok: false, reason: 'expired' }
  );
});

test('accepted invite is rejected', () => {
  assert.deepEqual(
    evaluateInvite({ ...FRESH, accepted_at: NOW }, { nowIso: NOW }),
    { ok: false, reason: 'accepted' }
  );
});

test('session email mismatch is rejected', () => {
  assert.deepEqual(
    evaluateInvite(FRESH, { nowIso: NOW, sessionEmail: 'other@company.com' }),
    { ok: false, reason: 'email_mismatch' }
  );
});

test('session email match is case-insensitive', () => {
  assert.deepEqual(
    evaluateInvite(FRESH, { nowIso: NOW, sessionEmail: 'Teammate@Company.com' }),
    { ok: true }
  );
});

test('invite token hashing is deterministic and differs from the secret', () => {
  const secret = newInviteSecret();
  assert.equal(hashInviteToken(secret), hashInviteToken(secret));
  assert.notEqual(hashInviteToken(secret), secret);
  assert.notEqual(hashInviteToken(secret), hashInviteToken(newInviteSecret()));
});

test('normalizeEmail trims and lowercases; isValidEmail gates input', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normalizeEmail(null), '');
  assert.ok(isValidEmail('a@b.co'));
  assert.ok(!isValidEmail('nope'));
});
