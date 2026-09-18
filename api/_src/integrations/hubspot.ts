import type { BuyingRole } from '../types.js';
import { providerFetch } from './types.js';
import type { TokenExchange, TokenRefresh } from './types.js';
import type {
  CrmAccount,
  CrmAdapter,
  CrmContact,
  CrmOpportunity,
} from './crm-types.js';

const CLIENT_ID = () => process.env.HUBSPOT_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.HUBSPOT_CLIENT_SECRET ?? '';
const AUTH = 'https://app.hubspot.com/oauth/authorize';
const TOKEN = 'https://api.hubapi.com/oauth/v1/token';
const API = 'https://api.hubapi.com';
const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.schemas.contacts.write',
  'oauth',
].join(' ');

const CONTACT_PROPS =
  'firstname,lastname,jobtitle,email,hs_linkedin_url,linkedin,topdown_buying_role,topdown_stance';
const DEAL_PROPS = 'dealname,dealstage,amount,closedate,pipeline';

async function portalId(token: string): Promise<string | null> {
  const res = await providerFetch(
    `${API}/oauth/v1/access-tokens/${token}`
  );
  const data = (await res.json()) as { hub_id?: number };
  return data.hub_id ? String(data.hub_id) : null;
}

function contactUrl(portal: string | null, id: string): string | null {
  return portal
    ? `https://app.hubspot.com/contacts/${portal}/record/0-1/${id}`
    : null;
}

interface HubSpotObject {
  id: string;
  properties?: Record<string, string | null>;
}

async function batchRead(
  token: string,
  object: 'contacts' | 'deals',
  ids: string[],
  properties: string
): Promise<HubSpotObject[]> {
  if (ids.length === 0) return [];
  const res = await providerFetch(
    `${API}/crm/v3/objects/${object}/batch/read`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        properties: properties.split(','),
        inputs: ids.map((id) => ({ id })),
      }),
    }
  );
  const data = (await res.json()) as { results?: HubSpotObject[] };
  return data.results ?? [];
}

async function associatedIds(
  token: string,
  from: string,
  fromId: string,
  to: string
): Promise<string[]> {
  const res = await providerFetch(
    `${API}/crm/v3/objects/${from}/${fromId}/associations/${to}?limit=200`
  );
  const data = (await res.json()) as {
    results?: { id: string }[];
    paging?: { next?: { after?: string } };
  };
  return (data.results ?? []).map((row) => row.id);
}

