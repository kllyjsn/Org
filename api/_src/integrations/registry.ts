import { googleAdapter } from './google.js';
import { microsoftAdapter } from './microsoft.js';
import type { ProviderAdapter } from './types.js';

export type ProviderId = 'google' | 'microsoft';

export const adapters: Record<ProviderId, ProviderAdapter> = {
  google: googleAdapter,
  microsoft: microsoftAdapter,
};

export function adapterFor(provider: string): ProviderAdapter | null {
  return provider === 'google' || provider === 'microsoft'
    ? adapters[provider]
    : null;
}

export function providerStatus(): {
  id: ProviderId;
  label: string;
  configured: boolean;
}[] {
  return Object.values(adapters).map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    configured: adapter.configured(),
  }));
}
