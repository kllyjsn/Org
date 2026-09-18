import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { overlayTransition, overlayVariants, sheetVariants } from '../lib/motion';
import {
  Activity,
  Clock3,
  Crosshair,
  Database,
  Loader2,
  MousePointerClick,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { ProductValueSummary } from '../types';

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function Metric({
  value,
  label,
  detail,
  icon: Icon,
}: {
  value: string;
  label: string;
  detail: string;
  icon: typeof Clock3;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon size={17} />
        </span>
        <span className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
          {value}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-900">{label}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

export default function ValueDashboardModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<ProductValueSummary | null>(null);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    api
      .getValueSummary(workspaceId)
      .then(setSummary)
      .catch(() => setError('TopDown could not load value metrics right now.'));
  }, [workspaceId]);

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
        aria-labelledby="value-dashboard-modal-title"
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-paper shadow-2xl sm:max-w-5xl sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200/80 bg-paper/95 px-5 py-5 backdrop-blur-xl sm:px-7">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-brand">
              Value realized
            </div>
            <h2
              id="value-dashboard-modal-title"
              className="text-3xl font-semibold tracking-[-0.05em] text-slate-950"
            >
              What TopDown is doing for you.
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Outcomes and usage signals only. Account names, people, notes,
              source text, and private deal content never enter these metrics.
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

        <div className="p-5 sm:p-7">
          {!summary && !error && (
            <div className="flex justify-center py-24 text-slate-400">
              <Loader2 className="animate-spin" />
            </div>
          )}
          {error && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {summary && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  icon={Clock3}
                  value={formatMinutes(summary.personal.estimatedMinutesSaved)}
                  label="Prep work automated"
                  detail="Conservative estimate from researched people, relationships, and initiatives."
                />
                <Metric
                  icon={Crosshair}
                  value={
                    summary.personal.firstUsefulMapMinutes === null
                      ? '—'
                      : `${summary.personal.firstUsefulMapMinutes}m`
                  }
                  label="First useful map"
                  detail="Elapsed time from starting research to an evidence-backed map."
                />
                <Metric
                  icon={Database}
                  value={String(summary.personal.sourceOpens)}
                  label="Evidence reviewed"
                  detail="Public sources opened while validating account intelligence."
                />
                <Metric
                  icon={MousePointerClick}
                  value={String(summary.personal.actionsTaken)}
                  label="Next moves taken"
                  detail="Briefing recommendations opened from account intelligence."
                />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                <section className="rounded-2xl bg-slate-950 p-5 text-white">
                  <div className="mb-5 flex items-center gap-2">
                    <Activity size={16} className="text-accent" />
                    <h3 className="font-semibold">Your operating rhythm</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-4">
                    {[
                      [summary.personal.usefulMaps, 'useful maps'],
                      [summary.personal.repeatAccounts, 'accounts revisited'],
                      [summary.personal.refinements, 'intel refinements'],
                      [
                        summary.personal.collaborationActions,
                        'collaboration actions',
                      ],
                    ].map(([value, label]) => (
                      <div key={label} className="bg-slate-950 px-3 py-4">
                        <div className="text-xl font-semibold">{value}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 td-card-shadow">
                  <div className="mb-4 flex items-center gap-2">
                    <Users size={16} className="text-brand" />
                    <h3 className="font-semibold text-slate-900">Team value</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-2xl font-semibold text-slate-950">
                        {summary.workspace.contributors}
                      </div>
                      <div className="text-xs text-slate-500">contributors</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-slate-950">
                        {summary.workspace.briefingActionRate}%
                      </div>
                      <div className="text-xs text-slate-500">
                        brief-to-action rate
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-slate-950">
                        {summary.workspace.liveOpportunityMaps}
                      </div>
                      <div className="text-xs text-slate-500">
                        live deal maps
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-slate-950">
                        {summary.workspace.collaborationActions}
                      </div>
                      <div className="text-xs text-slate-500">
                        comments and shares
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {summary.platform && (
                <section className="mt-4 rounded-2xl border border-brand/20 bg-brand-soft p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
                        Platform view
                      </div>
                      <h3 className="mt-1 font-semibold text-slate-950">
                        Aggregate outcomes across TopDown
                      </h3>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                      Super admin
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      [summary.platform.activatedUsers, 'activated users'],
                      [summary.platform.activeUsers30d, 'active in 30 days'],
                      [summary.platform.retainedUsers30d, 'repeat users'],
                      [
                        `${summary.platform.briefingActionRate}%`,
                        'brief-to-action',
                      ],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-xl bg-white p-3">
                        <div className="text-xl font-semibold text-slate-950">
                          {value}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="mt-4 text-center text-[10px] leading-5 text-slate-400">
                Tracking starts with this release. Prep automation uses a
                visible, conservative proxy: two minutes per researched person,
                five per initiative, and one per mapped relationship.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
