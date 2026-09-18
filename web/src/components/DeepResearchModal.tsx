import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Loader2, Search, Sparkles, UsersRound, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Person, ResearchEvent, ResearchResult } from '../types';

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
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ResearchEvent | null>(null);
  const [partial, setPartial] = useState<ResearchResult | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState('');
  const [merged, setMerged] = useState('');
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      unsubscribe.current?.();
    };
  }, []);

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
    setPartial(null);
    setLastEvent(null);
    setJobId(null);
    setMerged('');
    setError('');
    try {
      const { jobId: nextJobId } = await api.startResearch(
        domain,
        fullAccount ? undefined : focus.trim(),
        fullAccount ? knownSources : undefined,
        workspaceId
      );
      setJobId(nextJobId);
      unsubscribe.current = api.subscribeResearch(nextJobId, {
        onEvent: setLastEvent,
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
      setError(
        err instanceof ApiError
          ? err.message
          : 'Deep research failed. Try a narrower person or team.'
      );
      setResearching(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    try {
      await api.cancelResearch(jobId);
      setResearching(false);
      setJobId(null);
      unsubscribe.current?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to cancel research');
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-[#f9faf7] p-5 shadow-2xl sm:rounded-[28px] sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Sparkles size={13} />
              Targeted enrichment
            </div>
            <h2 className="text-3xl font-semibold tracking-[-0.045em] text-slate-950">
              Deepen this account.
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              Research a person, team, department, or gap. New evidence merges
              into this map without rebuilding it.
            </p>
          </div>
          <button            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-[#5b4cf0] focus-within:ring-4 focus-within:ring-[#5b4cf0]/10">
          <div className="flex items-center gap-2 px-3 py-2">
            <Search size={17} className="shrink-0 text-[#5b4cf0]" />
            <input
              autoFocus
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !researching) void run();
              }}
              placeholder="Payments team, security leadership, or a person…"
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
              <Loader2 size={15} className="animate-spin text-[#c9f04b]" />
            ) : (
              <Sparkles size={15} className="text-[#c9f04b]" />
            )}
            {researching ? 'Researching the public web…' : 'Run deep research'}
          </button>
        </div>

        {!researching && !result && (
          <div className="mt-4">
            <button
              onClick={() => void run(true)}
              className="mb-3 w-full rounded-xl border border-[#b9b2ff] bg-[#eeecff] px-3 py-2 text-xs font-semibold text-[#5144d7] transition hover:bg-[#e4e0ff]"
            >
              Refresh the entire account against current public sources
            </button>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setFocus(suggestion)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-[#b9b2ff] hover:text-[#5144d7]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {researching && (
          <div className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-4 text-white">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span>Deep research · {domain}</span>
              <span>
                {partial?.people.length ?? 0} people ·{' '}
                {new Set(
                  (partial?.people ?? []).flatMap((person) => person.sources)
                ).size}{' '}
                sources found
              </span>
            </div>
            <p className="text-sm text-slate-200">
              {lastEvent?.message ?? 'Starting research…'}
            </p>
            <button
              onClick={() => void cancel()}
              className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
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
              <span className="flex items-center gap-1 rounded-full bg-[#effbd0] px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                <Building2 size={11} /> {domain}
              </span>
            </div>
            <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {result.people.map((person, index) => (
                <div key={`${person.name}-${index}`} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eeecff] text-[#5b4cf0]">
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
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5b4cf0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4b3ddd] disabled:bg-emerald-600"
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
