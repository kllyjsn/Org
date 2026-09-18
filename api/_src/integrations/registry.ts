import { googleAdapter } from './google.js';
import { microsoftAdapter } from './microsoft.js';
import { hubspotAdapter } from './hubspot.js';
import { salesforceAdapter } from './salesforce.js';
import type { ProviderAdapter } from './types.js';
import type { CrmAdapter } from './crm-types.js';

export type ProviderId = 'google' | 'microsoft' | 'hubspot' | 'salesforce';

export const adapters: Record<ProviderId, ProviderAdapter | CrmAdapter> = {
  google: googleAdapter,
  microsoft: microsoftAdapter,
  hubspot: hubspotAdapter,
  salesforce: salesforceAdapter,
};

export function adapterFor(provider: string): ProviderAdapter | null {
  const adapter = adapters[provider as ProviderId];
  return adapter && adapter.kind !== 'crm' ? (adapter as ProviderAdapter) : null;
}

export function crmAdapterFor(provider: string): CrmAdapter | null {
  const adapter = adapters[provider as ProviderId];
  return adapter && adapter.kind === 'crm' ? (adapter as CrmAdapter) : null;
}

/** Any OAuth adapter — calendar or CRM — for shared connect/callback routes. */
export function oauthAdapterFor(
  provider: string
): ProviderAdapter | CrmAdapter | null {
  return adapters[provider as ProviderId] ?? null;
}

export function providerStatus(): {
  id: ProviderId;
  label: string;
  kind: 'calendar' | 'crm';
  configured: boolean;
}[] {
  return (Object.values(adapters) as (ProviderAdapter | CrmAdapter)[]).map(
    (adapter) => ({
      id: adapter.id as ProviderId,
      label: adapter.label,
      kind: adapter.kind === 'crm' ? 'crm' : 'calendar',
      configured: adapter.configured(),
    })
  );
}
