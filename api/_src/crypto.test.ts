import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptSecret,
  encryptSecret,
  signPayload,
  signatureMatches,
} from './crypto.js';

process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.from('k'.repeat(32)).toString(
  'base64'
);

test('encryptSecret/decryptSecret roundtrip', () => {
  const cipher = encryptSecret('ya29.secret-token');
  assert.notEqual(cipher, 'ya29.secret-token');
  assert.equal(decryptSecret(cipher), 'ya29.secret-token');
});

test('tampered ciphertext fails authentication', () => {
  const cipher = encryptSecret('token');
  const raw = Buffer.from(cipher, 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptSecret(raw.toString('base64')));
});

test('state signature verifies and rejects tampering', () => {
  const payload = '{"ws":"w1","uid":"u1","provider":"google"}';
  const sig = signPayload(payload);
  assert.ok(signatureMatches(payload, sig));
  assert.ok(!signatureMatches(payload + 'x', sig));
  assert.ok(!signatureMatches(payload, sig + 'x'));
});
