import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useSession } from '../store';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type {
  DealStage,
  PortfolioResponse,
  PortfolioRow,
  RiskFlag,
} from '../types';

const STAGES: DealStage[] = [
  'discovery',
  'evaluation',
  'proposal',
  'negotiation',
  'closed',
];
const RISK_LABELS: Record<RiskFlag, string> = {
  single_threaded: 'Single-threaded',
  coverage_gap: 'Coverage gap',
  no_economic_buyer: 'No econ buyer',
  stale_30d: 'Stale 30d',
};
const BAND_STYLE: Record<string, string> = {
  strong: 'bg-emerald-50 text-emerald-700',
  moderate: 'bg-amber-50 text-amber-700',
  weak: 'bg-rose-50 text-rose-700',
};

function band(score: number) {
  return score >= 70 ? 'strong' : score >= 40 ? 'moderate' : 'weak';
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

type SortKey = 'name' | 'stage' | 'score' | 'threads' | 'gap' | 'activity';

export default function PortfolioPage() {
  useDocumentTitle('Portfolio');
  const navigate = useNavigate();
  const { workspaces, workspaceId } = useSession();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveOnly, setLiveOnly] = useState(true);
  const [stageFilter, setStageFilter] = useState<DealStage | ''>('');
  const [flagFilter, setFlagFilter] = useState<Set<RiskFlag>>(new Set());
  const [sort, setSort] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setData(await api.getPortfolio(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows;
    if (liveOnly) list = list.filter((r) => r.isLiveOpportunity);
    if (stageFilter) list = list.filter((r) => r.stage === stageFilter);
    if (flagFilter.size > 0) {
      list = list.filter((r) =>
        r.riskFlags.some((f) => flagFilter.has(f))
      );
    }
    const key = (r: PortfolioRow): number | string => {
      switch (sort) {
        case 'name':
          return r.name.toLowerCase();
        case 'stage':
          return STAGES.indexOf(r.stage);
        case 'threads':
          return r.coverage.threadCount;
        case 'gap':
          return r.gap;
        case 'activity':
          return r.lastActivityAt ?? '';
        default:
          return r.coverage.score;
      }
    };
    // default: live first, then coverage asc
    return [...list].sort((a, b) => {
      if (sort === 'score' && a.isLiveOpportunity !== b.isLiveOpportunity) {
        return a.isLiveOpportunity ? -1 : 1;
      }
      const ka = key(a);
      const kb = key(b);
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }, [data, liveOnly, stageFilter, flagFilter, sort, sortAsc]);

  const toggleSort = (next: SortKey) => {
    if (sort === next) setSortAsc(!sortAsc);
    else {
      setSort(next);
      setSortAsc(true);
    }
  };

  const setOutcome = async (
    row: PortfolioRow,
    patch: { outcome?: 'open' | 'won' | 'lost'; stage?: DealStage }
  ) => {
    if (
      patch.outcome &&
      patch.outcome !== 'open' &&
      !window.confirm(`Mark ${row.name} as ${patch.outcome}?`)
    ) {
      return;
    }
    await api.setOutcome(row.id, {
      outcome: patch.outcome ?? row.outcome,
      stage: patch.stage !== undefined ? patch.stage : row.stage,
    });
    await load();
  };

  const summary = data?.summary;
  const closed = summary
    ? Object.values(summary.winLoss.byBand).reduce(
        (n, b) => n + b.won + b.lost,
        0
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#f9faf7] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => navigate('/app')}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={13} /> Back to maps
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          {workspace?.name ?? 'Workspace'} portfolio
        </h1>
        {error && (
          <p className="mt-2 text-sm text-rose-600">{error}</p>
        )}
        {!data ? (
          <Loader2 className="mt-8 animate-spin text-slate-400" size={20} />
        ) : (
          <>
            {summary && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ['Live opps', summary.live],
                  ['At-risk live', summary.atRiskLive],
                  ['Single-threaded', summary.singleThreaded],
                  ['Coverage gaps', summary.withGaps],
                  [
                    'Bands',
                    `${summary.byBand.strong}/${summary.byBand.moderate}/${summary.byBand.weak}`,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="text-lg font-semibold text-slate-900">
                      {value}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {summary && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Win rate by coverage band
                </div>
                {closed < 3 ? (
                  <p className="text-xs text-slate-400">
                    Not enough closed deals yet ({closed}).
                  </p>
                ) : (
                  <div className="flex gap-4">
                    {(['strong', 'moderate', 'weak'] as const).map((b) => {
                      const w = summary.winLoss.byBand[b];
                      return (
                        <div key={b} className="text-xs">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${BAND_STYLE[b]}`}
                          >
                            {b}
                          </span>
                          <div className="mt-1 text-slate-600">
                            {w.won}W / {w.lost}L
                            {w.winRate !== null && (
                              <span className="ml-1 font-semibold">
                                {Math.round(w.winRate * 100)}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={liveOnly}
                  onChange={(e) => setLiveOnly(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Live only
              </label>
              <select
                value={stageFilter}
                onChange={(e) =>
                  setStageFilter((e.target.value || '') as DealStage | '')
                }
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {(Object.keys(RISK_LABELS) as RiskFlag[]).map((f) => (
                <button
                  key={f}
                  onClick={() =>
                    setFlagFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(f)) next.delete(f);
                      else next.add(f);
                      return next;
                    })
                  }
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    flagFilter.has(f)
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {RISK_LABELS[f]}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <p className="mt-8 text-sm text-slate-400">
                No maps match. Create a map or loosen the filters.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                      {(
                        [
                          ['name', 'Account'],
                          ['stage', 'Stage'],
                          ['score', 'Coverage'],
                          [null, 'Roles'],
                          ['threads', 'Threads'],
                          ['gap', 'Known'],
                          [null, 'Untouched'],
                          ['activity', 'Activity'],
                          [null, 'Amount / close'],
                          [null, 'Outcome'],
                        ] as [SortKey | null, string][]
                      ).map(([key, label]) => (
                        <th key={label} className="px-3 py-2">
                          {key ? (
                            <button
                              onClick={() => toggleSort(key)}
                              className="uppercase tracking-wide hover:text-slate-700"
                            >
                              {label}
                              {sort === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                            </button>
                          ) : (
                            label
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const b = band(row.coverage.score);
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              to={`/app/maps/${row.id}`}
                              className="font-medium text-indigo-600 hover:underline"
                            >
                              {row.name}
                            </Link>
                            {row.companyName && (
                              <div className="text-[10px] text-slate-400">
                                {row.companyName}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.stage}
                              onChange={(e) =>
                                void setOutcome(row, {
                                  stage: e.target.value as DealStage,
                                })
                              }
                              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]"
                            >
                              {STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${BAND_STYLE[b]}`}
                            >
                              {row.coverage.score} {b}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2"
                            title={
                              row.coverage.missingRoles.length
                                ? `Missing: ${row.coverage.missingRoles.join(', ')}`
                                : 'All key roles covered'
                            }
                          >
                            {row.coverage.coveredCount}/3
                          </td>
                          <td className="px-3 py-2">{row.coverage.threadCount}</td>
                          <td
                            className={`px-3 py-2 ${row.gap > 0 ? 'font-semibold text-rose-600' : ''}`}
                          >
                            {row.knownPeople} / {row.expectedKnown}
                          </td>
                          <td className="px-3 py-2">{row.untouchedKeyCount}</td>
                          <td className="px-3 py-2">{ago(row.lastActivityAt)}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {row.amount !== null
                              ? `$${row.amount.toLocaleString()}`
                              : ''}
                            {row.amount !== null && row.closeDate ? ' · ' : ''}
                            {row.closeDate ?? ''}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.outcome}
                              onChange={(e) =>
                                void setOutcome(row, {
                                  outcome: e.target.value as
                                    | 'open'
                                    | 'won'
                                    | 'lost',
                                })
                              }
                              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]"
                            >
                              <option value="open">open</option>
                              <option value="won">won</option>
                              <option value="lost">lost</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
