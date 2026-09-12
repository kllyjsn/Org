import type {
  AccountBriefing,
  AccountAgentAnswer,
  AccountAgentMessage,
  LoadedMap,
  MapChangeAlert,
  MapComment,
  MapListItem,
  MapPresence,
  MapState,
  MapVersion,
  ProductEventName,
  ProductValueSummary,
  ResearchResult,
  SessionUser,
  ShareLink,
  Workspace,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : `request failed (${res.status})`,
      res.status
    );
  }
  return data as T;
}

export const api = {
  me: () =>
    req<{ user: SessionUser; workspaces: Workspace[] }>('/api/me'),
  login: (email: string, password: string) =>
    req<{ user: SessionUser; workspaces: Workspace[] }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (
    email: string,
    password: string,
    name: string,
    workspaceName?: string
  ) =>
    req<{ user: SessionUser; workspaces: Workspace[] }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, workspaceName }),
    }),
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  createWorkspace: (name: string) =>
    req<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listMembers: (workspaceId: string) =>
    req<{ members: { id: string; name: string; email: string; role: string }[] }>(
      `/api/workspaces/${workspaceId}/members`
    ),
  addMember: (workspaceId: string, email: string) =>
    req<{ ok: true }>(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  createCheckout: (workspaceId: string) =>
    req<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  createBillingPortal: (workspaceId: string) =>
    req<{ url: string }>('/api/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),

  research: (domain: string, focus?: string) =>
    req<ResearchResult>('/api/research', {
      method: 'POST',
      body: JSON.stringify({ domain, focus }),
    }),

  listMaps: (workspaceId: string) =>
    req<{ maps: MapListItem[] }>(`/api/maps?workspaceId=${workspaceId}`),
  createMap: (
    workspaceId: string,
    name: string,
    domain: string,
    state: MapState,
    analytics?: {
      creationMode: 'researched' | 'template' | 'blank';
      researchStartedAt?: string;
    }
  ) =>
    req<{ id: string }>('/api/maps', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, domain, state, analytics }),
    }),
  getMap: (id: string) => req<{ map: LoadedMap }>(`/api/maps/${id}`),
  patchMap: (id: string, patch: { name?: string; state?: MapState }) =>
    req<{ ok: true; updatedAt: string }>(`/api/maps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteMap: (id: string) =>
    req<{ ok: true }>(`/api/maps/${id}`, { method: 'DELETE' }),
  setLiveOpportunity: (id: string, live: boolean) =>
    req<{ live: boolean }>(`/api/maps/${id}/opportunity`, {
      method: 'POST',
      body: JSON.stringify({ live }),
    }),
  listVersions: (mapId: string) =>
    req<{ versions: MapVersion[] }>(`/api/maps/${mapId}/versions`),
  listChanges: (mapId: string) =>
    req<{ baselineAt: string | null; changes: MapChangeAlert[] }>(
      `/api/maps/${mapId}/changes`
    ),
  getBriefing: (mapId: string) =>
    req<AccountBriefing>(`/api/maps/${mapId}/briefing`),
  askMap: (mapId: string, messages: AccountAgentMessage[]) =>
    req<AccountAgentAnswer>(`/api/maps/${mapId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),
  restoreVersion: (mapId: string, versionId: string) =>
    req<{ name: string; state: MapState }>(
      `/api/maps/${mapId}/versions/${versionId}/restore`,
      { method: 'POST' }
    ),
  updatePresence: (
    mapId: string,
    presence?: {
      cursorX?: number;
      cursorY?: number;
      selectedPersonId?: string | null;
    }
  ) =>
    req<{ people: MapPresence[]; selfId: string }>(
      `/api/maps/${mapId}/presence`,
      {
      method: 'POST',
        body: JSON.stringify(presence ?? {}),
      }
    ),

  listComments: (mapId: string) =>
    req<{ comments: MapComment[] }>(`/api/maps/${mapId}/comments`),
  addComment: (mapId: string, body: string, personId?: string) =>
    req<{ id: string }>(`/api/maps/${mapId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, personId }),
    }),

  createShare: (mapId: string, expiresInDays?: number) =>
    req<{ token: string }>(`/api/maps/${mapId}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiresInDays }),
    }),
  listShares: (mapId: string) =>
    req<{ links: ShareLink[] }>(`/api/maps/${mapId}/share`),
  deleteShare: (mapId: string, token: string) =>
    req<{ ok: true }>(`/api/maps/${mapId}/share/${token}`, { method: 'DELETE' }),

  shareView: (token: string) =>
    req<{
      map: {
        name: string;
        domain: string;
        company_name: string | null;
        updated_at: string;
        state: MapState;
      };
    }>(`/api/share/${token}`),

  trackEvent: (
    mapId: string,
    eventName: ProductEventName,
    properties: Record<string, string | number | boolean> = {}
  ) =>
    req<{ accepted: true }>(`/api/maps/${mapId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        eventName,
        properties,
      }),
    }),
  getValueSummary: (workspaceId: string) =>
    req<ProductValueSummary>(`/api/workspaces/${workspaceId}/value`),
};
