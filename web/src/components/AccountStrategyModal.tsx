import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { overlayTransition, overlayVariants, sheetVariants } from '../lib/motion';
import {
  ArrowRight,
  Check,
  Copy,
  Route,
  ShieldQuestion,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  personProductFit,
  sellerBuyingFunctionLabel,
} from '../lib/accountFit';
import { useFocusTrap } from '../lib/useFocusTrap';
import type {
  MapEdge,
  Person,
  SellerProfile,
  StrategicInitiative,
} from '../types';

const ROLE_PRIORITY: Record<Person['role'], number> = {
  champion: 100,
  influencer: 75,
  technical_buyer: 65,
  decision_maker: 55,
  economic_buyer: 50,
  blocker: 10,
  none: 0,
};

const TARGET_PRIORITY: Record<Person['role'], number> = {
  economic_buyer: 100,
  decision_maker: 90,
  technical_buyer: 70,
  champion: 40,
  influencer: 30,
  blocker: 10,
  none: 0,
};

function personScore(
  person: Person,
  priorities: Record<Person['role'], number>,
  sellerProfile: SellerProfile | null
) {
  const executive = /\b(chief|ceo|cto|cio|cfo|coo|president|vp|vice president|head)\b/i.test(
    person.title
  )
    ? 18
    : 0;
  return (
    priorities[person.role ?? 'none'] +
    personProductFit(person, sellerProfile) +
    executive +
    Math.min((person.sources ?? []).length, 5) * 2 +
    (person.confidence === 'high' ? 8 : person.confidence === 'medium' ? 4 : 0)
  );
}

function strongestPath(
  people: Person[],
  edges: MapEdge[],
  startId: string,
  targetId: string
): { people: Person[]; inferredHops: number } {
  if (startId === targetId) {
    return {
      people: people.filter((person) => person.id === startId),
      inferredHops: 0,
    };
  }
  const byId = new Map(people.map((person) => [person.id, person]));
  const adjacency = new Map<string, { id: string; cost: number }[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const cost =
      edge.kind === 'influence' ? 1 : edge.inferred ? 2.2 : 1.4;
    adjacency.set(edge.from, [
      ...(adjacency.get(edge.from) ?? []),
      { id: edge.to, cost },
    ]);
    adjacency.set(edge.to, [
      ...(adjacency.get(edge.to) ?? []),
      { id: edge.from, cost },
    ]);
  }

  const distances = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, string>();
  const remaining = new Set(people.map((person) => person.id));
  while (remaining.size > 0) {
    const current = [...remaining].sort(
      (a, b) =>
        (distances.get(a) ?? Number.POSITIVE_INFINITY) -
        (distances.get(b) ?? Number.POSITIVE_INFINITY)
    )[0];
    if (!current || !Number.isFinite(distances.get(current) ?? Infinity)) break;
    remaining.delete(current);
    if (current === targetId) break;
    for (const next of adjacency.get(current) ?? []) {
      const distance = (distances.get(current) ?? 0) + next.cost;
      if (distance < (distances.get(next.id) ?? Number.POSITIVE_INFINITY)) {
        distances.set(next.id, distance);
        previous.set(next.id, current);
      }
    }
  }
  if (!previous.has(targetId)) return { people: [], inferredHops: 0 };
  const ids = [targetId];
  while (ids[0] !== startId) ids.unshift(previous.get(ids[0])!);
  const inferredHops = ids.slice(1).filter((id, index) => {
    const prior = ids[index];
    return edges.find(
      (edge) =>
        ((edge.from === prior && edge.to === id) ||
          (edge.from === id && edge.to === prior)) &&
        edge.inferred
    );
  }).length;
  return {
    people: ids
      .map((id) => byId.get(id))
      .filter((person): person is Person => !!person),
    inferredHops,
  };
}

function objectionHypotheses(
  target: Person | undefined,
  initiatives: StrategicInitiative[]
): string[] {
  const hypotheses = new Set<string>();
  if (target?.role === 'technical_buyer') {
    hypotheses.add('Security, integration effort, and architecture fit');
  }
  if (target?.role === 'economic_buyer' || /\b(chief|vp|president)\b/i.test(target?.title ?? '')) {
    hypotheses.add('Time to value, measurable return, and budget priority');
  }
  if (initiatives.some((initiative) => initiative.category === 'operations')) {
    hypotheses.add('Change-management burden and disruption to current workflows');
  }
  if (initiatives.some((initiative) => initiative.category === 'technology')) {
    hypotheses.add('Overlap with the existing stack and implementation ownership');
  }
  if (hypotheses.size === 0) {
    hypotheses.add('Priority, timing, and ownership of the problem');
  }
  return [...hypotheses].slice(0, 3);
}

