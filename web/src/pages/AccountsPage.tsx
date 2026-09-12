import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Building2,
  Clock3,
  Loader2,
  LogOut,
  Plus,
  Radar,
  Sparkles,
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

function PricingModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.createCheckout(workspaceId);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'billing unavailable');
      setLoading(false);
    }
  };

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
          onClick={() => void upgrade()}
          disabled={loading}
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Opening secure checkout…' : 'Upgrade to Pro'}
        </button>
        {error && (
          <p className="mt-3 text-center text-xs text-rose-600">{error}</p>
        )}
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
  const totalPeople = maps.reduce((sum, map) => sum + map.peopleCount, 0);
  const researchedMaps = maps.filter((map) => map.peopleCount > 0).length;

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
    <div className="flex h-full flex-col bg-[#f6f7f2]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white/85 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <Wordmark size="md" />
          <select
            className="min-w-0 max-w-48 flex-1 truncate rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-sm font-medium sm:flex-none"
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
              className="hidden text-sm text-slate-500 hover:text-slate-700 sm:block"
            >
              + Workspace
            </button>
          )}
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
          {workspaceId && (
            <button
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Users size={15} /> <span className="hidden sm:inline">Members</span>
            </button>
          )}
          {workspace?.plan === 'free' && (
            <button
              onClick={() => setShowPricing(true)}
              className="rounded-lg bg-[#eeecff] px-3 py-1.5 text-sm font-semibold text-[#5b4cf0] hover:bg-[#e3dfff]"
            >
              Upgrade <span className="hidden sm:inline">· $10/mo</span>
            </button>
          )}
          <span className="hidden text-sm text-slate-500 lg:inline">{user?.name}</span>
          <button
            onClick={() => void logout()}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-3 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-7xl">
        <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Radar size={14} />
              Account intelligence
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">
              See every account
              <span className="text-slate-400"> from the top down.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              Research the org, connect initiatives to people, and give your
              team a living map of the path in.
            </p>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white td-card-shadow">
            {[
              [String(maps.length), 'accounts'],
              [String(totalPeople), 'people'],
              [String(researchedMaps), 'researched'],
            ].map(([value, label], index) => (
              <div
                key={label}
                className={`min-w-24 px-4 py-3 ${index > 0 ? 'border-l border-slate-100' : ''}`}
              >
                <div className="text-xl font-semibold tracking-tight text-slate-950">
                  {value}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {loadingMaps ? (
          <div className="flex justify-center py-24 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              onClick={() =>
                workspace?.plan === 'free' && maps.length >= 2
                  ? setShowPricing(true)
                  : setShowCreate(true)
              }
              className="group relative flex min-h-52 flex-col items-start justify-between overflow-hidden rounded-2xl bg-slate-950 p-5 text-left text-white shadow-[0_20px_45px_rgba(15,23,42,.16)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(15,23,42,.22)]"
            >
              <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#5b4cf0] blur-2xl transition group-hover:scale-125" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#c9f04b] text-slate-950">
                <Plus size={20} />
              </div>
              <div className="relative">
              <span className="block text-lg font-semibold tracking-tight">
                {workspace?.plan === 'free' && maps.length >= 2
                  ? 'Upgrade for more maps'
                  : 'New account map'}
              </span>
              {workspace?.plan === 'free' && (
                <span className="mt-1 block text-xs text-slate-400">
                  {Math.max(0, 2 - maps.length)} of 2 free maps remaining
                </span>
              )}
              </div>
            </button>

            {maps.map((m) => (
              <div
                key={m.id}
                onClick={() => navigate(`/app/maps/${m.id}`)}
                className="group relative flex min-h-52 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 td-card-shadow transition hover:-translate-y-0.5 hover:border-[#b9b2ff] hover:shadow-[0_20px_48px_rgba(15,23,42,.12)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eeecff] text-[#5b4cf0]">
                        <Building2 size={18} />
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate font-semibold tracking-tight text-slate-950">
                          {m.company_name || m.name}
                        </span>
                        <span className="block truncate text-xs text-slate-400">{m.domain}</span>
                      </div>
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
                  <div className="mt-5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      <Sparkles size={11} /> Researched
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      T0 public web
                    </span>
                  </div>
                </div>
                <div className="flex items-end justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <div className="flex gap-4">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <Workflow size={13} className="text-[#5b4cf0]" /> {m.peopleCount} people
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock3 size={13} /> {new Date(m.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <ArrowUpRight
                    size={17}
                    className="text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#5b4cf0]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
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
      {showPricing && workspaceId && (
        <PricingModal
          workspaceId={workspaceId}
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  );
}
