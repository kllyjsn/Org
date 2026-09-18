import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { computeStrategy, patchStakeholder, renderBrief } from '../lib/accountStrategy';
import type { StrategyOutput } from '../lib/accountStrategy';
import { useFocusTrap } from '../lib/useFocusTrap';
import type {
  AccountStrategyPlan,
  MapEdge,
  Person,
  SellerProfile,
  Stance,
  StrategicInitiative,
  StrategyInsights,
  StrategyTask,
} from '../types';

type Tab = 'Overview' | 'Routes' | 'Stakeholders' | 'Plays' | 'Brief';
const tabs: Tab[] = ['Overview', 'Routes', 'Stakeholders', 'Plays', 'Brief'];
const stances: Stance[] = ['advocate', 'neutral', 'skeptic', 'unknown'];
const changed = (
  plan: AccountStrategyPlan,
  patch: Partial<AccountStrategyPlan>
): AccountStrategyPlan => ({
  ...plan,
  ...patch,
  updatedAt: new Date().toISOString(),
});

interface AccountStrategyModalProps {
  mapId: string | null;
  readOnly: boolean;
  companyName: string | null;
  domain: string;
  people: Person[];
  edges: MapEdge[];
  initiatives: StrategicInitiative[];
  sellerProfile: SellerProfile | null;
  plan: AccountStrategyPlan;
  onUpdatePlan: (plan: AccountStrategyPlan) => void;
  onClose: () => void;
  onFocusPeople: (people: Person[]) => void;
  onOpenDeepResearch: (focus: string) => void;
  onOpenInitiatives: () => void;
}

interface OverviewProps {
  strategy: StrategyOutput;
  insights: StrategyInsights | null;
  loading: boolean;
  error: string;
  account: string;
  onFocusPeople: (people: Person[]) => void;
  onResearch: (focus: string) => void;
  onInitiatives: () => void;
  load: (refresh?: boolean) => void;
}

interface InsightListProps {
  title: string;
  items: { statement: string; provenance: string; evidence: string[] }[];
}

interface RoutesProps {
  strategy: StrategyOutput;
  people: Person[];
  plan: AccountStrategyPlan;
  readOnly: boolean;
  onUpdate: (plan: AccountStrategyPlan) => void;
  onFocusPeople: (people: Person[]) => void;
}

