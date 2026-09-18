import type { BuyingRole, Stance } from '../types.js';
import type { TokenExchange, TokenRefresh } from './types.js';

export type CrmProviderId = 'hubspot' | 'salesforce';

export interface CrmAccount {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
}

export interface CrmOpportunity {
  id: string;
  name: string;
  stage: string | null;
  amount: number | null;
  closeDate: string | null;
  url: string | null;
}

export interface CrmContact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  url: string | null;
  /** CRM's own role text (OpportunityContactRole.Role / topdown_buying_role). */
  role: string | null;
}

export interface CrmPushContact {
  crmId: string | null;
  personId: string;
  name: string;
  email: string | null;
  title: string | null;
  role: BuyingRole;
  stance: Stance | null;
  linkedin: string | null;
}

/**
 * The `token` argument across this interface is the decrypted access token —
 * except Salesforce, which also needs its per-org API base: callers pass
 * `accessToken##instanceUrl` and the adapter splits it internally.
 */
export interface CrmAdapter {
  id: CrmProviderId;
  label: string;
  kind: 'crm';
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<TokenExchange>;
  refresh(refreshToken: string): Promise<TokenRefresh>;
  searchAccounts(token: string, q: string): Promise<CrmAccount[]>;
  listOpportunities(token: string, accountId: string): Promise<CrmOpportunity[]>;
  listContacts(
    token: string,
    accountId: string,
    opportunityId?: string
  ): Promise<CrmContact[]>;
  pushContact(
    token: string,
    contact: CrmPushContact,
    ctx: { accountId: string; opportunityId?: string | null }
  ): Promise<{ crmId: string; url: string | null }>;
  ensureSchema(token: string): Promise<void>;
}
