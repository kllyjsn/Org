import type { BuyingRole } from '../types.js';
import { IntegrationError, providerFetch } from './types.js';
import type { TokenExchange, TokenRefresh } from './types.js';
import type {
  CrmAccount,
  CrmAdapter,
  CrmContact,
  CrmOpportunity,
  CrmSession,
} from './crm-types.js';

const CLIENT_ID = () => process.env.SALESFORCE_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.SALESFORCE_CLIENT_SECRET ?? '';
const LOGIN = 'https://login.salesforce.com/services/oauth2';
const API_VER = 'v59.0';
const SCOPES = 'api refresh_token';

export function soqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Salesforce picklist text ↔ BuyingRole. Exported for tests. */
export function contactRoleFor(role: BuyingRole, picklist: string[]): string | null {
  const candidates: Partial<Record<BuyingRole, string[]>> = {
    champion: ['Champion', 'Influencer'],
    economic_buyer: ['Economic Buyer', 'Economic Decision Maker', 'Decision Maker'],
    decision_maker: ['Decision Maker'],
    technical_buyer: ['Technical Buyer'],
    influencer: ['Influencer'],
    blocker: ['Other'],
    none: [],
  };
  for (const candidate of candidates[role] ?? []) {
    if (picklist.length === 0 || picklist.includes(candidate)) return candidate;
  }
  // picklist present but no candidate → fall back to the last candidate if any
  const fallback = (candidates[role] ?? []).filter((c) => picklist.includes(c));
  return fallback[0] ?? null;
}

function sfHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

/** Token arrives as `accessToken##instanceUrl` (see crm-types.ts). */
function clientFor(session: CrmSession): SalesforceClient {
  return new SalesforceClient(session.accessToken, session.instanceUrl ?? '');
}

export class SalesforceClient {
  constructor(
    private readonly token: string,
    private readonly instanceUrl: string
  ) {}

  private url(path: string): string {
    return `${this.instanceUrl}/services/data/${API_VER}${path}`;
  }

  async query<T>(soql: string): Promise<T[]> {
    const res = await providerFetch(
      `${this.url('/query')}?q=${encodeURIComponent(soql)}`,
      { headers: sfHeaders(this.token) }
    );
    const data = (await res.json()) as { records?: T[] };
    return data.records ?? [];
  }

  async describeField(
    sobject: string,
    field: string
  ): Promise<{ exists: boolean; picklistValues?: string[] }> {
    const res = await providerFetch(
      `${this.url(`/sobjects/${sobject}/describe`)}`,
      { headers: sfHeaders(this.token) }
    );
    const data = (await res.json()) as {
      fields?: { name?: string; picklistValues?: { value?: string; active?: boolean }[] }[];
    };
    const found = (data.fields ?? []).find((f) => f.name === field);
    if (!found) return { exists: false };
    return {
      exists: true,
      picklistValues: (found.picklistValues ?? [])
        .filter((v) => v.active !== false)
        .map((v) => v.value ?? '')
        .filter(Boolean),
    };
  }

  async patch(sobject: string, id: string, fields: Record<string, unknown>): Promise<void> {
    await providerFetch(this.url(`/sobjects/${sobject}/${id}`), {
      method: 'PATCH',
      headers: sfHeaders(this.token),
      body: JSON.stringify(fields),
    });
  }

  async create(sobject: string, fields: Record<string, unknown>): Promise<string> {
    const res = await providerFetch(this.url(`/sobjects/${sobject}`), {
      method: 'POST',
      headers: sfHeaders(this.token),
      body: JSON.stringify(fields),
    });
    const data = (await res.json()) as { id?: string; success?: boolean; errors?: unknown[] };
    if (!data.id) throw new IntegrationError(500, 'create failed');
    return data.id;
  }

  recordUrl(id: string): string {
    return `${this.instanceUrl}/${id}`;
  }
}

