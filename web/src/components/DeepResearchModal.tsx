import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Loader2, Search, Sparkles, UsersRound, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { Person, ResearchResult } from '../types';

const STAGES = [
  'Scanning company and public profiles…',
  'Following names into teams and reporting lines…',
  'Checking titles against recent evidence…',
  'Resolving the strongest additions…',
];

export default function DeepResearchModal({
  domain,
  mapId,
  workspaceId,
  people,
  selected,
  initialFocus,
  knownSources,
  onClose,
  onMerge,
}: {
  domain: string;
  mapId?: string;
  workspaceId?: string;
  people: Person[];
  selected: Person | null;
  initialFocus?: string;
  knownSources?: string[];
  onClose: () => void;
  onMerge: (result: ResearchResult) => { added: number; enriched: number };
}) {
  const [focus, setFocus] = useState(initialFocus || selected?.name || '');
  const [researching, setResearching] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState('');
  const [merged, setMerged] = useState('');
  const timer = useRef<number | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    if (!researching) return;
    timer.current = window.setInterval(
      () => setStage((value) => (value + 1) % STAGES.length),
      1_800
    );
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [researching]);

  const suggestions = useMemo(() => {
    const values = [
      selected?.name,
      ...people.map((person) => person.team),
      ...people.map((person) => person.department),
      'More leaders across the company',
    ].filter((value): value is string => Boolean(value?.trim()));
    return Array.from(new Set(values)).slice(0, 6);
  }, [people, selected]);

  const run = async (fullAccount = false) => {
    if (!fullAccount && !focus.trim()) return;
    setResearching(true);
    setResult(null);
    setMerged('');
    setError('');
    setStage(0);
    try {
      setResult(
        await api.research(
          domain,
          fullAccount ? undefined : focus.trim(),
          fullAccount ? knownSources : undefined,
          workspaceId
        )
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Deep research failed. Try a narrower person or team.'
      );
    } finally {
      setResearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deep-research-modal-title"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-sheet p-5 shadow-2xl sm:rounded-[28px] sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
              <Sparkles size={13} />
              Targeted enrichment
            </div>
            <h2
              id="deep-research-modal-title"
              className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
            >
              Deepen this account.
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              Research a person, team, department, or gap. New evidence merges
              into this map without rebuilding it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-9 sm:w-9"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
          <div className="flex items-center gap-2 px-3 py-2">
            <Search size={17} className="shrink-0 text-brand" />
            <input
              autoFocus
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !researching) void run();
              }}
              placeholder="Payments team, security leadership, or a person…"
              aria-label="Deep research focus"
              disabled={researching}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 focus-visible:!outline-none"
            />
          </div>
          <button
            onClick={() => void run()}
            disabled={!focus.trim() || researching}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {researching ? (
              <Loader2 size={15} className="animate-spin text-accent" />
            ) : (
              <Sparkles size={15} className="text-accent" />
            )}
            {researching ? 'Researching the public web…' : 'Run deep research'}
          </button>
        </div>

        {!researching && !result && (
          <div className="mt-4">
            <button
              onClick={() => void run(true)}
              className="mb-3 w-full rounded-xl border border-brand-line bg-brand-soft px-3 py-2 text-xs font-semibold text-brand-text transition hover:bg-brand-softer"
            >
              Refresh the entire account against current public sources
            </button>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setFocus(suggestion)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand-line hover:text-brand-text"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {researching && (
          <div
            role="status"
            className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-4 text-white"
          >
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span>Deep research · {domain}</span>
              <span>{stage + 1} / {STAGES.length}</span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
              />
            </div>
            <p className="flex items-center gap-2 text-sm text-slate-200">
              <Loader2 size={14} className="animate-spin text-accent" />
              {STAGES[stage]}
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white td-card-shadow">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  {result.people.length} evidence-backed matches
                </p>
                <p className="text-xs text-slate-500">
                  {result.provider} · public-web research
                </p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                <Building2 size={11} /> {domain}
              </span>
            </div>
            <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {result.people.map((person, index) => (
                <div key={`${person.name}-${index}`} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <UsersRound size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {person.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[person.title, person.team || person.department]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              ))}
              {result.people.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  No people were verifiable for that focus. Try a broader team
                  or department.
                </p>
              )}
            </div>
            {result.people.length > 0 && (
              <div className="border-t border-slate-100 p-3">
                <button
                  onClick={() => {
                    const summary = onMerge(result);
                    if (mapId) {
                      void api
                        .trackEvent(mapId, 'deep_research_completed', {
                          addedCount: summary.added,
                          enrichedCount: summary.enriched,
                        })
                        .catch(() => undefined);
                    }
                    setMerged(
                      `Added ${summary.added}; enriched ${summary.enriched}.`
                    );
                  }}
                  disabled={Boolean(merged)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:bg-emerald-600"
                >
                  <Sparkles size={15} />
                  {merged || 'Merge into this map'}
                </button>
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-[10px] text-slate-400">
          Only publicly supported people are added. Inferred team assignments
          stay visibly labeled.
        </p>
      </div>
    </div>
  );
}