export default function AccountStrategyModal({
  companyName,
  domain,
  people,
  edges,
  initiatives,
  sellerProfile,
  onClose,
  onFocusPerson,
}: {
  companyName: string | null;
  domain: string;
  people: Person[];
  edges: MapEdge[];
  initiatives: StrategicInitiative[];
  sellerProfile: SellerProfile | null;
  onClose: () => void;
  onFocusPerson: (person: Person) => void;
}) {
  const [copied, setCopied] = useState(false);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const strategy = useMemo(() => {
    const start = [...people].sort(
      (a, b) =>
        personScore(b, ROLE_PRIORITY, sellerProfile) -
        personScore(a, ROLE_PRIORITY, sellerProfile)
    )[0];
    const target = [...people]
      .filter((person) => person.id !== start?.id)
      .sort(
        (a, b) =>
          personScore(b, TARGET_PRIORITY, sellerProfile) -
          personScore(a, TARGET_PRIORITY, sellerProfile)
      )[0] ?? start;
    const path =
      start && target
        ? strongestPath(people, edges, start.id, target.id)
        : { people: [], inferredHops: 0 };
    const relevantInitiatives = initiatives
      .filter((initiative) =>
        (initiative.relevantPeople ?? []).some((name) =>
          [start?.name, target?.name].some(
            (personName) => personName?.toLowerCase() === name.toLowerCase()
          )
        )
      )
      .concat(initiatives)
      .filter(
        (initiative, index, items) =>
          items.findIndex((item) => item.name === initiative.name) === index
      )
      .slice(0, 3);
    return {
      start,
      target,
      path,
      initiatives: relevantInitiatives,
      objections: objectionHypotheses(target, relevantInitiatives),
    };
  }, [edges, initiatives, people, sellerProfile]);
  const buyingFunction = sellerBuyingFunctionLabel(sellerProfile);

  const brief = useMemo(() => {
    const account = companyName || domain;
    const lines = [
      `${account} account brief`,
      strategy.target
        ? `Primary target: ${strategy.target.name}, ${strategy.target.title}`
        : 'Primary target: Not mapped',
      strategy.start
        ? `Best entry point: ${strategy.start.name}, ${strategy.start.title}`
        : 'Best entry point: Not mapped',
      strategy.path.people.length > 1
        ? `Mapped relationship hypothesis${strategy.path.inferredHops ? ' (includes inferred reporting)' : ''}: ${strategy.path.people.map((person) => person.name).join(' → ')}`
        : 'Relationship path: No supported path is mapped yet',
      '',
      'Why now:',
      ...(strategy.initiatives.length > 0
        ? strategy.initiatives.map(
            (initiative) => `- ${initiative.name}: ${initiative.summary}`
          )
        : ['- No recent initiative evidence is attached yet']),
      '',
      'Conversation opening:',
      strategy.initiatives[0]?.salesAngles?.[0]
        ? `- ${strategy.initiatives[0].salesAngles?.[0]}`
        : '- Ask how the primary target measures the current priority and where execution is constrained',
      '',
      'Objection hypotheses to validate:',
      ...strategy.objections.map((objection) => `- ${objection}`),
    ];
    return lines.join('\n');
  }, [companyName, domain, strategy]);

  const copyBrief = async () => {
    await navigator.clipboard.writeText(brief);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <motion.div
      variants={overlayVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={overlayTransition}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-strategy-modal-title"
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-sheet p-5 shadow-2xl sm:max-w-4xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
              <Sparkles size={13} />
              Evidence into action
            </div>
            <h2
              id="account-strategy-modal-title"
              className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
            >
              Account strategy
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              The strongest mapped route to a buyer, plus a brief grounded in
              the people, relationships, and initiatives already on this map.
            </p>
            {sellerProfile && buyingFunction && (
              <p className="mt-2 text-xs font-medium text-brand">
                Prioritized for {sellerProfile.companyName}'s {buyingFunction}{' '}
                use case.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
              <Route size={13} /> Best entry point
            </div>
            {strategy.start ? (
              <button
                onClick={() => onFocusPerson(strategy.start!)}
                className="text-left"
              >
                <div className="font-semibold text-slate-950">
                  {strategy.start.name}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {strategy.start.title}
                </div>
              </button>
            ) : (
              <p className="text-sm text-slate-400">No stakeholders mapped.</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
              <Target size={13} /> Primary target
            </div>
            {strategy.target ? (
              <button
                onClick={() => onFocusPerson(strategy.target!)}
                className="text-left"
              >
                <div className="font-semibold text-slate-950">
                  {strategy.target.name}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {strategy.target.title}
                </div>
              </button>
            ) : (
              <p className="text-sm text-slate-400">No buyer mapped.</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
              <ShieldQuestion size={13} /> Coverage gap
            </div>
            <p className="text-sm leading-5 text-slate-600">
              {strategy.path.people.length > 1
                ? strategy.path.inferredHops > 0
                  ? `${strategy.path.inferredHops} of ${strategy.path.people.length - 1} hops are inferred.`
                  : `${strategy.path.people.length - 1} explicit mapped hop${strategy.path.people.length === 2 ? '' : 's'} to the target.`
                : 'No supported relationship path is mapped yet.'}
            </p>
          </div>
        </div>

        <section className="mt-3 rounded-2xl bg-slate-950 p-4 text-white sm:p-5">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[.14em] text-accent">
            Strongest mapped hypothesis
          </div>
          {strategy.path.people.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {strategy.path.people.map((person, index) => (
                <div key={person.id} className="contents">
                  {index > 0 && <ArrowRight size={14} className="text-slate-500" />}
                  <button
                    onClick={() => onFocusPerson(person)}
                    className="rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-left hover:bg-white/10"
                  >
                    <span className="block text-sm font-semibold">{person.name}</span>
                    <span className="block max-w-48 truncate text-[10px] text-slate-400">
                      {person.title}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Add an influence or reporting relationship to turn the entry
              point into a supported route.
            </p>
          )}
          <p className="mt-4 text-[10px] leading-4 text-slate-500">
            This route reflects map evidence, not verified communication
            history. Connected CRM, calendar, and meeting intelligence can
            raise confidence.
          </p>
        </section>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-brand">
                  One-click account brief
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Ready for meeting prep, a deal review, or an outreach draft.
                </p>
              </div>
              <button
                onClick={() => void copyBrief()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy brief'}
              </button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
              {brief}
            </pre>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow sm:p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-amber-700">
              Objection hypotheses
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Prompts to validate, not claims about this account.
            </p>
            <ul className="mt-3 space-y-2">
              {strategy.objections.map((objection) => (
                <li
                  key={objection}
                  className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
                >
                  {objection}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}
