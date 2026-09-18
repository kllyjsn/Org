import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM for integration tokens at rest. The key comes from
 * INTEGRATION_ENCRYPTION_KEY (base64-encoded 32 bytes) — plaintext tokens are
 * never written without it.
 */

export function encryptionKeyConfigured(): boolean {
  return Boolean(process.env.INTEGRATION_ENCRYPTION_KEY);
}

function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is not set (generate with `openssl rand -base64 32`)'
    );
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return decoded;
}

/** Returns base64 of iv|tag|ciphertext. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 12 + 16 + 1) {
    throw new Error('invalid ciphertext');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8'
  );
}

/** HMAC of an arbitrary payload with the encryption key (used for OAuth state). */
export function signPayload(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}

export function signatureMatches(payload: string, signature: string): boolean {
  const expected = signPayload(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
