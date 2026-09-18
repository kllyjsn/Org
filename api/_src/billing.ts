import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

export async function stripePost(
  path: string,
  values: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${stripeKey()}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message || `Stripe request failed (${response.status})`);
  }
  return payload;
}

export function verifyStripeSignature(
  payload: string,
  signature: string | undefined
): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const actualBuffer = Buffer.from(expected);
  const digestBuffer = Buffer.from(digest);
  return (
    actualBuffer.length === digestBuffer.length &&
    timingSafeEqual(actualBuffer, digestBuffer)
  );
}
