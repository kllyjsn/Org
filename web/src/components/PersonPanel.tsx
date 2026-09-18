import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { ROLE_META } from '../lib/colors';
import type {
  BuyingRole,
  MapComment,
  MapEdge,
  Person,
  StrategicInitiative,
} from '../types';

const ROLES: BuyingRole[] = [
  'none',
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_buyer',
  'influencer',
  'blocker',
];

interface Props {
  mapId: string;
  person: Person;
  people: Person[];
  edges: MapEdge[];
  readOnly?: boolean;
  initiatives?: StrategicInitiative[];
  onChange: (person: Person) => void;
  onSetManager: (personId: string, managerId: string | null) => void;
  onAddInfluence: (fromId: string, toId: string, label: string) => void;
  onDelete: (personId: string) => void;
  onClose: () => void;
  onNavigate?: (personId: string) => void;
}

export default function PersonPanel({
  mapId,
  person,
  people,
  edges,
  readOnly,
  initiatives = [],
  onChange,
  onSetManager,
  onAddInfluence,
  onDelete,
  onClose,
  onNavigate,
}: Props) {
  const [comments, setComments] = useState<MapComment[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [influenceTarget, setInfluenceTarget] = useState('');
  const [influenceLabel, setInfluenceLabel] = useState('');

  const managerId =
    edges.find((e) => e.kind === 'reports' && e.to === person.id)?.from ?? '';

  // Reporting structure: the chain of managers up to the top of the chart,
  // then this person's direct reports — each row navigates the panel to
  // that person so the hierarchy can be walked without leaving the profile.
  const { chainUp, directReports } = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p]));
    const reports = edges.filter((e) => e.kind === 'reports');
    const up: { person: Person; inferred: boolean }[] = [];
    const seen = new Set([person.id]);
    let cursor = person.id;
    while (up.length < 8) {
      const edge = reports.find((e) => e.to === cursor);
      if (!edge || seen.has(edge.from)) break;
      const manager = byId.get(edge.from);
      if (!manager) break;
      up.push({ person: manager, inferred: !!edge.inferred });
      seen.add(edge.from);
      cursor = edge.from;
    }
    const down = reports
      .filter((e) => e.from === person.id)
      .map((e) => ({ person: byId.get(e.to), inferred: !!e.inferred }))
      .filter((e): e is { person: Person; inferred: boolean } => !!e.person);
    return { chainUp: up, directReports: down };
  }, [edges, people, person.id]);
  const [showAllReports, setShowAllReports] = useState(false);
  const reportsToShow = showAllReports
    ? directReports
    : directReports.slice(0, 6);
  const influenceEdges = edges.filter(
    (e) => e.kind === 'influence' && (e.from === person.id || e.to === person.id)
  );
  const sourceDetails =
    person.sourceDetails && person.sourceDetails.length > 0
      ? person.sourceDetails
      : (person.sources ?? []).map((url) => ({
          url,
          title: null,
          publisher: null,
          publishedAt: null,
          retrievedAt: person.lastVerifiedAt ?? '',
          sourceType: 'other' as const,
        }));
  const relevantInitiatives = initiatives.filter(
    (initiative) =>
      (initiative.relevantPeople ?? []).some(
        (name) => name.toLowerCase() === (person.name ?? '').toLowerCase()
      ) ||
      (initiative.relevantTeams ?? []).some((team) =>
        [person.team, person.department].some(
          (value) =>
            !!value &&
            (team.toLowerCase().includes(value.toLowerCase()) ||
              value.toLowerCase().includes(team.toLowerCase()))
        )
      )
  );

  useEffect(() => {
    setComments([]);
    setDraft('');
    if (!readOnly) {
      api
        .listComments(mapId)
        .then((r) =>
          setComments(r.comments.filter((cm) => cm.person_id === person.id))
        )
        .catch(() => {});
    }
  }, [mapId, person.id, readOnly]);

  const postComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || posting) return;
    setPosting(true);
    try {
      await api.addComment(mapId, draft.trim(), person.id);
      setDraft('');
      const r = await api.listComments(mapId);
      setComments(r.comments.filter((cm) => cm.person_id === person.id));
    } catch {
      setCommentError('Could not post — try again.');
    } finally {
      setPosting(false);
    }
  };

  const field =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-slate-50 disabled:text-slate-600';

  const set = (patch: Partial<Person>) => onChange({ ...person, ...patch });

  return (
    <motion.aside
      aria-label="Stakeholder details"
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className="absolute inset-x-0 bottom-0 z-30 flex h-[82%] flex-col rounded-t-3xl border-t border-slate-200 bg-sheet shadow-[0_-20px_60px_rgba(15,23,42,.15)] sm:inset-y-0 sm:left-auto sm:h-full sm:w-[360px] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-[-20px_0_60px_rgba(15,23,42,.12)]"
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
      <div className="flex items-start justify-between border-b border-slate-200/80 px-5 py-4">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
            {readOnly ? 'Stakeholder intelligence' : 'Stakeholder profile'}
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">
            {person.name}
          </h2>
          <p className="line-clamp-2 text-xs leading-5 text-slate-500">
            {person.title}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close stakeholder panel"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-8 sm:w-8"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-auto p-5">
        <label
          className={`flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${
            readOnly ? 'pointer-events-none' : 'cursor-pointer'
          }`}
        >
          <span className="text-xs font-semibold text-slate-700">
            Met with
          </span>
          <input
            type="checkbox"
            checked={!!person.metWith}
            onChange={(e) => set({ metWith: e.target.checked })}
            disabled={readOnly}
            className="h-4 w-4 accent-emerald-600"
          />
        </label>

        {(chainUp.length > 0 || directReports.length > 0) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Reporting structure
            </span>
            <div className="space-y-0.5">
              {chainUp.length > 5 && (
                <p className="px-2 py-0.5 text-[10px] text-slate-400">
                  ↑ {chainUp.length - 5} more level
                  {chainUp.length - 5 === 1 ? '' : 's'} to the top
                </p>
              )}
              {[...chainUp]
                .slice(0, 5)
                .reverse()
                .map((entry, index, visible) => (
                  <button
                    key={entry.person.id}
                    type="button"
                    disabled={!onNavigate}
                    onClick={() => onNavigate?.(entry.person.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                      onNavigate ? 'hover:bg-slate-50' : 'cursor-default'
                    }`}
                    style={{ paddingLeft: `${8 + index * 12}px` }}
                  >
                    <span className="text-[10px] text-slate-300">└</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800">
                        {entry.person.name}
                      </span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {entry.person.title}
                        {entry.inferred ? ' · inferred' : ''}
                      </span>
                    </span>
                    {index === visible.length - 1 && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        manager
                      </span>
                    )}
                  </button>
                ))}
              <div
                className="flex items-center gap-2 rounded-lg bg-brand-soft px-2 py-1.5"
                style={{
                  paddingLeft: `${8 + Math.min(chainUp.length, 5) * 12}px`,
                }}
              >
                <span className="truncate text-xs font-semibold text-brand">
                  {person.name}
                </span>
              </div>
              {directReports.length > 0 && (
                <div
                  className="pt-1"
                  style={{
                    paddingLeft: `${8 + Math.min(chainUp.length, 5) * 12 + 12}px`,
                  }}
                >
                  <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {directReports.length} direct report
                    {directReports.length === 1 ? '' : 's'}
                  </p>
                  {reportsToShow.map((entry) => (
                    <button
                      key={entry.person.id}
                      type="button"
                      disabled={!onNavigate}
                      onClick={() => onNavigate?.(entry.person.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                        onNavigate ? 'hover:bg-slate-50' : 'cursor-default'
                      }`}
                    >
                      <span className="text-[10px] text-slate-300">└</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-700">
                          {entry.person.name}
                        </span>
                        <span className="block truncate text-[10px] text-slate-400">
                          {entry.person.title}
                          {entry.inferred ? ' · inferred' : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                  {directReports.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllReports((v) => !v)}
                      className="w-full rounded-lg px-2 py-1 text-left text-[10px] font-semibold text-brand hover:bg-slate-50"
                    >
                      {showAllReports
                        ? 'Show fewer'
                        : `+${directReports.length - 6} more`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Research quality
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                person.confidence === 'high'
                  ? 'bg-emerald-50 text-emerald-700'
                  : person.confidence === 'medium'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-rose-50 text-rose-700'
              }`}
            >
              {person.confidence} confidence
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {(person.sources ?? []).length} source{(person.sources ?? []).length === 1 ? '' : 's'}
            {person.teamEvidence ? ` · ${person.teamEvidence} team` : ''}
          </div>
        </div>

        {sourceDetails.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Evidence
              </label>
              <span className="text-[10px] font-medium text-slate-400">
                {person.corroborationCount ?? sourceDetails.length} independent
                source
                {(person.corroborationCount ?? sourceDetails.length) === 1
                  ? ''
                  : 's'}
              </span>
            </div>
            <ul className="space-y-2">
              {sourceDetails.map((source, i) => (
                <li
                  key={`${source.url}-${i}`}
                  className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-500"
                >
                  {source.url.startsWith('http') ? (
                    <a
                      className="font-medium text-indigo-600 hover:underline"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        void api
                          .trackEvent(mapId, 'source_opened', {
                            surface: 'person',
                          })
                          .catch(() => undefined);
                      }}
                    >
                      {source.title ||
                        source.publisher ||
                        source.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                    </a>
                  ) : (
                    source.title || source.url
                  )}
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                    {[
                      source.sourceType,
                      source.publisher,
                      source.publishedAt
                        ? new Date(source.publishedAt).toLocaleDateString()
                        : 'date unavailable',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-slate-400">
              {person.lastVerifiedAt
                ? `Checked ${new Date(person.lastVerifiedAt).toLocaleDateString()}`
                : 'Verification date unavailable'}
              {' · '}
              {person.freshness === 'fresh'
                ? 'recent evidence'
                : person.freshness === 'aging'
                  ? 'evidence is aging'
                  : person.freshness === 'stale'
                    ? 'refresh required'
                    : 'source date unavailable'}
            </p>
          </div>
        )}

        {person.researchStatus && person.researchStatus !== 'verified' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {person.researchStatus === 'conflicting'
              ? `Conflicting current titles: ${
                  person.conflictingTitles?.join(', ') || 'review the sources'
                }`
              : 'The available public evidence may be stale. Verify before outreach.'}
          </div>
        )}

        {relevantInitiatives.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Why now
            </label>
            <div className="space-y-2">
              {relevantInitiatives.slice(0, 3).map((initiative) => (
                <div
                  key={initiative.name}
                  className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3"
                >
                  <p className="text-xs font-semibold text-indigo-900">
                    {initiative.name}
                  </p>
                  <p className="mt-1 text-xs text-indigo-800">
                    {(initiative.salesAngles ?? [])[0] || initiative.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {readOnly ? 'Details' : 'Edit details'}
          </span>
          <input
            className={field}
            value={person.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Name"
            aria-label="Name"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Title"
            aria-label="Title"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.department ?? ''}
            onChange={(e) => set({ department: e.target.value || null })}
            placeholder="Department"
            aria-label="Department"
            disabled={readOnly}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className={field}
              value={person.team ?? ''}
              onChange={(e) => set({ team: e.target.value || null })}
              placeholder="Team"
              aria-label="Team"
              disabled={readOnly}
            />
            <input
              className={field}
              value={person.productLine ?? ''}
              onChange={(e) => set({ productLine: e.target.value || null })}
              placeholder="Product line"
              aria-label="Product line"
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            className={field}
            value={person.email ?? ''}
            onChange={(e) => set({ email: e.target.value || null })}
            placeholder="Email"
            aria-label="Email"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.linkedin ?? ''}
            onChange={(e) => set({ linkedin: e.target.value || null })}
            placeholder="LinkedIn URL"
            aria-label="LinkedIn URL"
            disabled={readOnly}
          />
        </div>

        <div>
          <label
            id="person-role-label"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Buying role
          </label>
          <select
            aria-labelledby="person-role-label"
            className={field}
            value={person.role}
            onChange={(e) => set({ role: e.target.value as BuyingRole })}
            disabled={readOnly}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label || 'No role assigned'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            id="person-manager-label"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Reports to
          </label>
          <select
            aria-labelledby="person-manager-label"
            className={field}
            value={managerId}
            onChange={(e) => onSetManager(person.id, e.target.value || null)}
            disabled={readOnly}
          >
            <option value="">— no manager on map —</option>
            {people
              .filter((p) => p.id !== person.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.title}
                </option>
              ))}
          </select>
        </div>

        {readOnly ? (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Confidence
            </label>
            <span className="text-sm capitalize text-slate-600">
              {person.confidence}
            </span>
          </div>
        ) : (
          <div>
            <label
              id="person-confidence-label"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Confidence
            </label>
            <select
              aria-labelledby="person-confidence-label"
              className={field}
              value={person.confidence}
              onChange={(e) =>
                set({ confidence: e.target.value as Person['confidence'] })
              }
            >
              <option value="high">high — verified</option>
              <option value="medium">medium — credible source</option>
              <option value="low">low — unverified</option>
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes
          </label>
          <textarea
            className={`${field} min-h-[80px] resize-y`}
            value={person.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Met at SKO — cares about SOC 2…"
            aria-label="Notes"
            disabled={readOnly}
          />
        </div>

        {!readOnly && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Influence links
            </label>
            {influenceEdges.length > 0 && (
              <ul className="mb-2 space-y-1 text-xs text-slate-600">
                {influenceEdges.map((e) => {
                  const otherId = e.from === person.id ? e.to : e.from;
                  const other = people.find((p) => p.id === otherId);
                  return (
                    <li key={e.id}>
                      {e.from === person.id ? '→ ' : '← '}
                      {other?.name ?? 'unknown'}
                      {e.label ? ` — ${e.label}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex gap-2">
              <select
                aria-label="Person to influence"
                className={field}
                value={influenceTarget}
                onChange={(e) => setInfluenceTarget(e.target.value)}
              >
                <option value="">influences…</option>
                {people
                  .filter((p) => p.id !== person.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <input
                className={`${field} w-24`}
                placeholder="label"
                aria-label="Influence label"
                value={influenceLabel}
                onChange={(e) => setInfluenceLabel(e.target.value)}
              />
            </div>
            <button
              onClick={() => {
                if (influenceTarget)
                  onAddInfluence(person.id, influenceTarget, influenceLabel);
                setInfluenceTarget('');
                setInfluenceLabel('');
              }}
              disabled={!influenceTarget}
              className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              + Add influence link
            </button>
          </div>
        )}

        {!readOnly && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Team comments
            </label>
            <ul className="mb-2 space-y-2">
              {comments.map((cm) => (
                <li key={cm.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-medium text-slate-500">
                    {cm.author_name} ·{' '}
                    {new Date(cm.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-slate-700">{cm.body}</div>
                </li>
              ))}
              {comments.length === 0 && (
                <li className="text-xs text-slate-400">No comments yet.</li>
              )}
            </ul>
            {commentError && (
              <p className="mb-2 text-xs text-rose-600">{commentError}</p>
            )}
            <form onSubmit={postComment} className="flex gap-2">
              <input
                className={field}
                placeholder="Add a comment…"
                aria-label="Add a comment"
                value={draft}
                disabled={posting}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-800 px-3 text-xs font-medium text-white"
              >
                Post
              </button>
            </form>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex justify-end border-t border-slate-100 px-3 py-2">
          <button
            onClick={() => {
              if (window.confirm(`Remove ${person.name} from this map?`)) {
                onDelete(person.id);
              }
            }}
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:py-2"
          >
            <Trash2 size={13} /> Remove from map
          </button>
        </div>
      )}
    </motion.aside>
  );
}
