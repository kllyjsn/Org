import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Clock3,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  Radar,
  Sparkles,
  Trash2,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import { useSession } from '../store';
import type { MapListItem } from '../types';
import CreateMapModal from '../components/CreateMapModal';
import FeedbackInboxModal from '../components/FeedbackInboxModal';
import FeedbackModal from '../components/FeedbackModal';
import ValueDashboardModal from '../components/ValueDashboardModal';
import SellerProfileModal from '../components/SellerProfileModal';
import RailButton, { RailSeparator } from '../components/RailButton';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useDocumentTitle } from '../lib/useDocumentTitle';

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
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-modal-title"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-sheet p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
              <Users size={13} aria-hidden="true" />
              Workspace
            </div>
            <h2
              id="members-modal-title"
              className="text-2xl font-semibold tracking-[-0.04em] text-slate-950"
            >
              Workspace members
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-9 sm:w-9"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="mb-4 divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-xs text-slate-500">{m.email}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            placeholder="teammate@company.com"
            type="email"
            aria-label="Teammate email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button
            type="submit"
            className="rounded-xl bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-deep"
          >
            Add
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-xs text-rose-600">
            {error}
          </p>
        )}
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
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-sheet p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
              <Zap size={13} /> TopDown Pro
            </div>
            <h2
              id="pricing-modal-title"
              className="text-2xl font-semibold tracking-[-0.04em] text-slate-950"
            >
              Unlimited account maps
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-9 sm:w-9"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mb-5 flex items-end gap-1">
          <span className="text-4xl font-semibold tracking-[-0.04em] text-slate-900">$10</span>
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
          className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-cta hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Opening secure checkout…' : 'Upgrade to Pro'}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-center text-xs text-rose-600">
            {error}
          </p>
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
  const [showValue, setShowValue] = useState(false);
  const [showSellerProfile, setShowSellerProfile] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showFeedbackInbox, setShowFeedbackInbox] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const workspace = workspaces.find((item) => item.id === workspaceId);
  useDocumentTitle('Accounts — TopDown');
  const totalPeople = maps.reduce((sum, map) => sum + map.peopleCount, 0);
  const initiativeCount = maps.reduce(
    (sum, map) => sum + map.initiativeCount,
    0
  );

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

  useEffect(() => {
    if (workspaceId && workspace && !workspace.seller_profile) {
      const key = `topdown_seller_prompted_${workspaceId}`;
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, '1');
        setShowSellerProfile(true);
      }
    }
  }, [workspaceId, workspace]);

  // Escape closes the topmost open modal.
  useEffect(() => {
    const closers: [boolean, () => void][] = [
      [showFeedback, () => setShowFeedback(false)],
      [showFeedbackInbox, () => setShowFeedbackInbox(false)],
      [showSellerProfile, () => setShowSellerProfile(false)],
      [showValue, () => setShowValue(false)],
      [showPricing, () => setShowPricing(false)],
      [showMembers, () => setShowMembers(false)],
      [showCreate, () => setShowCreate(false)],
    ];
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const [open, close] of closers) {
        if (open) {
          close();
          return;
        }
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    showFeedback,
    showFeedbackInbox,
    showSellerProfile,
    showValue,
    showPricing,
    showMembers,
    showCreate,
  ]);

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

  const toggleLiveOpportunity = async (map: MapListItem) => {
    const next = !map.is_live_opportunity;
    await api.setLiveOpportunity(map.id, next);
    setMaps((items) =>
      items.map((item) =>
        item.id === map.id ? { ...item, is_live_opportunity: next } : item
      )
    );
  };

  return (
    <div className="flex h-full overflow-hidden bg-paper">
      <nav
        aria-label="Workspace tools"
        className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto bg-ink py-2 sm:w-56 sm:items-stretch sm:px-3"
      >
        <div
          className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.06] sm:w-full sm:justify-start sm:px-3"
          title="TopDown"
        >
          <span className="hidden sm:block">
            <Wordmark size="sm" inverse />
          </span>
          <span className="sm:hidden">
            <Wordmark size="sm" inverse markOnly />
          </span>
        </div>
        <RailSeparator />
        <RailButton
          icon={<LayoutDashboard size={16} />}
          label="Account maps"
          active
        />
        <RailButton
          icon={<Plus size={16} />}
          label="New workspace"
          onClick={() => setCreatingWorkspace(true)}
        />
        {workspaceId && (
          <>
            <RailSeparator />
            <RailButton
              icon={<Sparkles size={16} />}
              label="Your company"
              onClick={() => setShowSellerProfile(true)}
            />
            <RailButton
              icon={<BarChart3 size={16} />}
              label="Value"
              onClick={() => setShowValue(true)}
            />
            <RailButton
              icon={<Users size={16} />}
              label="Members"
              onClick={() => setShowMembers(true)}
            />
          </>
        )}
        <RailSeparator />
        <RailButton
          icon={<MessageSquare size={16} />}
          label="Send feedback"
          onClick={() => setShowFeedback(true)}
        />
        {user?.isAdmin && (
          <RailButton
            icon={<Inbox size={16} />}
            label="Feedback inbox"
            onClick={() => setShowFeedbackInbox(true)}
          />
        )}
        <div className="flex-1" />
        {workspace?.plan === 'free' && (
          <RailButton
            icon={<Zap size={16} />}
            label="Upgrade"
            accent
            onClick={() => setShowPricing(true)}
          />
        )}
        <RailButton
          icon={<LogOut size={16} />}
          label="Sign out"
          onClick={() => void logout()}
        />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-slate-200/80 bg-white/85 px-3 py-2.5 backdrop-blur-xl sm:gap-4 sm:px-6">
          <select
            className="min-w-0 max-w-48 flex-1 truncate rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-sm font-medium sm:flex-none"
            value={workspaceId ?? ''}
            onChange={(e) => selectWorkspace(e.target.value)}
            aria-label="Select workspace"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {creatingWorkspace && (
            <form onSubmit={createWorkspace} className="flex gap-2">
              <input
                autoFocus
                aria-label="New workspace name"
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
          )}
          <div className="flex-1" />
          <span className="hidden text-sm text-slate-500 lg:inline">{user?.name}</span>
        </header>

      <main
        id="main"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto px-3 py-6 sm:px-6 sm:py-10"
      >
        <div className="mx-auto max-w-7xl">
        <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-brand">
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
              [String(initiativeCount), 'signals'],
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
              <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-brand blur-2xl transition group-hover:scale-125" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-slate-950">
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
                className="group relative flex min-h-52 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 td-card-shadow transition hover:-translate-y-0.5 hover:border-brand-line hover:shadow-[0_20px_48px_rgba(15,23,42,.12)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                        <Building2 size={18} />
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate font-semibold tracking-tight text-slate-950">
                          {m.name}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {m.company_name && m.company_name !== m.name
                            ? `${m.company_name} · `
                            : ''}
                          {m.domain}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteMap(m.id);
                      }}
                      className="rounded p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 sm:p-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label="Delete account map"
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
                    {m.is_live_opportunity && (
                      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        Live deal
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <div className="flex gap-4">
                    <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-slate-700">
                      <Workflow size={13} className="text-brand" /> {m.peopleCount} people
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock3 size={13} /> {new Date(m.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {workspace?.role !== 'viewer' && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleLiveOpportunity(m);
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
                          m.is_live_opportunity
                            ? 'bg-accent-soft text-slate-700 hover:bg-accent-softer'
                            : 'bg-slate-100 text-slate-500 hover:text-brand sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100'
                        }`}
                      >
                        <BriefcaseBusiness size={12} />
                        <span className="hidden sm:inline">
                          {m.is_live_opportunity ? 'Live deal' : 'Mark live'}
                        </span>
                      </button>
                    )}
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/app/maps/${m.id}?briefing=1`);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1.5 text-[10px] font-semibold text-brand transition hover:bg-brand-softer sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <Radar size={12} />
                      <span className="hidden sm:inline">Next moves</span>
                    </button>
                    <ArrowUpRight
                      size={17}
                      className="text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
                    />
                  </div>
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
      {showValue && workspaceId && (
        <ValueDashboardModal
          workspaceId={workspaceId}
          onClose={() => setShowValue(false)}
        />
      )}
      {showFeedback && (
        <FeedbackModal
          workspaceId={workspaceId}
          onClose={() => setShowFeedback(false)}
        />
      )}
      {showFeedbackInbox && (
        <FeedbackInboxModal onClose={() => setShowFeedbackInbox(false)} />
      )}
      {showSellerProfile && workspaceId && (
        <SellerProfileModal
          workspaceId={workspaceId}
          initialProfile={workspace?.seller_profile ?? null}
          onClose={() => setShowSellerProfile(false)}
          onSaved={() => {
            setShowSellerProfile(false);
            void refreshWorkspaces();
          }}
        />
      )}
      </div>
    </div>
  );
}
