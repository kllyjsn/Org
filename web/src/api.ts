import type {
  AccountBriefing,
  StrategyInsights,
  AccountAgentAnswer,
  AccountAgentMessage,
  FeedbackCategory,
  FeedbackItem,
  FeedbackStatus,
  LoadedMap,
  MapChangeAlert,
  MapComment,
  MapCoverage,
  Persona,
  PersonaInput,
  MapListItem,
  MapPresence,
  MapState,
  MapVersion,
  ProductEventName,
  ProductValueSummary,
  ResearchEvent,
  ResearchJob,
  ResearchResult,
  SellerProfile,
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
    req<{
      members: {
        id: string;
        name: string;
        email: string;
        role: string;
        access_scope: 'all' | 'selected';
        map_ids: string[];
      }[];
      invites: {
        id: string;
        email: string;
        created_at: string;
        expires_at: string;
        access_scope: 'all' | 'selected';
        map_ids: string[];
      }[];
    }>(`/api/workspaces/${workspaceId}/members`),
  addMember: (
    workspaceId: string,
    email: string,
    access: { accessScope: 'all' | 'selected'; mapIds: string[] }
  ) =>
    req<{
      ok: true;
      added?: boolean;
      invited?: boolean;
      inviteUrl?: string;
      emailSent?: boolean;
    }>(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, ...access }),
    }),
  updateMemberAccess: (
    workspaceId: string,
    userId: string,
    access: { accessScope: 'all' | 'selected'; mapIds: string[] }
  ) =>
    req<{ ok: true }>(
      `/api/workspaces/${workspaceId}/members/${userId}/access`,
      { method: 'PATCH', body: JSON.stringify(access) }
    ),
  revokeInvite: (workspaceId: string, inviteId: string) =>
    req<{ ok: true }>(
      `/api/workspaces/${workspaceId}/invites/${inviteId}`,
      { method: 'DELETE' }
    ),
  getInvite: (token: string) =>
    req<{
      invite: {
        email: string;
        workspaceName: string;
        inviterName: string;
        expiresAt: string;
        hasAccount: boolean;
        status: 'ok' | 'expired' | 'accepted';
        accessScope: 'all' | 'selected';
        accountNames: string[];
      };
    }>(`/api/invites/${token}`),
  acceptInvite: (
    token: string,
    body: { name?: string; password?: string } = {}
  ) =>
    req<{ user: SessionUser; workspaces: Workspace[]; workspaceId: string }>(
      `/api/invites/${token}/accept`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  researchSellerProfile: (workspaceId: string, domain: string) =>
    req<{ profile: SellerProfile }>(
      `/api/workspaces/${workspaceId}/seller-profile/research`,
      {
        method: 'POST',
        body: JSON.stringify({ domain }),
      }
    ),
  saveSellerProfile: (workspaceId: string, profile: SellerProfile) =>
    req<{ profile: SellerProfile }>(
      `/api/workspaces/${workspaceId}/seller-profile`,
      {
        method: 'PATCH',
        body: JSON.stringify({ profile }),
      }
    ),

  listPersonas: (workspaceId: string) =>
    req<{ personas: Persona[] }>(`/api/workspaces/${workspaceId}/personas`),
  savePersonas: (workspaceId: string, personas: PersonaInput[]) =>
    req<{ personas: Persona[] }>(`/api/workspaces/${workspaceId}/personas`, {
      method: 'PUT',
      body: JSON.stringify({ personas }),
    }),
  suggestPersonas: (workspaceId: string) =>
    req<{ personas: PersonaInput[]; source: 'llm' | 'fallback' }>(
      `/api/workspaces/${workspaceId}/personas/suggest`,
      { method: 'POST' }
    ),
  getMapCoverage: (mapId: string) =>
    req<MapCoverage>(`/api/maps/${mapId}/coverage`),

  sendFeedback: (input: {
    category: FeedbackCategory;
    message: string;
    pagePath?: string;
    workspaceId?: string | null;
  }) =>
    req<{ received: true }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listFeedback: () => req<{ items: FeedbackItem[] }>('/api/admin/feedback'),
  setFeedbackStatus: (id: string, status: FeedbackStatus) =>
    req<{ status: FeedbackStatus }>(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
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

  startResearch: (
    domain: string,
    focus?: string,
    knownSources?: string[],
    workspaceId?: string
  ) =>
    req<{ jobId: string }>('/api/research', {
      method: 'POST',
      body: JSON.stringify({
        domain,
        focus,
        workspaceId,
        ...(knownSources?.length ? { knownSources } : {}),
      }),
    }),
  getResearchJob: (id: string) =>
    req<{ job: ResearchJob }>(`/api/research/jobs/${id}`),
  cancelResearch: (id: string) =>
    req<{ job: ResearchJob }>(`/api/research/jobs/${id}/cancel`, {
      method: 'POST',
    }),
  subscribeResearch: (
    jobId: string,
    handlers: {
      onEvent: (event: ResearchEvent) => void;
      onPartial: (result: ResearchResult) => void;
      onDone: (result: ResearchResult) => void;
      onError: (message: string) => void;
    }
  ) => {
    let closed = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let seenEvents = 0;
    let seenPartialPeople = -1;
    const stopPolling = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const terminal = (job: ResearchJob) =>
      job.status === 'done' ||
      job.status === 'failed' ||
      job.status === 'cancelled';
    const consumeJob = (job: ResearchJob) => {
      for (const event of job.events.slice(seenEvents)) handlers.onEvent(event);
      seenEvents = job.events.length;
      if (job.partial && job.partial.people.length !== seenPartialPeople) {
        seenPartialPeople = job.partial.people.length;
        handlers.onPartial(job.partial);
      }
      if (terminal(job)) {
        closed = true;
        source?.close();
        stopPolling();
      }
      if (job.status === 'done' && job.result) handlers.onDone(job.result);
      if (job.status === 'failed') handlers.onError(job.error ?? 'research failed');
      if (job.status === 'cancelled') handlers.onError('research cancelled');
      return terminal(job);
    };
    const startPolling = () => {
      if (closed || pollTimer !== null) return;
      const poll = () => {
        void api.getResearchJob(jobId)
          .then(({ job }) => consumeJob(job))
          .catch((error: unknown) => {
            if (error instanceof Error) handlers.onError(error.message);
          });
      };
      poll();
      pollTimer = window.setInterval(poll, 2_000);
    };
    const connect = () => {
      if (closed) return;
      stopPolling();
      source?.close();
      source = new EventSource(
        `/api/research/jobs/${jobId}/stream?after=${seenEvents}`
      );
      source.addEventListener('progress', (event) => {
        seenEvents += 1;
        handlers.onEvent(JSON.parse((event as MessageEvent).data) as ResearchEvent);
      });
      source.addEventListener('partial', (event) => {
        handlers.onPartial(JSON.parse((event as MessageEvent).data) as ResearchResult);
      });
      source.addEventListener('done', (event) => {
        closed = true;
        source?.close();
        handlers.onDone(JSON.parse((event as MessageEvent).data) as ResearchResult);
      });
      source.addEventListener('failed', (event) => {
        closed = true;
        source?.close();
        const payload = JSON.parse((event as MessageEvent).data) as {
          error?: string;
        };
        handlers.onError(payload.error ?? 'research failed');
      });
      source.addEventListener('cancelled', () => {
        closed = true;
        source?.close();
        handlers.onError('research cancelled');
      });
      source.addEventListener('continue', () => {
        source?.close();
        if (!closed) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 1_000);
        }
      });
      source.onerror = () => {
        if (closed) return;
        source?.close();
        startPolling();
        if (!closed && reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 1_000);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      stopPolling();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  },

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
  getStrategyInsights: (mapId: string, refresh = false) =>
    req<StrategyInsights>(
      `/api/maps/${mapId}/strategy${refresh ? '?refresh=1' : ''}`
    ),
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
