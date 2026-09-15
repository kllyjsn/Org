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

test('seller profiles remove bare grounding markers', () => {
  const profile = sanitizeSellerProfile({
    companyName: 'Stripe [1]',
    summary: 'Payments infrastructure [2, 4] for internet businesses.',
    products: ['Billing [8]', 'Payments'],
    positioning: 'Unified financial infrastructure [12].',
  });

  assert.equal(profile.companyName, 'Stripe');
  assert.equal(profile.summary, 'Payments infrastructure for internet businesses.');
  assert.deepEqual(profile.products, ['Billing', 'Payments']);
  assert.equal(profile.positioning, 'Unified financial infrastructure.');
});
