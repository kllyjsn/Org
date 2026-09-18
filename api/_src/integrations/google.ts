import {
  IntegrationError,
  providerFetch,
  type CalendarEvent,
  type EmailThread,
  type ProviderAdapter,
  type TokenExchange,
  type TokenRefresh,
} from './types.js';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
].join(' ');

function configured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    return JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function tokenRequest(
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
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

interface GoogleAttendee {
  email?: string;
  displayName?: string;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
}

async function listEvents(
  accessToken: string,
  sinceIso: string,
  untilIso: string
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({
      timeMin: sinceIso,
      timeMax: untilIso,
      singleEvents: 'true',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await providerFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } }
    );
    const data = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const startsAt = item.start?.dateTime ?? item.start?.date;
      if (!item.id || !startsAt) continue;
      events.push({
        externalId: item.id,
        startsAt,
        endsAt: item.end?.dateTime ?? item.end?.date ?? null,
        subject: item.summary ?? null,
        attendees: (item.attendees ?? []).map((attendee) => ({
          email: attendee.email ?? null,
          name: attendee.displayName ?? null,
        })),
      });
    }
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return events;
}

function parseAddressHeader(
  value: unknown
): { email: string | null; name: string | null }[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((part) => {
      const match = part.trim().match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/);
      if (match) {
        return {
          email: match[2].trim().toLowerCase() || null,
          name: match[1]?.trim() || null,
        };
      }
      const bare = part.trim();
      return bare.includes('@')
        ? { email: bare.toLowerCase(), name: null }
        : { email: null, name: bare || null };
    })
    .filter((entry) => entry.email || entry.name);
}

interface GmailHeader {
  name?: string;
  value?: string;
}

async function listThreads(
  accessToken: string,
  sinceIso: string,
  emails: string[]
): Promise<EmailThread[]> {
  const since = new Date(sinceIso);
  const dateQuery = `after:${since.getUTCFullYear()}/${since.getUTCMonth() + 1}/${since.getUTCDate()}`;
  const threads: EmailThread[] = [];
  const seen = new Set<string>();
  const headers = { authorization: `Bearer ${accessToken}` };

  for (let i = 0; i < emails.length && threads.length < 60; i += 15) {
    const batch = emails.slice(i, i + 15);
    const clauses = batch.flatMap((email) => [`from:${email}`, `to:${email}`]);
    const q = `${dateQuery} ${clauses.join(' OR ')}`;
    const res = await providerFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?${new URLSearchParams({ q, maxResults: '60' })}`,
      { headers }
    );
    const data = (await res.json()) as {
      threads?: { id: string }[];
    };
    for (const ref of data.threads ?? []) {
      if (threads.length >= 60 || seen.has(ref.id)) continue;
      seen.add(ref.id);
      const detail = await providerFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${ref.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers }
      );
      const thread = (await detail.json()) as {
        messages?: {
          internalDate?: string;
          payload?: { headers?: GmailHeader[] };
        }[];
      };
      const participants: { email: string | null; name: string | null }[] = [];
      const participantKeys = new Set<string>();
      let subject: string | null = null;
      let lastMessageAt = 0;
      for (const message of thread.messages ?? []) {
        const internalMs = Number(message.internalDate ?? 0);
        if (internalMs > lastMessageAt) lastMessageAt = internalMs;
        const headerMap = new Map(
          (message.payload?.headers ?? []).map((h) => [
            (h.name ?? '').toLowerCase(),
            h.value ?? '',
          ])
        );
        subject = subject ?? headerMap.get('subject') ?? null;
        for (const name of ['from', 'to', 'cc']) {
          for (const person of parseAddressHeader(headerMap.get(name))) {
            const key = person.email ?? `name:${person.name}`;
            if (participantKeys.has(key)) continue;
            participantKeys.add(key);
            participants.push(person);
          }
        }
      }
      threads.push({
        externalId: ref.id,
        lastMessageAt: new Date(lastMessageAt || Date.now()).toISOString(),
        subject,
        participants,
      });
    }
  }
  return threads;
}

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  label: 'Google',
  configured,
  authUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },
  async exchangeCode(code: string, redirectUri: string): Promise<TokenExchange> {
    const data = await tokenRequest({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const expiresIn = Number(data.expires_in ?? 0);
    const idToken = typeof data.id_token === 'string' ? data.id_token : null;
    const claims = idToken ? decodeJwtPayload(idToken) : null;
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
      scopes: typeof data.scope === 'string' ? data.scope : SCOPES,
      accountEmail:
        claims && typeof claims.email === 'string' ? claims.email : null,
    };
  },
  async refresh(refreshToken: string): Promise<TokenRefresh> {
    const data = await tokenRequest({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
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
