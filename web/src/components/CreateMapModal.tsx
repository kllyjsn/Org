import { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, Search, Sparkles, Users, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { overlayTransition, overlayVariants, sheetVariants } from '../lib/motion';
import { api, ApiError } from '../api';
import { stateFromResearch } from '../lib/layout';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { MapState, Person, ResearchResult } from '../types';

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

const STAGES = [
  'Scanning leadership, product, and team pages…',
  'Following evidence across the public web…',
  'Resolving teams, titles, and reporting lines…',
  'Connecting recent initiatives to the org…',
];

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
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<number | null>(null);
  const researchStartedAt = useRef<string | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    if (!researching) return;
    timer.current = window.setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      9_000
    );
    const elapsedTimer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1_000
    );
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      window.clearInterval(elapsedTimer);
    };
  }, [researching]);

  const research = async () => {
    setError(null);
    setResult(null);
    setResearching(true);
    setStage(0);
    setElapsed(0);
    researchStartedAt.current = new Date().toISOString();
    try {
      const r = await api.research(
        domain.trim(),
        undefined,
        undefined,
        workspaceId
      );
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'research failed');
    } finally {
      setResearching(false);
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
    <motion.div
      variants={overlayVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={overlayTransition}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-map-modal-title"
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-sheet p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-brand">
            <Sparkles size={14} />
            New intelligence map
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-9 sm:w-9"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <h2
          id="create-map-modal-title"
          className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
        >
          Map the whole account.
        </h2>
        <p className="mb-6 mt-2 max-w-md text-sm leading-6 text-slate-500">
          Start with a domain. TopDown researches people, teams, reporting
          lines, and the initiatives shaping their priorities.
        </p>

        <div className="flex rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
          <input
            autoFocus
            className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none"
            placeholder="acme.com"
            aria-label="Company domain"
            autoComplete="off"
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
            className="flex shrink-0 items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
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
          <div
            role="status"
            className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-4 text-white"
          >
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span>Live research</span>
              <span>{stage + 1} / {STAGES.length} · {elapsed}s</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={STAGES.length}
              aria-valuenow={stage + 1}
              className="mb-3 h-1 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-500"
                style={{ transform: `scaleX(${(stage + 0.5) / STAGES.length})` }}
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin text-accent" />
              {STAGES[stage]}
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
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
          <div
            role="alert"
            className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
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
                className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-line disabled:opacity-50"
              >
                <Building2 size={17} className="mb-2 text-brand" />
                <span className="block text-sm font-medium">Executive map</span>
                <span className="text-xs text-slate-500">CEO and functional leaders</span>
              </button>
              <button
                onClick={() => void createFromTemplate('buying-committee')}
                disabled={!domain.trim() || creating}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-line disabled:opacity-50"
              >
                <Users size={17} className="mb-2 text-brand" />
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
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-cta hover:bg-brand-deep disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Open chart →'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
