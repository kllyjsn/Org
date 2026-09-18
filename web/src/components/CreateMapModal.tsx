import { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, Search, Sparkles, Users } from 'lucide-react';
import { api, ApiError } from '../api';
import { stateFromResearch } from '../lib/layout';
import type {
  MapState,
  Person,
  ResearchEvent,
  ResearchResult,
} from '../types';

function templateState(
  domain: string,
  template: 'executive' | 'buying-committee'
): MapState {
  const executive = [
    ['Chief Executive Officer', 'Executive', 'none'],
    ['Chief Financial Officer', 'Finance', 'none'],
    ['Chief Technology Officer', 'Engineering', 'none'],
    ['Chief Revenue Officer', 'Sales', 'none'],
  ] as const;
  const buyingCommittee = [
    ['Executive Sponsor', 'Executive', 'economic_buyer'],
    ['Business Champion', 'Operations', 'champion'],
    ['Decision Maker', 'Operations', 'decision_maker'],
    ['Technical Buyer', 'Engineering', 'technical_buyer'],
    ['Key Influencer', 'Operations', 'influencer'],
    ['Potential Blocker', 'Finance', 'blocker'],
  ] as const;
  const source = template === 'executive' ? executive : buyingCommittee;
  const people: Person[] = source.map(([title, department, role], index) => ({
    id: crypto.randomUUID(),
    name: title,
    title,
    department,
    role,
    confidence: 'high',
    sources: [],
    notes: '',
    email: null,
    linkedin: null,
    x: (index % 3) * 300,
    y: Math.floor(index / 3) * 180,
  }));
  return {
    people,
    edges: [],
    meta: {
      domain,
      companyName: null,
      researchedAt: null,
      tier: 'template',
      provider: null,
    },
  };
}

