import { create } from 'zustand';
import { api } from './api';
import type {
  ChartSuggestion,
  MapCoverage,
  Persona,
  PersonaInput,
  SessionUser,
  SuggestChartRequest,
  Workspace,
} from './types';

export interface SuggestChartState {
  mapId: string | null;
  suggestion: ChartSuggestion | null;
  params: SuggestChartRequest;
  confirmed: Set<string>;
  declined: Set<string>;
  generating: boolean;
  applying: boolean;
  error: string | null;
}

interface SessionState {
  user: SessionUser | null;
  workspaces: Workspace[];
  workspaceId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    name: string,
    workspaceName?: string
  ) => Promise<void>;
  acceptInvite: (
    token: string,
    body?: { name?: string; password?: string }
  ) => Promise<void>;
  logout: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;

  /** Personas for the selected workspace (F3). */
  personas: Persona[];
  loadPersonas: () => Promise<void>;
  savePersonas: (personas: PersonaInput[]) => Promise<Persona[]>;
  /** Persona coverage for the map currently open, keyed by map id. */
  coverage: { mapId: string; data: MapCoverage } | null;
  loadCoverage: (mapId: string) => Promise<void>;
  /** Debounced refetch; call after every map save. */
  scheduleCoverage: (mapId: string) => void;
  suggestChart: SuggestChartState;
  setSuggestion: (
    mapId: string,
    suggestion: ChartSuggestion,
    params: SuggestChartRequest
  ) => void;
  mergeRefined: (
    suggestion: ChartSuggestion,
    params: SuggestChartRequest
  ) => void;
  confirm: (rosterId: string) => void;
  unconfirm: (rosterId: string) => void;
  decline: (rosterId: string) => void;
  confirmAll: () => void;
  confirmHighOnly: () => void;
  clearSuggestion: () => void;
  setSuggestionStatus: (
    status: Partial<Pick<SuggestChartState, 'generating' | 'applying' | 'error'>>
  ) => void;
}

const COVERAGE_DEBOUNCE_MS = 800;
let coverageTimer: number | null = null;

const WS_KEY = 'org.workspaceId';

