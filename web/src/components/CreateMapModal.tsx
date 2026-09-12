import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { api, ApiError } from '../api';
import { stateFromResearch } from '../lib/layout';
import type { ResearchResult } from '../types';

const STAGES = [
  'Searching leadership pages and public sources…',
  'Cross-checking titles and reporting lines…',
  'Structuring the org chart…',
  'Laying out the canvas…',
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
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!researching) return;
    timer.current = window.setInterval(
      () => setStage((s) => (s + 1) % STAGES.length),
      1800
    );
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [researching]);

  const research = async () => {
    setError(null);
    setResult(null);
    setResearching(true);
    setStage(0);
    try {
      const r = await api.research(domain.trim());
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
      const { id } = await api.createMap(workspaceId, name, d, state);
      onCreated(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create map');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New account map</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          Paste a company domain — we research the org from public sources and
          draft the chart. No integrations needed.
        </p>

        <div className="flex gap-2">
          <input
            autoFocus
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
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
          <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            <span className="mr-2 inline-block animate-pulse">●</span>
            {STAGES[stage]}
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <Sparkles size={15} />
              {result.demo
                ? 'Demo chart loaded — no LLM key configured'
                : `Found ${result.people.length} people at ${result.companyName || result.domain}`}
            </div>
            <p className="mt-1 text-xs text-emerald-700">
              {result.demo
                ? 'Set OPENROUTER_API_KEY, PERPLEXITY_API_KEY, or GEMINI_API_KEY to research real orgs.'
                : `${result.provider[0].toUpperCase() + result.provider.slice(1)} · ${result.tier} public-web research. Low-confidence entries render dimmed for review.`}
            </p>
            {result.people.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-slate-600">
                {result.people.slice(0, 8).map((p) => (
                  <li key={p.name}>
                    <span className="font-medium">{p.name}</span> — {p.title}
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
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Open chart →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