export const hubspotAdapter: CrmAdapter = {
  id: 'hubspot',
  label: 'HubSpot',
  kind: 'crm',

  configured: () => Boolean(CLIENT_ID() && CLIENT_SECRET()),

  authUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID(),
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
    });
    return `${AUTH}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchange> {
    const res = await providerFetch(TOKEN, {
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
      expires_in?: number;
      scope?: string;
    };
    let accountEmail: string | null = null;
    try {
      const info = await providerFetch(
        `${API}/oauth/v1/access-tokens/${data.access_token}`
      );
      const payload = (await info.json()) as { user?: string };
      accountEmail = payload.user ?? null;
    } catch {
      // account label is cosmetic — never fail the exchange for it
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
      scopes: data.scope ?? null,
      accountEmail,
    };
  },

  async refresh(refreshToken): Promise<TokenRefresh> {
    const res = await providerFetch(TOKEN, {
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
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
    };
  },

  async searchAccounts(token, q): Promise<CrmAccount[]> {
    const res = await providerFetch(`${API}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: 'domain', operator: 'CONTAINS_TOKEN', value: q },
            ],
          },
          {
            filters: [
              { propertyName: 'name', operator: 'CONTAINS_TOKEN', value: q },
            ],
          },
        ],
        properties: ['name', 'domain', 'website'],
        limit: 10,
      }),
    });
    const data = (await res.json()) as { results?: HubSpotObject[] };
    return (data.results ?? []).map((row) => ({
      id: row.id,
      name: row.properties?.name ?? 'Unnamed account',
      domain: row.properties?.domain ?? row.properties?.website ?? null,
      url: row.properties?.website ?? null,
    }));
  },

  async listOpportunities(token, accountId): Promise<CrmOpportunity[]> {
    const ids = await associatedIds(token, 'companies', accountId, 'deals');
    const deals = await batchRead(token, 'deals', ids, DEAL_PROPS);
    const open = (deal: HubSpotObject) =>
      !['closedwon', 'closedlost'].includes(
        (deal.properties?.dealstage ?? '').toLowerCase()
      );
    return deals
      .sort((a, b) => Number(open(b)) - Number(open(a)))
      .slice(0, 20)
      .map((deal) => ({
        id: deal.id,
        name: deal.properties?.dealname ?? 'Untitled deal',
        stage: deal.properties?.dealstage ?? null,
        amount: deal.properties?.amount
          ? Number(deal.properties.amount)
          : null,
        closeDate: deal.properties?.closedate ?? null,
        url: null,
      }));
  },

  async listContacts(token, accountId, opportunityId?): Promise<CrmContact[]> {
    const ids = await associatedIds(token, 'companies', accountId, 'contacts');
    const contacts = await batchRead(
      token,
      'contacts',
      ids.slice(0, 200),
      CONTACT_PROPS
    );
    const portal = await portalId(token).catch(() => null);
    // Deal-scoped roles via deal→contact associations when an opp is linked.
    const roleByContact = new Map<string, string>();
    if (opportunityId) {
      const contactIds = await associatedIds(
        token,
        'deals',
        opportunityId,
        'contacts'
      ).catch(() => [] as string[]);
      for (const id of contactIds) roleByContact.set(id, 'associated');
    }
    return contacts.map((row) => {
      const props = row.properties ?? {};
      const name =
        [props.firstname, props.lastname].filter(Boolean).join(' ').trim() ||
        props.email ||
        'Unnamed contact';
      return {
        id: row.id,
        name,
        title: props.jobtitle ?? null,
        email: props.email ?? null,
        linkedin: props.hs_linkedin_url ?? props.linkedin ?? null,
        url: contactUrl(portal, row.id),
        role:
          props.topdown_buying_role ?? roleByContact.get(row.id) ?? null,
      };
    });
  },

  async ensureSchema(token) {
    for (const [name, options] of [
      [
        'topdown_buying_role',
        [
          'none',
          'champion',
          'economic_buyer',
          'decision_maker',
          'technical_buyer',
          'influencer',
          'blocker',
        ] as BuyingRole[],
      ],
      ['topdown_stance', ['advocate', 'neutral', 'skeptic', 'unknown']],
    ] as const) {
      const res = await fetch(`${API}/crm/v3/properties/contacts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          label: name === 'topdown_buying_role' ? 'TopDown buying role' : 'TopDown stance',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'contactinformation',
          options: options.map((value) => ({
            label: value,
            value,
            hidden: false,
            displayOrder: 0,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 409 = property already exists — that's the idempotent path.
      if (!res.ok && res.status !== 409) {
        const body = await res.text().catch(() => '');
        throw new Error(`hubspot schema failed (${res.status}): ${body.slice(0, 200)}`);
      }
    }
  },

  async pushContact(token, contact, ctx) {
    const properties: Record<string, string> = {
      topdown_buying_role: contact.role,
    };
    if (contact.stance) properties.topdown_stance = contact.stance;
    let portal: string | null = null;

    if (contact.crmId) {
      const res = await providerFetch(
        `${API}/crm/v3/objects/contacts/${contact.crmId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ properties }),
        }
      );
      const row = (await res.json()) as HubSpotObject;
      portal = await portalId(token).catch(() => null);
      return { crmId: row.id ?? contact.crmId, url: contactUrl(portal, row.id ?? contact.crmId) };
    }

    // New contact: fill the basics, then associate to the company.
    const [firstname, ...rest] = contact.name.split(' ');
    const created = await providerFetch(`${API}/crm/v3/objects/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        properties: {
          firstname,
          lastname: rest.join(' '),
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.title ? { jobtitle: contact.title } : {}),
          ...(contact.linkedin ? { hs_linkedin_url: contact.linkedin } : {}),
          ...properties,
        },
      }),
    });
    const row = (await created.json()) as HubSpotObject;
    if (ctx.accountId) {
      await providerFetch(
        `${API}/crm/v3/objects/contacts/${row.id}/associations/companies/${ctx.accountId}/company_to_contact`,
        { method: 'PUT' }
      ).catch(() => undefined);
    }
    portal = await portalId(token).catch(() => null);
    return { crmId: row.id, url: contactUrl(portal, row.id) };
  },
};