export default function CreateMapModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (mapId: string) => void;
}) {
  const [domain, setDomain] = useState('');
  const [researching, setResearching] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [partial, setPartial] = useState<ResearchResult | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const researchStartedAt = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      unsubscribe.current?.();
    };
  }, []);

  const research = async () => {
    setError(null);
    setResult(null);
    setPartial(null);
    setEvents([]);
    setResearching(true);
    researchStartedAt.current = new Date().toISOString();
    try {
      const { jobId: nextJobId } = await api.startResearch(
        domain.trim(),
        undefined,
        undefined,
        workspaceId
      );
      setJobId(nextJobId);
      unsubscribe.current = api.subscribeResearch(nextJobId, {
        onEvent: (event) =>
          setEvents((current) => [...current, event].slice(-3)),
        onPartial: setPartial,
        onDone: (nextResult) => {
          setResult(nextResult);
          setPartial(nextResult);
          setResearching(false);
          setJobId(null);
          unsubscribe.current?.();
        },
        onError: (message) => {
          setError(message);
          setResearching(false);
          setJobId(null);
          unsubscribe.current?.();
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'research failed');
      setResearching(false);
    } finally {
      researchStartedAt.current ??= new Date().toISOString();
    }
  };

  const cancelResearch = async (usePartial = false) => {
    if (!jobId) return;
    const activeJobId = jobId;
    unsubscribe.current?.();
    unsubscribe.current = null;
    try {
      await api.cancelResearch(activeJobId);
      if (usePartial && partial) setResult({ ...partial, complete: false });
      setResearching(false);
      setJobId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to cancel research');
    }
  };

  const create = async (blank: boolean) => {
    setCreating(true);
    setError(null);
    try {
      const d = domain.trim();
      const state = blank
        ? {
            people: [],
            edges: [],
            meta: {
              domain: d,
              companyName: null,
              researchedAt: null,
              tier: 'manual',
              provider: null,
            },
          }
        : stateFromResearch(result!);
      const name = result?.companyName || d;
      const { id } = await api.createMap(workspaceId, name, d, state, {
        creationMode: blank ? 'blank' : 'researched',
        ...(blank || !researchStartedAt.current
          ? {}
          : { researchStartedAt: researchStartedAt.current }),
      });
      onCreated(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create map');
      setCreating(false);
    }
  };

  const createFromTemplate = async (
    template: 'executive' | 'buying-committee'
  ) => {
    setCreating(true);
    setError(null);
    try {
      const d = domain.trim();
      const { id } = await api.createMap(
        workspaceId,
        d,
        d,
        templateState(d, template),
        { creationMode: 'template' }
      );
      onCreated(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create map');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:rounded-3xl sm:p-7">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
            <Sparkles size={14} />
            New intelligence map
          </div>
          <button            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <h2 className="text-3xl font-semibold tracking-[-0.045em] text-slate-950">
          Map the whole account.
        </h2>
        <p className="mb-6 mt-2 max-w-md text-sm leading-6 text-slate-500">
          Start with a domain. TopDown researches people, teams, reporting
          lines, and the initiatives shaping their priorities.
        </p>

        <div className="flex rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-[#5b4cf0] focus-within:ring-4 focus-within:ring-[#5b4cf0]/10">
          <input
            autoFocus
            className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none"
            placeholder="acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && domain.trim() && !researching)
                void research();
            }}
            disabled={researching || creating}
          />
          <button
            onClick={() => void research()}
            disabled={!domain.trim() || researching || creating}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-[#5b4cf0] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4b3ddd] disabled:opacity-60"
          >
            {researching ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} />
            )}
            Research
          </button>
        </div>

        {researching && (
          <div className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-4 text-white">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span>Live research</span>
              <span>
                {partial?.people.length ?? 0} people ·{' '}
                {new Set(
                  (partial?.people ?? []).flatMap((person) =>
                    person.sources
                  )
                ).size}{' '}
                sources found
              </span>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-slate-300">
              {events.map((event, index) => (
                <div key={`${event.at}-${index}`}>{event.message}</div>
              ))}
            </div>
            {partial && partial.people.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-300">
                {partial.people.slice(0, 8).map((person, index) => (
                  <li key={`${person.name}-${index}`}>
                    {person.name} — {person.title}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 size={14} className="animate-spin text-[#c9f04b]" />
                Researching…
              </div>
              <div className="flex gap-2">
                {partial && partial.people.length >= 5 && (
                  <button
                    onClick={() => void cancelResearch(true)}
                    className="rounded-lg bg-[#c9f04b] px-3 py-1.5 text-xs font-semibold text-slate-950"
                  >
                    Use what we have so far
                  </button>
                )}
                <button
                  onClick={() => void cancelResearch()}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles size={15} />
              {result.demo
                ? 'Demo chart loaded — no LLM key configured'
                : `Found ${result.people.length} people at ${result.companyName || result.domain}`}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {result.demo
                ? 'Set OPENROUTER_API_KEY, PERPLEXITY_API_KEY, or GEMINI_API_KEY to research real orgs.'
                : `${result.provider[0].toUpperCase() + result.provider.slice(1)} · ${result.tier} public-web research. Low-confidence entries render dimmed for review.`}
            </p>
            {!result.demo && (
              <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl bg-slate-950 text-white">
                {[
                  [result.people.length, 'people'],
                  [
                    new Set(result.people.map((person) => person.team).filter(Boolean)).size,
                    'teams',
                  ],
                  [result.initiatives.length, 'initiatives'],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={`px-3 py-3 ${index > 0 ? 'border-l border-white/10' : ''}`}
                  >
                    <div className="text-lg font-semibold">{value}</div>
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {result.people.length > 0 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-auto text-xs text-slate-600">
                {result.people.slice(0, 8).map((p, index) => (
                  <li key={`${p.name}-${index}`}>
                    <span className="font-semibold text-slate-800">{p.name}</span>
                    <span className="text-slate-400"> · </span>{p.title}
                  </li>
                ))}
                {result.people.length > 8 && (
                  <li className="text-slate-400">
                    +{result.people.length - 8} more…
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!result && !researching && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Or start with a template
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void createFromTemplate('executive')}
                disabled={!domain.trim() || creating}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-[#b9b2ff] disabled:opacity-50"
              >
                <Building2 size={17} className="mb-2 text-[#5b4cf0]" />
                <span className="block text-sm font-medium">Executive map</span>
                <span className="text-xs text-slate-500">CEO and functional leaders</span>
              </button>
              <button
                onClick={() => void createFromTemplate('buying-committee')}
                disabled={!domain.trim() || creating}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-[#b9b2ff] disabled:opacity-50"
              >
                <Users size={17} className="mb-2 text-[#5b4cf0]" />
                <span className="block text-sm font-medium">Buying committee</span>
                <span className="text-xs text-slate-500">Roles for a live opportunity</span>
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => void create(true)}
            disabled={!domain.trim() || creating}
            className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
          >
            Start blank instead
          </button>
          {result && (
            <button
              onClick={() => void create(false)}
              disabled={creating}
              className="rounded-xl bg-[#5b4cf0] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(91,76,240,.2)] hover:bg-[#4b3ddd] disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Open chart →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
