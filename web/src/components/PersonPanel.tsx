import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { ROLE_META } from '../lib/colors';
import type { BuyingRole, MapComment, MapEdge, Person } from '../types';

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
  onChange: (person: Person) => void;
  onSetManager: (personId: string, managerId: string | null) => void;
  onAddInfluence: (fromId: string, toId: string, label: string) => void;
  onDelete: (personId: string) => void;
  onClose: () => void;
}

export default function PersonPanel({
  mapId,
  person,
  people,
  edges,
  readOnly,
  onChange,
  onSetManager,
  onAddInfluence,
  onDelete,
  onClose,
}: Props) {
  const [comments, setComments] = useState<MapComment[]>([]);
  const [draft, setDraft] = useState('');
  const [influenceTarget, setInfluenceTarget] = useState('');
  const [influenceLabel, setInfluenceLabel] = useState('');

  const managerId =
    edges.find((e) => e.kind === 'reports' && e.to === person.id)?.from ?? '';
  const influenceEdges = edges.filter(
    (e) => e.kind === 'influence' && (e.from === person.id || e.to === person.id)
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
    if (!draft.trim()) return;
    await api.addComment(mapId, draft.trim(), person.id);
    setDraft('');
    const r = await api.listComments(mapId);
    setComments(r.comments.filter((cm) => cm.person_id === person.id));
  };

  const field =
    'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

  const set = (patch: Partial<Person>) => onChange({ ...person, ...patch });

  return (
    <motion.aside
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className="absolute right-0 top-0 z-20 flex h-full w-[340px] flex-col border-l border-slate-200 bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {readOnly ? 'Person' : 'Edit person'}
        </h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div className="space-y-2">
          <input
            className={field}
            value={person.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Name"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Title"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.department ?? ''}
            onChange={(e) => set({ department: e.target.value || null })}
            placeholder="Department"
            disabled={readOnly}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            className={field}
            value={person.email ?? ''}
            onChange={(e) => set({ email: e.target.value || null })}
            placeholder="Email"
            disabled={readOnly}
          />
          <input
            className={field}
            value={person.linkedin ?? ''}
            onChange={(e) => set({ linkedin: e.target.value || null })}
            placeholder="LinkedIn URL"
            disabled={readOnly}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Buying role
          </label>
          <select
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
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reports to
          </label>
          <select
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Confidence
            </label>
            <select
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

        {person.sources.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sources
            </label>
            <ul className="space-y-1">
              {person.sources.map((s, i) => (
                <li key={i} className="break-all text-xs text-slate-500">
                  {s.startsWith('http') ? (
                    <a
                      className="text-indigo-600 hover:underline"
                      href={s}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s}
                    </a>
                  ) : (
                    s
                  )}
                </li>
              ))}
            </ul>
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
            <form onSubmit={postComment} className="flex gap-2">
              <input
                className={field}
                placeholder="Add a comment…"
                value={draft}
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
        <div className="border-t border-slate-100 p-3">
          <button
            onClick={() => onDelete(person.id)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={14} /> Remove from map
          </button>
        </div>
      )}
    </motion.aside>
  );
}
