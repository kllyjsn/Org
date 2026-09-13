import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSellerProfile } from './seller-profile.js';

test('seller profiles keep bounded editable company context', () => {
  const profile = sanitizeSellerProfile(
    {
      companyName: ' Stripe ',
      domain: 'STRIPE.COM',
      summary: 'Payments infrastructure',
      products: ['Payments', '', 42, 'Billing'],
      targetCustomers: ['Internet businesses'],
      useCases: ['Accept payments'],
      proofPoints: ['Public customer story'],
      competitors: ['Adyen'],
      positioning: 'Developer-first financial infrastructure',
    },
    'fallback.com'
  );
  assert.equal(profile.companyName, 'Stripe');
  assert.equal(profile.domain, 'stripe.com');
  assert.deepEqual(profile.products, ['Payments', 'Billing']);
  assert.ok(profile.researchedAt);
});

test('seller profiles never preserve unexpected fields', () => {
  const profile = sanitizeSellerProfile({
    companyName: 'Acme',
    domain: 'acme.com',
    privateNotes: 'secret',
  });
  assert.equal('privateNotes' in profile, false);
});