/** Collapsed "from call" marker + expandable verbatim quotes. */
function EvidenceTag({
  evidence,
}: {
  evidence?: import('../types').StanceEvidence[];
}) {
  const [open, setOpen] = useState(false);
  if (!evidence || evidence.length === 0) {
    return (
      <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">
        from call
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 hover:bg-sky-100"
        title="Stance inferred from a call transcript — show quotes"
      >
        from call
      </button>
      {open && (
        <div className="mt-1.5 max-w-[240px] space-y-1">
          {evidence.map((item, index) => (
            <blockquote
              key={index}
              className="border-l-2 border-sky-200 pl-1.5 text-[10px] italic text-slate-500"
              title={`${item.title ?? 'Call'}${item.occurredAt ? ` · ${item.occurredAt.slice(0, 10)}` : ''}`}
            >
              “{item.quote}”
            </blockquote>
          ))}
        </div>
      )}
    </>
  );
}

interface StakeholdersProps {
  strategy: StrategyOutput;
  plan: AccountStrategyPlan;
  readOnly: boolean;
  onUpdate: (
    id: string,
    patch: Partial<{
      stance: Stance;
      nextStep: string;
      note: string;
      stanceSource: 'manual' | 'transcript';
    }>
  ) => void;
  onFocusPeople: (people: Person[]) => void;
}

interface PlaysProps {
  strategy: StrategyOutput;
  plan: AccountStrategyPlan;
  insights: StrategyInsights | null;
  readOnly: boolean;
  customTask: string;
  setCustomTask: (value: string) => void;
  addTask: (task: StrategyTask) => void;
  onUpdate: (plan: AccountStrategyPlan) => void;
}

export default function AccountStrategyModal({
  mapId,
  readOnly,
  companyName,
  domain,
  people,
  edges,
  initiatives,
  sellerProfile,
  plan,
  onUpdatePlan,
  onClose,
  onFocusPeople,
  onOpenDeepResearch,
  onOpenInitiatives,
}: AccountStrategyModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [scope, setScope] = useState<'exec' | 'full'>('exec');
  const [format, setFormat] = useState<'markdown' | 'plain'>('markdown');
  const [insights, setInsights] = useState<StrategyInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [customTask, setCustomTask] = useState('');
  const strategy = useMemo(
    () => computeStrategy({ people, edges, initiatives, sellerProfile, plan }),
    [people, edges, initiatives, sellerProfile, plan]
  );
  const brief = useMemo(
    () =>
      renderBrief({
        companyName,
        domain,
        strategy,
        plan,
        format,
        scope,
        insights,
      }),
    [companyName, domain, strategy, plan, format, scope, insights]
  );
  const account = companyName || domain;
  useFocusTrap(dialogRef);

  useEffect(() => {
    if (mapId)
      void api.trackEvent(mapId, 'strategy_opened').catch(() => undefined);
  }, [mapId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        (event.target as HTMLElement)?.getAttribute('role') === 'tab'
      ) {
        const index = tabs.indexOf(tab);
        setTab(
          tabs[
            (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
              tabs.length
          ]
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, tab]);
  const loadInsights = async (refresh = false) => {
    if (!mapId) return;
    setLoading(true);
    setError('');
    try {
      setInsights(await api.getStrategyInsights(mapId, refresh));
    } catch {
      setError('AI strategy insights are unavailable right now.');
    } finally {
      setLoading(false);
    }
  };
  const updateStakeholder = (
    id: string,
    patch: Partial<{
      stance: Stance;
      nextStep: string;
      note: string;
      stanceSource: 'manual' | 'transcript';
    }>
  ) => {
    onUpdatePlan(patchStakeholder(plan, id, patch));
  };
  const addTask = (task: StrategyTask) =>
    onUpdatePlan(changed(plan, { tasks: [...plan.tasks, task] }));
  const gradeColor =
    strategy.health.grade === 'A'
      ? 'text-emerald-300'
      : strategy.health.grade === 'B'
        ? 'text-[#c9f04b]'
        : strategy.health.grade === 'C'
          ? 'text-amber-300'
          : 'text-rose-300';
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-strategy-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-[#f6f7f2] shadow-2xl sm:max-w-5xl sm:rounded-3xl"
      >
        <header className="relative overflow-hidden bg-slate-950 p-5 text-white sm:p-7">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#5b4cf0]/35 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-[#c9f04b]">
                <Sparkles size={13} /> Evidence into action
              </div>
              <h2
                id="account-strategy-title"
                className="text-3xl font-semibold tracking-[-0.045em]"
              >
                Account strategy
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {account} · {domain}
              </p>
              <p className="mt-4 text-sm text-slate-300">
                {strategy.entry?.name ?? 'No entry'}{' '}
                <ArrowRight className="mx-1 inline" size={14} />{' '}
                {strategy.target?.name ?? 'No target'}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-4 border-[#5b4cf0] bg-white/5">
                <span className={`text-2xl font-semibold ${gradeColor}`}>
                  {strategy.health.score}
                </span>
                <span className="text-[10px] uppercase text-slate-400">
                  Grade {strategy.health.grade}
                </span>
              </div>
              <button
                aria-label="Close strategy"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </header>
        <nav
          role="tablist"
          aria-label="Account strategy sections"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 pt-3 sm:px-7"
        >
          {tabs.map((item) => (
            <button
              key={item}
              id={`account-strategy-tab-${item.toLowerCase()}`}
              role="tab"
              aria-selected={tab === item}
              aria-controls="account-strategy-panel"
              onClick={() => setTab(item)}
              className={`whitespace-nowrap border-b-2 px-3 pb-3 text-xs font-semibold ${tab === item ? 'border-[#5b4cf0] text-[#5b4cf0]' : 'border-transparent text-slate-400'}`}
            >
              {item}
            </button>
          ))}
        </nav>
        <main
          id="account-strategy-panel"
          role="tabpanel"
          aria-labelledby={`account-strategy-tab-${tab.toLowerCase()}`}
          tabIndex={0}
          className="p-4 sm:p-7"
        >
          {tab === 'Overview' && (
            <Overview
              strategy={strategy}
              insights={insights}
              loading={loading}
              error={error}
              account={account}
              onFocusPeople={onFocusPeople}
              onResearch={onOpenDeepResearch}
              onInitiatives={onOpenInitiatives}
              load={loadInsights}
            />
          )}
          {tab === 'Routes' && (
            <Routes
              strategy={strategy}
              people={people}
              plan={plan}
              readOnly={readOnly}
              onUpdate={onUpdatePlan}
              onFocusPeople={onFocusPeople}
            />
          )}
          {tab === 'Stakeholders' && (
            <Stakeholders
              strategy={strategy}
              plan={plan}
              readOnly={readOnly}
              onUpdate={updateStakeholder}
              onFocusPeople={onFocusPeople}
            />
          )}
          {tab === 'Plays' && (
            <Plays
              strategy={strategy}
              plan={plan}
              insights={insights}
              readOnly={readOnly}
              customTask={customTask}
              setCustomTask={setCustomTask}
              addTask={addTask}
              onUpdate={onUpdatePlan}
            />
          )}
          {tab === 'Brief' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  values={['exec', 'full']}
                  value={scope}
                  onChange={setScope}
                />
                <Toggle
                  values={['markdown', 'plain']}
                  value={format}
                  onChange={setFormat}
                />
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(brief);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([brief], {
                        type:
                          format === 'markdown'
                            ? 'text/markdown'
                            : 'text/plain',
                      })
                    );
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${domain}-account-strategy.${
                      format === 'markdown' ? 'md' : 'txt'
                    }`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <Download size={14} /> Download
                </button>
              </div>
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-700 td-card-shadow">
                {brief}
              </pre>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function Toggle<T extends string>({
  values,
  value,
  onChange,
}: {
  values: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-xs">
      {values.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={`rounded-md px-3 py-1.5 ${value === item ? 'bg-slate-950 text-white' : 'text-slate-500'}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Overview({
  strategy,
  insights,
  loading,
  error,
  account,
  onFocusPeople,
  onResearch,
  onInitiatives,
  load,
}: OverviewProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {strategy.health.items.map((item) => (
          <div
            key={item.key}
            className={`rounded-2xl border p-4 text-left td-card-shadow ${item.status === 'good' ? 'border-emerald-200 bg-emerald-50' : item.status === 'partial' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50'}`}
          >
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">
              <button
                type="button"
                onClick={() =>
                  item.personIds?.length &&
                  onFocusPeople(
                    strategy.keyPeople.filter((person) =>
                      item.personIds?.includes(person.id)
                    )
                  )
                }
                className="text-left"
              >
                {item.label}
                <span className="sr-only">: {item.detail}</span>
              </button>
              {item.status === 'missing' &&
                (item.key === 'champion' || item.key === 'economic_buyer') && (
                  <button
                    type="button"
                    onClick={() =>
                      onResearch(`Who is the ${item.label} at ${account}?`)
                    }
                    className="text-[#5b4cf0]"
                  >
                    Research
                  </button>
                )}
            </div>
            <p className="mt-2 text-xs text-slate-600">{item.detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-slate-950 p-5 text-white">
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#c9f04b]">
            Risks
          </div>
          <div className="mt-3 space-y-3">
            {strategy.risks.length ? (
              strategy.risks.map((risk) => (
                <div key={risk.id}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] uppercase ${risk.severity === 'high' ? 'bg-rose-400/20 text-rose-300' : risk.severity === 'medium' ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-400/20 text-slate-300'}`}
                    >
                      {risk.severity}
                    </span>
                    {risk.title}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {risk.mitigation}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">
                No material risks detected.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 td-card-shadow">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#5b4cf0]">
                Why now
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Initiatives anchoring the next conversation.
              </p>
            </div>
            <button
              onClick={onInitiatives}
              className="text-xs font-semibold text-[#5b4cf0]"
            >
              All initiatives
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {strategy.initiatives.map((item) => (
              <div
                key={item.name}
                className="rounded-xl bg-slate-50 p-3 text-xs"
              >
                <b>{item.name}</b>
                <p className="mt-1 text-slate-500">{item.summary}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#5b4cf0]">
            AI strategy insights
          </div>
          {insights ? (
            <button
              onClick={() => load(true)}
              className="text-xs font-semibold text-[#5b4cf0]"
            >
              Refresh
            </button>
          ) : (
            <button
              onClick={() => load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white"
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              Generate AI insights
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-rose-700">{error}</p>}
        {insights && (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {insights.executiveSummary}
            </p>
            <InsightList title="Win themes" items={insights.winThemes} />
            <InsightList
              title="Competitive watch"
              items={insights.competitiveWatch}
            />
          </>
        )}
      </section>
    </div>
  );
}
function InsightList({ title, items }: InsightListProps) {
  return (
    <div className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">
        {title}
      </div>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div
            key={`${item.statement}-${index}`}
            className="flex gap-2 text-xs text-slate-700"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${item.provenance === 'sourced' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
            >
              {item.provenance}
            </span>
            <span>
              {item.statement}
              {item.evidence[0] && (
                <a
                  className="ml-2 text-[#5b4cf0]"
                  href={item.evidence[0]}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="inline" size={11} />
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Routes({
  strategy,
  people,
  plan,
  readOnly,
  onUpdate,
  onFocusPeople,
}: RoutesProps) {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {(['entryPersonId', 'targetPersonId'] as const).map((key) => (
          <label key={key} className="text-xs font-semibold text-slate-600">
            {key === 'entryPersonId' ? 'Entry person' : 'Target person'}
            <select
              disabled={readOnly}
              value={plan[key] ?? ''}
              onChange={(event) =>
                onUpdate(changed(plan, { [key]: event.target.value || null }))
              }
              className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">
                Auto —{' '}
                {key === 'entryPersonId'
                  ? (strategy.entry?.name ?? 'none')
                  : (strategy.target?.name ?? 'none')}
              </option>
              {sorted.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.title}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <section className="rounded-2xl bg-slate-950 p-5 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#c9f04b]">
          Primary path · {strategy.primaryPath.strength}/100
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {strategy.primaryPath.people.map((person, index) => (
            <div key={person.id} className="contents">
              {index > 0 && <ArrowRight size={14} className="text-slate-500" />}
              <button
                onClick={() => onFocusPeople([person])}
                className="rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-left"
              >
                <span className="block text-sm font-semibold">
                  {person.name}
                </span>
                <span className="block max-w-44 truncate text-[10px] text-slate-400">
                  {person.title}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#c9f04b]"
            style={{ width: `${strategy.primaryPath.strength}%` }}
          />
        </div>
      </section>
      <div className="space-y-2">
        {strategy.routes.map((route) => (
          <div
            key={route.target.id}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-900">
                {route.label} · {route.path.strength}/100
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {route.path.people.map((person) => person.name).join(' → ') ||
                  'No supported path'}
              </div>
            </div>
            <button
              onClick={() =>
                onUpdate(changed(plan, { targetPersonId: route.target.id }))
              }
              disabled={readOnly}
              className="rounded-lg bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Use as target
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function Stakeholders({
  strategy,
  plan,
  readOnly,
  onUpdate,
  onFocusPeople,
}: StakeholdersProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white td-card-shadow">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="p-3">Stakeholder</th>
            <th className="p-3">Role</th>
            <th className="p-3">Stance</th>
            <th className="p-3">Next step</th>
            <th className="p-3">Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {strategy.keyPeople.map((person) => {
            const value = plan.stakeholders[person.id] ?? {
              stance: 'unknown' as Stance,
              nextStep: '',
              note: '',
            };
            return (
              <tr key={person.id} className="border-t border-slate-100">
                <td className="p-3">
                  <button
                    onClick={() => onFocusPeople([person])}
                    className="text-left font-semibold text-slate-900"
                  >
                    {person.name}
                    <span className="block font-normal text-slate-400">
                      {person.title}
                    </span>
                  </button>
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] text-violet-700">
                    {person.role}
                  </span>
                </td>
                <td className="p-3">
                  <select
                    disabled={readOnly}
                    value={value.stance}
                    onChange={(event) =>
                      onUpdate(person.id, {
                        stance: event.target.value as Stance,
                      })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  >
                    {stances.map((stance) => (
                      <option key={stance}>{stance}</option>
                    ))}
                  </select>
                  {value.stanceSource === 'transcript' && (
                    <EvidenceTag evidence={value.evidence} />
                  )}
                </td>
                <td className="p-3">
                  <input
                    disabled={readOnly}
                    value={value.nextStep}
                    onChange={(event) =>
                      onUpdate(person.id, { nextStep: event.target.value })
                    }
                    className="w-44 rounded-lg border border-slate-200 px-2 py-1"
                    placeholder="Map next step"
                  />
                </td>
                <td className="p-3">
                  <input
                    disabled={readOnly}
                    value={value.note}
                    onChange={(event) =>
                      onUpdate(person.id, { note: event.target.value })
                    }
                    className="w-44 rounded-lg border border-slate-200 px-2 py-1"
                    placeholder="Context"
                  />
                </td>
                <td className="p-3">
                  <button
                    onClick={() => onFocusPeople([person])}
                    className="text-[#5b4cf0]"
                  >
                    Focus
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function Plays({
  strategy,
  plan,
  insights,
  readOnly,
  customTask,
  setCustomTask,
  addTask,
  onUpdate,
}: PlaysProps) {
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <input
          value={customTask}
          onChange={(event) => setCustomTask(event.target.value)}
          disabled={readOnly}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Add a custom play"
        />
        <button
          disabled={readOnly || !customTask.trim()}
          onClick={() => {
            addTask({
              id: `manual-${Date.now()}`,
              title: customTask.trim(),
              done: false,
              source: 'manual',
              createdAt: new Date().toISOString(),
            });
            setCustomTask('');
          }}
          className="rounded-xl bg-[#5b4cf0] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus size={14} className="inline" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {plan.tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
          >
            <input
              type="checkbox"
              disabled={readOnly}
              checked={task.done}
              onChange={(event) =>
                onUpdate(
                  changed(plan, {
                    tasks: plan.tasks.map((item) =>
                      item.id === task.id
                        ? { ...item, done: event.target.checked }
                        : item
                    ),
                  })
                )
              }
            />
            <span
              className={`flex-1 text-sm ${task.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}
            >
              {task.title}
            </span>
            <button
              disabled={readOnly}
              onClick={() =>
                onUpdate(
                  changed(plan, {
                    tasks: plan.tasks.filter((item) => item.id !== task.id),
                  })
                )
              }
              className="text-slate-400 hover:text-rose-600"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {strategy.suggestedTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-xl border border-dashed border-violet-200 bg-violet-50 p-3"
          >
            <span className="flex-1 text-sm text-slate-700">{task.title}</span>
            <button
              disabled={readOnly}
              onClick={() =>
                addTask({
                  ...task,
                  createdAt: new Date().toISOString(),
                })
              }
              className="rounded-lg bg-[#5b4cf0] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
        ))}
      </div>
      {insights && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-slate-700">
              AI landing plays
            </h3>
            {insights.landingPlays.map((play) => (
              <div
                key={play.title}
                className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"
              >
                <b>{play.title}</b>
                <p className="mt-1 text-slate-500">{play.rationale}</p>
              </div>
            ))}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-slate-700">
              Mutual action plan
            </h3>
            {insights.mutualActionPlan.map((item) => (
              <div
                key={item.milestone}
                className="mt-2 flex justify-between gap-2 text-xs"
              >
                <span>{item.milestone}</span>
                <span className="text-slate-400">
                  {item.owner} · {item.timing}
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
