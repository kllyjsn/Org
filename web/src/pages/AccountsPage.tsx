import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Loader2,
  LogOut,
  Plus,
  Trash2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { useSession } from '../store';
import type { MapListItem } from '../types';
import CreateMapModal from '../components/CreateMapModal';
import { Wordmark } from '../components/Wordmark';

function MembersModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<
    { id: string; name: string; email: string; role: string }[]
  >([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () => api.listMembers(workspaceId).then((r) => setMembers(r.members)),
    [workspaceId]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.addMember(workspaceId, email);
      setEmail('');
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to add member');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Workspace members</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <ul className="mb-4 divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-xs text-slate-500">{m.email}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            placeholder="teammate@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Add
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        <p className="mt-3 text-xs text-slate-400">
          Teammates must register an account before you can add them.
        </p>
      </div>
    </div>
  );
}

function PricingModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600">
              <Zap size={13} /> TopDown Pro
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Unlimited account maps
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="mb-5 flex items-end gap-1">
          <span className="text-4xl font-bold text-slate-900">$10</span>
          <span className="pb-1 text-sm text-slate-500">/ month</span>
        </div>
        <ul className="mb-6 space-y-2 text-sm text-slate-600">
          <li>Unlimited researched org charts</li>
          <li>Team collaboration and comments</li>
          <li>Shareable links and polished exports</li>
          <li>Canvas history and advanced editing</li>
        </ul>
        <button
          disabled
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Billing setup in progress
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">
          Your first two account maps remain free.
        </p>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const navigate = useNavigate();
  const {
    user,
    workspaces,
    workspaceId,
    selectWorkspace,
    refreshWorkspaces,
    logout,
  } = useSession();
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const workspace = workspaces.find((item) => item.id === workspaceId);

  const refreshMaps = useCallback(() => {
    if (!workspaceId) return;
    setLoadingMaps(true);
    api
      .listMaps(workspaceId)
      .then((r) => setMaps(r.maps))
      .finally(() => setLoadingMaps(false));
  }, [workspaceId]);

  useEffect(() => {
    refreshMaps();
  }, [refreshMaps]);

  const createWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    const { workspace } = await api.createWorkspace(newWorkspaceName.trim());
    await refreshWorkspaces();
    selectWorkspace(workspace.id);
    setNewWorkspaceName('');
    setCreatingWorkspace(false);
  };

  const deleteMap = async (id: string) => {
    if (!window.confirm('Delete this map? Share links to it will stop working.'))
      return;
    await api.deleteMap(id);
    refreshMaps();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Wordmark size="md" />
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
            value={workspaceId ?? ''}
            onChange={(e) => selectWorkspace(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {creatingWorkspace ? (
            <form onSubmit={createWorkspace} className="flex gap-2">
              <input
                autoFocus
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                placeholder="Workspace name"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
              />
              <button
                type="submit"
                className="text-sm font-medium text-indigo-600"
              >
                Create
              </button>
            </form>
          ) : (
            <button
              onClick={() => setCreatingWorkspace(true)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              + Workspace
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {workspaceId && (
            <button
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Users size={15} /> Members
            </button>
          )}
          {workspace?.plan === 'free' && (
            <button
              onClick={() => setShowPricing(true)}
              className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-100"
            >
              Upgrade · $10/mo
            </button>
          )}
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button
            onClick={() => void logout()}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">Account maps</h1>
        </div>

        {loadingMaps ? (
          <div className="flex justify-center py-24 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <button
              onClick={() =>
                workspace?.plan === 'free' && maps.length >= 2
                  ? setShowPricing(true)
                  : setShowCreate(true)
              }
              className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-indigo-400 hover:text-indigo-500"
            >
              <Plus size={28} />
              <span className="text-sm font-medium">
                {workspace?.plan === 'free' && maps.length >= 2
                  ? 'Upgrade for more maps'
                  : 'New account map'}
              </span>
              {workspace?.plan === 'free' && (
                <span className="text-xs">
                  {Math.max(0, 2 - maps.length)} of 2 free maps remaining
                </span>
              )}
            </button>

            {maps.map((m) => (
              <div
                key={m.id}
                onClick={() => navigate(`/app/maps/${m.id}`)}
                className="group flex h-40 cursor-pointer flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-slate-400" />
                      <span className="truncate font-semibold">
                        {m.company_name || m.name}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteMap(m.id);
                      }}
                      className="rounded p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{m.domain}</div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Workflow size={13} /> {m.peopleCount} people
                  </span>
                  <span>{new Date(m.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreate && workspaceId && (
        <CreateMapModal
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => navigate(`/app/maps/${id}`)}
        />
      )}
      {showMembers && workspaceId && (
        <MembersModal
          workspaceId={workspaceId}
          onClose={() => setShowMembers(false)}
        />
      )}
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
