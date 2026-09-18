import type { ParsedPerson } from './parsers';
import type { Settings } from './settings';

export interface Account {
  id: string;
  name: string;
  domain: string;
  companyName: string | null;
  workspace: { id: string; name: string };
  peopleCount: number;
  match: 'domain' | 'query' | null;
}

export interface Me {
  user: { id: string; email: string; name: string };
  workspaces: { id: string; name: string; role: string }[];
}

export interface RosterResult {
  upserted: number;
  alreadyKnown: number;
  counts: { suggested: number; added: number; dismissed: number };
}

export type ImportSource = 'linkedin_url' | 'sales_navigator';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export class ExtensionApi {
  constructor(private settings: Pick<Settings, 'apiUrl' | 'token'>) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.settings.apiUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.settings.token}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError(
        0,
        `Could not reach ${this.settings.apiUrl}. Check the API URL in options.`
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
    } & T;
    if (!res.ok) {
      throw new ApiError(
        res.status,
        body.error ??
          (res.status === 401
            ? 'Token rejected. Create a new one in TopDown.'
            : `Request failed (${res.status})`)
      );
    }
    return body;
  }

  me(): Promise<Me> {
    return this.req<Me>('/api/extension/me');
  }

  accounts(params: { q?: string; domain?: string } = {}): Promise<Account[]> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.domain) qs.set('domain', params.domain);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.req<{ accounts: Account[] }>(
      `/api/extension/accounts${suffix}`
    ).then((r) => r.accounts);
  }

  createAccount(input: {
    domain: string;
    name?: string;
    workspaceId?: string;
  }): Promise<{ id: string; created: boolean }> {
    return this.req('/api/extension/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  addToRoster(
    mapId: string,
    people: ParsedPerson[],
    source: ImportSource
  ): Promise<RosterResult> {
    return this.req<RosterResult>('/api/extension/roster', {
      method: 'POST',
      body: JSON.stringify({ mapId, source, people }),
    });
  }
}

/** Best-effort guess of a company's web domain from its display name. */
export function guessDomain(company: string | null): string {
  if (!company) return '';
  const slug = company
    .toLowerCase()
    .replace(/[,.]?\s*\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|ag)\b\.?$/i, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  return slug ? `${slug}.com` : '';
}
