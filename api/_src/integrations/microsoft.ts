import {
  IntegrationError,
  providerFetch,
  type CalendarEvent,
  type EmailThread,
  type ProviderAdapter,
  type TokenExchange,
  type TokenRefresh,
} from './types.js';

const SCOPES = 'offline_access User.Read Calendars.Read Mail.Read';
const TENANT = 'common';
const BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

function configured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
  );
}

async function tokenRequest(
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new IntegrationError(
      res.status,
      JSON.stringify(data).slice(0, 200)
    );
  }
  return data;
}

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}

interface GraphEvent {
  id?: string;
  subject?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: GraphRecipient[];
}

async function listEvents(
  accessToken: string,
  sinceIso: string,
  untilIso: string
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const headers = { authorization: `Bearer ${accessToken}` };
  let url: string | null =
    `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(sinceIso)}` +
    `&endDateTime=${encodeURIComponent(untilIso)}&$top=250`;
  for (let page = 0; page < 4 && url; page++) {
    const res = await providerFetch(url, { headers });
    const data = (await res.json()) as {
      value?: GraphEvent[];
      '@odata.nextLink'?: string;
    };
    for (const item of data.value ?? []) {
      if (!item.id || !item.start?.dateTime) continue;
      events.push({
        externalId: item.id,
        // Graph returns timezone-less local times; treat as UTC.
        startsAt: `${item.start.dateTime.replace(/Z$/, '')}Z`,
        endsAt: item.end?.dateTime
          ? `${item.end.dateTime.replace(/Z$/, '')}Z`
          : null,
        subject: item.subject ?? null,
        attendees: (item.attendees ?? []).map((attendee) => ({
          email: attendee.emailAddress?.address?.toLowerCase() ?? null,
          name: attendee.emailAddress?.name ?? null,
        })),
      });
    }
    url = data['@odata.nextLink'] ?? null;
  }
  return events;
}

interface GraphMessage {
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
}

async function listThreads(
  accessToken: string,
  sinceIso: string,
  emails: string[]
): Promise<EmailThread[]> {
  const wanted = new Set(emails.map((email) => email.toLowerCase()));
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $select:
      'conversationId,subject,receivedDateTime,from,toRecipients,ccRecipients',
    $top: '200',
  });
  const res = await providerFetch(`${GRAPH}/me/messages?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as { value?: GraphMessage[] };

  const threads = new Map<string, EmailThread>();
  const seenKeys = new Map<string, Set<string>>();
  for (const message of data.value ?? []) {
    const conversationId = message.conversationId;
    if (!conversationId || !message.receivedDateTime) continue;
    const participants = [
      message.from,
      ...(message.toRecipients ?? []),
      ...(message.ccRecipients ?? []),
    ].map((recipient) => ({
      email: recipient?.emailAddress?.address?.toLowerCase() ?? null,
      name: recipient?.emailAddress?.name ?? null,
    }));
    if (!participants.some((p) => p.email && wanted.has(p.email))) continue;
    const thread =
      threads.get(conversationId) ??
      {
        externalId: conversationId,
        lastMessageAt: message.receivedDateTime,
        subject: message.subject ?? null,
        participants: [],
      };
    if (message.receivedDateTime > thread.lastMessageAt) {
      thread.lastMessageAt = message.receivedDateTime;
    }
    const keys = seenKeys.get(conversationId) ?? new Set<string>();
    for (const person of participants) {
      const key = person.email ?? `name:${person.name}`;
      if (keys.has(key)) continue;
      keys.add(key);
      thread.participants.push(person);
    }
    seenKeys.set(conversationId, keys);
    threads.set(conversationId, thread);
  }
  return Array.from(threads.values()).slice(0, 60);
}

export const microsoftAdapter: ProviderAdapter = {
  id: 'microsoft',
  label: 'Microsoft',
  configured,
  authUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      response_mode: 'query',
      state,
    });
    return `${BASE}/authorize?${params}`;
  },
  async exchangeCode(code: string, redirectUri: string): Promise<TokenExchange> {
    const data = await tokenRequest({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    });
    const expiresIn = Number(data.expires_in ?? 0);
    // Microsoft doesn't hand us the mailbox address in the token; fetch it.
    let accountEmail: string | null = null;
    try {
      const me = await providerFetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
        headers: { authorization: `Bearer ${data.access_token}` },
      });
      const profile = (await me.json()) as {
        mail?: string;
        userPrincipalName?: string;
      };
      accountEmail = profile.mail ?? profile.userPrincipalName ?? null;
    } catch {
      accountEmail = null;
    }
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
      scopes: typeof data.scope === 'string' ? data.scope : SCOPES,
      accountEmail,
    };
  },
  async refresh(refreshToken: string): Promise<TokenRefresh> {
    const data = await tokenRequest({
      refresh_token: refreshToken,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      scope: SCOPES,
    });
    const expiresIn = Number(data.expires_in ?? 0);
    return {
      accessToken: String(data.access_token ?? ''),
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
    };
  },
  listEvents,
  listThreads,
};
