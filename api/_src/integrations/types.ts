export interface CalendarEvent {
  externalId: string;
  startsAt: string;
  endsAt: string | null;
  subject: string | null;
  attendees: { email: string | null; name: string | null }[];
}

export interface EmailThread {
  externalId: string;
  lastMessageAt: string;
  subject: string | null;
  participants: { email: string | null; name: string | null }[];
}

export interface TokenExchange {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string | null;
  accountEmail: string | null;
}

export interface TokenRefresh {
  accessToken: string;
  expiresAt: string | null;
}

export interface ProviderAdapter {
  id: 'google' | 'microsoft';
  label: string;
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenExchange>;
  refresh(refreshToken: string): Promise<TokenRefresh>;
  listEvents(
    accessToken: string,
    sinceIso: string,
    untilIso: string
  ): Promise<CalendarEvent[]>;
  listThreads(
    accessToken: string,
    sinceIso: string,
    emails: string[]
  ): Promise<EmailThread[]>;
}

export class IntegrationError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`integration request failed (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

export async function providerFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new IntegrationError(res.status, body.slice(0, 200));
  }
  return res;
}
