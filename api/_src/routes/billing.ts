import { bad, type App } from '../http.js';
import { query } from '../db.js';
import { requireAuth, workspaceRoleFor } from '../authz.js';
import { stripePost, verifyStripeSignature } from '../billing.js';
import type { WorkspaceRow } from '../types.js';

export function registerBillingRoutes(app: App): void {
  app.post('/api/billing/checkout', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const workspaceId =
      typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if ((await workspaceRoleFor(user, workspaceId)) !== 'owner') {
      return bad(c, 'only workspace owners can manage billing', 403);
    }
    const workspaces = await query<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const workspace = workspaces[0];
    if (!workspace) return bad(c, 'workspace not found', 404);
    if (workspace.plan === 'pro') return bad(c, 'workspace is already on Pro', 409);

    try {
      const origin = process.env.PUBLIC_APP_URL || 'https://topdown.sh';
      const checkoutParams: Record<string, string> = {
        mode: 'subscription',
        success_url: `${origin}/app?checkout=success`,
        cancel_url: `${origin}/app?checkout=cancelled`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1000',
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': 'TopDown Pro',
        'metadata[workspace_id]': workspaceId,
        'subscription_data[metadata][workspace_id]': workspaceId,
        allow_promotion_codes: 'true',
      };
      if (workspace.stripe_customer_id) {
        checkoutParams.customer = workspace.stripe_customer_id;
      } else {
        checkoutParams.customer_email = user.email;
      }
      const session = await stripePost('/checkout/sessions', checkoutParams);
      if (typeof session.url !== 'string') throw new Error('Stripe returned no checkout URL');
      return c.json({ url: session.url });
    } catch (error) {
      console.error('checkout failed', error);
      return bad(c, 'billing is temporarily unavailable', 502);
    }
  });

  app.post('/api/billing/portal', requireAuth, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const workspaceId =
      typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if ((await workspaceRoleFor(user, workspaceId)) !== 'owner') {
      return bad(c, 'only workspace owners can manage billing', 403);
    }
    const rows = await query<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const customer = rows[0]?.stripe_customer_id;
    if (!customer) return bad(c, 'no billing account found', 404);
    try {
      const origin = process.env.PUBLIC_APP_URL || 'https://topdown.sh';
      const session = await stripePost('/billing_portal/sessions', {
        customer,
        return_url: `${origin}/app`,
      });
      if (typeof session.url !== 'string') throw new Error('Stripe returned no portal URL');
      return c.json({ url: session.url });
    } catch (error) {
      console.error('billing portal failed', error);
      return bad(c, 'billing is temporarily unavailable', 502);
    }
  });

  app.post('/api/billing/webhook', async (c) => {
    const payload = await c.req.text();
    if (!verifyStripeSignature(payload, c.req.header('stripe-signature'))) {
      return c.json({ error: 'invalid signature' }, 400);
    }
    const event = JSON.parse(payload) as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const object = event.data?.object;
    if (!object) return c.json({ received: true });

    if (event.type === 'checkout.session.completed') {
      const metadata = object.metadata as Record<string, string> | undefined;
      const workspaceId = metadata?.workspace_id;
      const customer =
        typeof object.customer === 'string' ? object.customer : null;
      const subscription =
        typeof object.subscription === 'string' ? object.subscription : null;
      if (workspaceId) {
        await query(
          `UPDATE workspaces SET plan = 'pro', stripe_customer_id = $1,
           stripe_subscription_id = $2 WHERE id = $3`,
          [customer, subscription, workspaceId]
        );
      }
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const metadata = object.metadata as Record<string, string> | undefined;
      const workspaceId = metadata?.workspace_id;
      const status = typeof object.status === 'string' ? object.status : '';
      const plan =
        event.type === 'customer.subscription.updated' &&
        (status === 'active' || status === 'trialing')
          ? 'pro'
          : 'free';
      if (workspaceId) {
        await query('UPDATE workspaces SET plan = $1 WHERE id = $2', [
          plan,
          workspaceId,
        ]);
      }
    }
    return c.json({ received: true });
  });
}