export const salesforceAdapter: CrmAdapter = {
  id: 'salesforce',
  label: 'Salesforce',
  kind: 'crm',

  configured: () => Boolean(CLIENT_ID() && CLIENT_SECRET()),

  authUrl(state, redirectUri) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID(),
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
    });
    return `${LOGIN}/authorize?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchange> {
    const res = await providerFetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      instance_url?: string;
      scope?: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: null,
      scopes: data.scope ?? null,
      accountEmail: null,
      instanceUrl: data.instance_url ?? null,
    };
  },

  async refresh(refreshToken): Promise<TokenRefresh> {
    const res = await providerFetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        refresh_token: refreshToken,
      }).toString(),
    });
    const data = (await res.json()) as {
      access_token: string;
      instance_url?: string;
    };
    return {
      accessToken: data.access_token,
      expiresAt: null,
      instanceUrl: data.instance_url ?? null,
    };
  },

  async searchAccounts(session: CrmSession, q): Promise<CrmAccount[]> {
    const client = clientFor(session);
    const like = `%${soqlEscape(q)}%`;
    const rows = await client.query<{
      Id: string;
      Name: string;
      Website?: string | null;
    }>(
      `SELECT Id, Name, Website FROM Account WHERE Website LIKE '${like}' OR Name LIKE '${like}' LIMIT 10`
    );
    return rows.map((row) => ({
      id: row.Id,
      name: row.Name,
      domain: row.Website ?? null,
      url: row.Website ?? null,
    }));
  },

  async listOpportunities(
    session: CrmSession,
    accountId: string
  ): Promise<CrmOpportunity[]> {
    const client = clientFor(session);
    const rows = await client.query<{
      Id: string;
      Name: string;
      StageName?: string | null;
      Amount?: number | null;
      CloseDate?: string | null;
      IsClosed?: boolean;
    }>(
      `SELECT Id, Name, StageName, Amount, CloseDate, IsClosed FROM Opportunity WHERE AccountId = '${soqlEscape(accountId)}' ORDER BY IsClosed, CloseDate LIMIT 20`
    );
    return rows.map((row) => ({
      id: row.Id,
      name: row.Name,
      stage: row.StageName ?? null,
      amount: row.Amount ?? null,
      closeDate: row.CloseDate ?? null,
      url: null,
    }));
  },

  async listContacts(
    session: CrmSession,
    accountId: string,
    opportunityId?: string
  ): Promise<CrmContact[]> {
    const client = clientFor(session);
    const contacts = await client.query<{
      Id: string;
      Name: string;
      Title?: string | null;
      Email?: string | null;
    }>(
      `SELECT Id, Name, Title, Email FROM Contact WHERE AccountId = '${soqlEscape(accountId)}' LIMIT 200`
    );
    const roles = new Map<string, string>();
    if (opportunityId) {
      const rows = await client.query<{
        ContactId: string;
        Role?: string | null;
        IsPrimary?: boolean;
      }>(
        `SELECT ContactId, Role, IsPrimary FROM OpportunityContactRole WHERE OpportunityId = '${soqlEscape(opportunityId)}'`
      ).catch(() => [] as { ContactId: string; Role?: string | null }[]);
      for (const row of rows) {
        if (row.Role && !roles.has(row.ContactId)) roles.set(row.ContactId, row.Role);
      }
    }
    return contacts.map((row) => ({
      id: row.Id,
      name: row.Name,
      title: row.Title ?? null,
      email: row.Email ?? null,
      linkedin: null,
      url: client.recordUrl(row.Id),
      role: roles.get(row.Id) ?? null,
    }));
  },

  async ensureSchema() {
    // Custom fields are provisioned in the org (Metadata API / Setup), not
    // here — pushContact discovers them via describe before writing.
    return;
  },

  async pushContact(session: CrmSession, contact, ctx) {
    const client = clientFor(session);
    const custom = await Promise.all([
      client.describeField('Contact', 'TopDown_Buying_Role__c'),
      client.describeField('Contact', 'TopDown_Stance__c'),
    ]).catch(() => [{ exists: false }, { exists: false }] as const);

    const fields: Record<string, unknown> = {};
    if (contact.title) fields.Title = contact.title;
    if (custom[0].exists) fields.TopDown_Buying_Role__c = contact.role;
    if (contact.stance && custom[1].exists) fields.TopDown_Stance__c = contact.stance;

    let crmId = contact.crmId;
    if (crmId) {
      if (Object.keys(fields).length > 0) {
        await client.patch('Contact', crmId, fields);
      }
    } else {
      crmId = await client.create('Contact', {
        Name: contact.name,
        ...(contact.email ? { Email: contact.email } : {}),
        ...(ctx.accountId ? { AccountId: ctx.accountId } : {}),
        ...fields,
      });
    }

    if (ctx.opportunityId) {
      const ocr = await client.describeField('OpportunityContactRole', 'Role').catch(
        () => ({ exists: true, picklistValues: [] as string[] })
      );
      const role = contactRoleFor(contact.role, ocr.picklistValues ?? []);
      if (role) {
        const existing = await client.query<{ Id: string }>(
          `SELECT Id FROM OpportunityContactRole WHERE OpportunityId = '${soqlEscape(ctx.opportunityId)}' AND ContactId = '${soqlEscape(crmId)}' LIMIT 1`
        ).catch(() => [] as { Id: string }[]);
        if (existing[0]) {
          await client.patch('OpportunityContactRole', existing[0].Id, { Role: role });
        } else {
          await client
            .create('OpportunityContactRole', {
              OpportunityId: ctx.opportunityId,
              ContactId: crmId,
              Role: role,
            })
            .catch(() => undefined);
        }
      }
    }
    return { crmId, url: client.recordUrl(crmId) };
  },
};
