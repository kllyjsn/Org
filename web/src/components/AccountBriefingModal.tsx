import { useEffect, useRef, useState } from 'react';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { overlayTransition, overlayVariants, sheetVariants } from '../lib/motion';
import {
  ArrowRight,
  BellRing,
  ExternalLink,
  Loader2,
  Radar,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type {
  AccountBriefing,
  BriefingAction,
  BriefingInsight,
} from '../types';

const PROVENANCE_LABELS = {
  sourced: 'Public evidence',
  map: 'Map signal',
  hypothesis: 'Hypothesis to validate',
} as const;

function InsightSection({
  title,
  subtitle,
  items,
  mapId,
}: {
  title: string;
  subtitle: string;
  items: BriefingInsight[];
  mapId: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
        {title}
      </div>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      {items.length > 0 ? (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div key={`${item.statement}-${index}`}>
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    item.provenance === 'sourced'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {PROVENANCE_LABELS[item.provenance]}
                </span>
                <p className="text-xs leading-5 text-slate-700">
                  {item.statement}
                </p>
              </div>
              {item.evidence.length > 0 && (
                <div className="ml-[76px] mt-1.5 flex flex-wrap gap-1.5">
                  {item.evidence.slice(0, 2).map((source, sourceIndex) => (
                    <a
                      key={`${source}-${index}`}
                      href={source}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        void api
                          .trackEvent(mapId, 'source_opened', {
                            surface: 'briefing',
                          })
                          .catch(() => undefined);
                      }}
                      className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-brand"
                    >
                      Source {sourceIndex + 1}
                      <ExternalLink size={9} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
          Not established yet. Use discovery rather than presenting a guess as
          fact.
        </p>
      )}
    </section>
  );
}

export default function AccountBriefingModal({
  mapId,
  readOnly,
  entry = 'direct',
  onClose,
  onRunAction,
}: {
  mapId: string;
  readOnly: boolean;
  entry?: 'dashboard' | 'direct' | 'spotlight' | 'toolbar';
  onClose: () => void;
  onRunAction: (action: BriefingAction) => void;
}) {
  const [briefing, setBriefing] = useState<AccountBriefing | null>(null);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    void api
      .trackEvent(mapId, 'briefing_opened', { entry })
      .catch(() => undefined);
    api
      .getBriefing(mapId)
      .then(setBriefing)
      .catch(() => setError('TopDown could not build this briefing right now.'));
  }, [mapId, entry]);

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
        aria-labelledby="briefing-modal-title"
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-paper shadow-2xl sm:max-w-4xl sm:rounded-3xl"
      >
        <div className="relative overflow-hidden bg-slate-950 p-5 text-white sm:p-8">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand/35 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-accent">
                <Radar size={13} />
                Account pulse
              </div>
              <h2
                id="briefing-modal-title"
                className="max-w-2xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl"
              >
                {briefing?.headline ?? 'Building your account briefing…'}
              </h2>
              {briefing && (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  {briefing.summary}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:h-9 sm:w-9"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-7">
          {!briefing && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Reading changes, initiatives, and coverage gaps…
            </div>
          )}
          {error && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {briefing && (
            <>
              {briefing.valueCase && (
                <section className="mb-6">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
                        Account value case
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Command of the Message-style research. Evidence is
                        separated from what still needs discovery.
                      </p>
                    </div>
                    <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand">
                      {briefing.valueCase.researchDepth === 'live'
                        ? 'Live research'
                        : 'Map evidence only'}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <InsightSection
                      title="Current state"
                      subtitle="What the account is demonstrably doing now."
                      items={briefing.valueCase.currentState}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Business problems"
                      subtitle="Constraints tied to the account's priorities."
                      items={briefing.valueCase.businessProblems}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Business impact"
                      subtitle="Operational or financial consequences, never invented."
                      items={briefing.valueCase.businessImpact}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Desired outcomes"
                      subtitle="The measurable future state to validate."
                      items={briefing.valueCase.desiredOutcomes}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Required capabilities"
                      subtitle="What must be true to reach the desired outcome."
                      items={briefing.valueCase.requiredCapabilities}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Decision criteria"
                      subtitle="How the buying group may evaluate a solution."
                      items={briefing.valueCase.decisionCriteria}
                      mapId={mapId}
                    />
                    <InsightSection
                      title="Differentiation"
                      subtitle="Where the seller can credibly separate from alternatives."
                      items={briefing.valueCase.differentiation}
                      mapId={mapId}
                    />
                  </div>

                  <section className="mt-3 rounded-2xl bg-slate-950 p-4 text-white sm:p-5">
                    <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent">
                      Stakeholder messages
                    </div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {briefing.valueCase.stakeholderMessages.length > 0 ? (
                        briefing.valueCase.stakeholderMessages.map(
                          (message) => (
                            <div
                              key={`${message.personName}-${message.statement}`}
                              className="rounded-xl bg-white/[0.07] p-3"
                            >
                              <div className="text-xs font-semibold">
                                {message.personName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-slate-400">
                                {message.relevance}
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-200">
                                {message.statement}
                              </p>
                              <span className="mt-2 inline-block text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                                {message.provenance === 'sourced'
                                  ? 'Grounded in evidence'
                                  : 'Message hypothesis'}
                              </span>
                            </div>
                          )
                        )
                      ) : (
                        <p className="text-xs text-slate-400">
                          Connect stakeholders to initiatives before building
                          role-specific messaging.
                        </p>
                      )}
                    </div>
                  </section>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
                        Discovery questions
                      </div>
                      <ol className="mt-3 space-y-2">
                        {briefing.valueCase.discoveryQuestions.map(
                          (question, index) => (
                            <li
                              key={question}
                              className="flex gap-2 text-xs leading-5 text-slate-700"
                            >
                              <span className="font-semibold text-brand">
                                {index + 1}.
                              </span>
                              {question}
                            </li>
                          )
                        )}
                      </ol>
                    </section>
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-amber-700">
                        Research gaps
                      </div>
                      {briefing.valueCase.researchGaps.length > 0 ? (
                        <ul className="mt-3 space-y-2">
                          {briefing.valueCase.researchGaps.map((gap) => (
                            <li
                              key={gap}
                              className="text-xs leading-5 text-amber-900"
                            >
                              {gap}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-xs text-amber-900">
                          No critical gap was identified in this pass.
                        </p>
                      )}
                    </section>
                  </div>
                </section>
              )}

              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
                    Next best moves
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Prioritized from current evidence, not invented intent.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                  Updated {new Date(briefing.generatedAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {briefing.actions.map((action, index) => (
                  <article
                    key={action.id}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow transition hover:border-brand-line"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-xs font-bold text-brand">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              action.provenance === 'sourced'
                                ? 'bg-emerald-50 text-emerald-700'
                                : action.provenance === 'hypothesis'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {PROVENANCE_LABELS[action.provenance]}
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {action.confidence} confidence
                          </span>
                        </div>
                        <h3 className="mt-2 font-semibold tracking-tight text-slate-950">
                          {action.title}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {action.reason}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              if (
                                !readOnly ||
                                action.type !== 'deep_research'
                              ) {
                                void api
                                  .trackEvent(
                                    mapId,
                                    'briefing_action_selected',
                                    {
                                      actionType: action.type,
                                      provenance: action.provenance,
                                    }
                                  )
                                  .catch(() => undefined);
                                onRunAction(action);
                              }
                            }}
                            disabled={
                              readOnly && action.type === 'deep_research'
                            }
                            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            {readOnly && action.type === 'deep_research'
                              ? 'View only'
                              : 'Take action'}
                            {(!readOnly ||
                              action.type !== 'deep_research') && (
                              <ArrowRight size={13} />
                            )}
                          </button>
                          {action.evidence.slice(0, 2).map((source, sourceIndex) =>
                            /^https?:\/\//.test(source) ? (
                              <a
                                key={`${source}-${index}`}
                                href={source}
                                target="_blank"
                                rel="noreferrer"
                                onClick={() => {
                                  void api
                                    .trackEvent(mapId, 'source_opened', {
                                      surface: 'briefing',
                                    })
                                    .catch(() => undefined);
                                }}
                                className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-[10px] font-medium text-slate-500 hover:text-brand"
                              >
                                Source {sourceIndex + 1}
                                <ExternalLink size={10} />
                              </a>
                            ) : null
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">
                  <BellRing size={13} />
                  What changed
                </div>
                {briefing.changes.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {briefing.changes.map((change) => (
                      <div
                        key={change.id}
                        className="rounded-xl bg-paper px-3 py-2.5"
                      >
                        <div className="text-xs font-semibold text-slate-800">
                          {change.title}
                        </div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-500">
                          {change.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-paper px-3 py-3 text-xs text-slate-500">
                    <Sparkles size={14} className="text-brand" />
                    The latest saved map is stable. Recommendations come from
                    initiatives and evidence gaps.
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