function pickWorkspace(
  workspaces: Workspace[],
  preferred: string | null
): string | null {
  if (preferred && workspaces.some((w) => w.id === preferred))
    return preferred;
  return workspaces[0]?.id ?? null;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  workspaces: [],
  workspaceId: null,
  loading: true,

  load: async () => {
    try {
      const { user, workspaces } = await api.me();
      const preferred = localStorage.getItem(WS_KEY);
      set({
        user,
        workspaces,
        workspaceId: pickWorkspace(workspaces, preferred),
        loading: false,
      });
    } catch {
      set({ user: null, workspaces: [], workspaceId: null, loading: false });
    }
  },

  login: async (email, password) => {
    const { user, workspaces } = await api.login(email, password);
    const preferred = localStorage.getItem(WS_KEY);
    set({ user, workspaces, workspaceId: pickWorkspace(workspaces, preferred) });
  },

  register: async (email, password, name, workspaceName) => {
    const { user, workspaces } = await api.register(
      email,
      password,
      name,
      workspaceName
    );
    const preferred = localStorage.getItem(WS_KEY);
    set({ user, workspaces, workspaceId: pickWorkspace(workspaces, preferred) });
  },

  acceptInvite: async (token, body) => {
    const { user, workspaces, workspaceId } = await api.acceptInvite(
      token,
      body
    );
    localStorage.setItem(WS_KEY, workspaceId);
    set({ user, workspaces, workspaceId: pickWorkspace(workspaces, workspaceId) });
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, workspaces: [], workspaceId: null });
    }
  },

  selectWorkspace: (id) => {
    localStorage.setItem(WS_KEY, id);
    set({ workspaceId: id, personas: [], coverage: null });
  },

  personas: [],
  loadPersonas: async () => {
    const workspaceId = get().workspaceId;
    if (!workspaceId) return;
    const { personas } = await api.listPersonas(workspaceId);
    if (get().workspaceId === workspaceId) set({ personas });
  },
  savePersonas: async (input) => {
    const workspaceId = get().workspaceId;
    if (!workspaceId) throw new Error('no workspace selected');
    const { personas } = await api.savePersonas(workspaceId, input);
    set({ personas });
    const current = get().coverage;
    if (current) get().scheduleCoverage(current.mapId);
    return personas;
  },

  coverage: null,
  loadCoverage: async (mapId) => {
    try {
      const data = await api.getMapCoverage(mapId);
      set({ coverage: { mapId, data } });
    } catch {
      // coverage is advisory; keep the last good value
    }
  },
  scheduleCoverage: (mapId) => {
    if (coverageTimer !== null) window.clearTimeout(coverageTimer);
    coverageTimer = window.setTimeout(() => {
      coverageTimer = null;
      void get().loadCoverage(mapId);
    }, COVERAGE_DEBOUNCE_MS);
  },

  suggestChart: {
    mapId: null,
    suggestion: null,
    params: {},
    confirmed: new Set(),
    declined: new Set(),
    generating: false,
    applying: false,
    error: null,
  },
  setSuggestion: (mapId, suggestion, params) => {
    set({
      suggestChart: {
        mapId,
        suggestion,
        params,
        confirmed: new Set(),
        declined: new Set(),
        generating: false,
        applying: false,
        error: null,
      },
    });
  },
  mergeRefined: (suggestion, params) => {
    set((state) => {
      const previous = state.suggestChart.suggestion;
      const confirmed = new Set(state.suggestChart.confirmed);
      const declined = new Set(state.suggestChart.declined);
      if (previous) {
        const nextIds = new Set(suggestion.people.map((person) => person.rosterId));
        const retained = previous.people.filter(
          (person) =>
            confirmed.has(person.rosterId) &&
            !declined.has(person.rosterId) &&
            !nextIds.has(person.rosterId)
        );
        if (retained.length > 0) {
          suggestion = {
            ...suggestion,
            people: [...suggestion.people, ...retained],
            stats: {
              ...suggestion.stats,
              suggested: suggestion.people.length + retained.length,
            },
          };
        }
      }
      return {
        suggestChart: {
          ...state.suggestChart,
          suggestion,
          params,
          generating: false,
          error: null,
        },
      };
    });
  },
  confirm: (rosterId) =>
    set((state) => {
      const confirmed = new Set(state.suggestChart.confirmed);
      confirmed.add(rosterId);
      return { suggestChart: { ...state.suggestChart, confirmed } };
    }),
  unconfirm: (rosterId) =>
    set((state) => {
      const confirmed = new Set(state.suggestChart.confirmed);
      confirmed.delete(rosterId);
      return { suggestChart: { ...state.suggestChart, confirmed } };
    }),
  decline: (rosterId) =>
    set((state) => {
      const declined = new Set(state.suggestChart.declined);
      declined.add(rosterId);
      const confirmed = new Set(state.suggestChart.confirmed);
      confirmed.delete(rosterId);
      return { suggestChart: { ...state.suggestChart, declined, confirmed } };
    }),
  confirmAll: () =>
    set((state) => {
      const confirmed = new Set(state.suggestChart.confirmed);
      for (const person of state.suggestChart.suggestion?.people ?? []) {
        if (!state.suggestChart.declined.has(person.rosterId)) {
          confirmed.add(person.rosterId);
        }
      }
      return { suggestChart: { ...state.suggestChart, confirmed } };
    }),
  confirmHighOnly: () =>
    set((state) => ({
      suggestChart: {
        ...state.suggestChart,
        confirmed: new Set(
          (state.suggestChart.suggestion?.people ?? [])
            .filter(
              (person) =>
                person.confidence === 'high' &&
                !state.suggestChart.declined.has(person.rosterId)
            )
            .map((person) => person.rosterId)
        ),
      },
    })),
  clearSuggestion: () =>
    set((state) => ({
      suggestChart: {
        ...state.suggestChart,
        mapId: null,
        suggestion: null,
        params: {},
        confirmed: new Set(),
        declined: new Set(),
        generating: false,
        applying: false,
        error: null,
      },
    })),
  setSuggestionStatus: (status) =>
    set((state) => ({
      suggestChart: { ...state.suggestChart, ...status },
    })),

  refreshWorkspaces: async () => {
    const { workspaces } = await api.me();
    set({ workspaces, workspaceId: pickWorkspace(workspaces, get().workspaceId) });
  },
}));
