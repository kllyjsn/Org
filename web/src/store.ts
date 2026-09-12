import { create } from 'zustand';
import { api } from './api';
import type { SessionUser, Workspace } from './types';

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
  logout: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

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

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, workspaces: [], workspaceId: null });
    }
  },

  selectWorkspace: (id) => {
    localStorage.setItem(WS_KEY, id);
    set({ workspaceId: id });
  },

  refreshWorkspaces: async () => {
    const { workspaces } = await api.me();
    set({ workspaces, workspaceId: pickWorkspace(workspaces, get().workspaceId) });
  },
}));
