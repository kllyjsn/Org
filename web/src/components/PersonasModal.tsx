import { useEffect, useRef, useState } from 'react';
import {
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { ApiError, api } from '../api';
import { useSession } from '../store';
import { useFocusTrap } from '../lib/useFocusTrap';
import {
  FN_LABELS,
  FUNCTIONS,
  SENIORITY_LABELS,
  SENIORITY_ORDER,
} from '../lib/taxonomy';
import type { Fn, Seniority } from '../lib/taxonomy';
import type { Persona, PersonaBuyingRole, PersonaInput } from '../types';

type Draft = PersonaInput & { key: string };

const BUYING_ROLES: { value: PersonaBuyingRole | null; label: string }[] = [
  { value: 'economic_buyer', label: 'Economic buyer' },
  { value: 'champion', label: 'Champion' },
  { value: 'decision_maker', label: 'Decision maker' },
  { value: 'technical_buyer', label: 'Technical buyer' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'blocker', label: 'Blocker' },
  { value: null, label: 'No hint' },
];

const SENIORITY_CHOICES = SENIORITY_ORDER.filter((s) => s !== 'unknown');

function toDraft(persona: PersonaInput, index: number): Draft {
  return {
    ...persona,
    key: persona.id ?? `new-${index}-${Math.random().toString(36).slice(2)}`,
  };
}

function blankDraft(): Draft {
  return toDraft(
    {
      name: '',
      functions: [],
      minSeniority: 'director',
      titleKeywords: [],
      buyingRole: null,
      required: true,
    },
    Date.now()
  );
}

function PersonaCard({
  draft,
  index,
  onChange,
  onRemove,
  onDrop,
  dragging,
  setDragging,
}: {
  draft: Draft;
  index: number;
  onChange: (next: Draft) => void;
  onRemove: () => void;
  onDrop: (from: number, to: number) => void;
  dragging: number | null;
  setDragging: (index: number | null) => void;
}) {
  const [keywordDraft, setKeywordDraft] = useState(
    draft.titleKeywords.join(', ')
  );
  const toggleFn = (fn: Fn) => {
    const functions = draft.functions.includes(fn)
      ? draft.functions.filter((f) => f !== fn)
      : [...draft.functions, fn];
    onChange({ ...draft, functions });
  };

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        setDragging(index);
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={(event) => {
        if (dragging === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragging !== null && dragging !== index) onDrop(dragging, index);
        setDragging(null);
      }}
      data-testid="persona-card"
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
        dragging === index
          ? 'border-[#796df5] opacity-60'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-2 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          aria-label={`Drag to reorder ${draft.name || 'persona'}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) {
              event.preventDefault();
              onDrop(index, index - 1);
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onDrop(index, index + 1);
            }
          }}
        >
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-[#796df5]"
              placeholder="Persona name, e.g. Economic buyer – Finance"
              aria-label="Persona name"
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#5b4cf0]"
                checked={draft.required}
                onChange={(event) =>
                  onChange({ ...draft, required: event.target.checked })
                }
              />
              Required
            </label>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              aria-label={`Remove ${draft.name || 'persona'}`}
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Functions{' '}
              <span className="font-normal normal-case tracking-normal text-slate-400">
                (none selected = any)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FUNCTIONS.map((fn) => {
                const on = draft.functions.includes(fn);
                return (
                  <button
                    key={fn}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleFn(fn)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? 'border-[#5b4cf0] bg-[#eeecff] text-[#4d3fe0]'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {FN_LABELS[fn]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Minimum seniority
              </div>
              <div
                role="radiogroup"
                aria-label="Minimum seniority"
                className="inline-flex flex-wrap overflow-hidden rounded-xl border border-slate-200 text-xs"
              >
                {SENIORITY_CHOICES.map((s: Seniority) => {
                  const on = draft.minSeniority === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onChange({ ...draft, minSeniority: s })}
                      className={`px-2.5 py-1.5 font-medium transition ${
                        on
                          ? 'bg-slate-950 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {SENIORITY_LABELS[s]}
                      {on && s !== 'c_level' ? '+' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Buying role
              </span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#796df5]"
                value={draft.buyingRole ?? ''}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    buyingRole: (event.target.value || null) as
                      | PersonaBuyingRole
                      | null,
                  })
                }
              >
                {BUYING_ROLES.map((role) => (
                  <option key={role.label} value={role.value ?? ''}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Extra title keywords{' '}
              <span className="font-normal normal-case tracking-normal text-slate-400">
                (comma separated, also match)
              </span>
            </span>
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#796df5]"
              placeholder="procurement, vendor management"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onBlur={() =>
                onChange({
                  ...draft,
                  titleKeywords: keywordDraft
                    .split(',')
                    .map((k) => k.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </div>
    </li>
  );
}

export default function PersonasModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (personas: Persona[]) => void;
}) {
  const storePersonas = useSession((s) => s.personas);
  const loadPersonas = useSession((s) => s.loadPersonas);
  const savePersonas = useSession((s) => s.savePersonas);
  const workspaceId = useSession((s) => s.workspaceId);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState<'load' | 'suggest' | 'save' | null>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    let cancelled = false;
    setBusy('load');
    loadPersonas()
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Could not load personas.');
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPersonas]);

  useEffect(() => {
    if (drafts === null && busy !== 'load') {
      setDrafts(storePersonas.map(toDraft));
    }
  }, [storePersonas, drafts, busy]);

  const list = drafts ?? [];
  const update = (index: number, next: Draft) =>
    setDrafts(list.map((d, i) => (i === index ? next : d)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setDrafts(next);
  };

  const suggest = async () => {
    if (!workspaceId) return;
    setBusy('suggest');
    setError('');
    setNotice('');
    try {
      const { personas, source } = await api.suggestPersonas(workspaceId);
      setDrafts(personas.map(toDraft));
      setNotice(
        source === 'llm'
          ? 'Suggested from your seller profile. Review, then save.'
          : 'Using the standard committee set — add a seller profile for tailored suggestions.'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not suggest personas.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const invalid = list.find((d) => !d.name.trim());
    if (invalid) {
      setError('Every persona needs a name.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      const saved = await savePersonas(
        list.map(({ key: _key, ...persona }) => ({
          ...persona,
          name: persona.name.trim(),
        }))
      );
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save personas.');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personas-modal-title"
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Target size={14} /> Buying committee
            </div>
            <h2
              id="personas-modal-title"
              className="text-2xl font-semibold tracking-tight text-slate-950"
            >
              Target personas
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Who needs to be on every map. Function plus a seniority floor;
              coverage on each account is measured against this list.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f6f7f2] p-5 sm:p-7">
          {busy === 'load' || drafts === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading personas
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {list.map((draft, index) => (
                  <PersonaCard
                    key={draft.key}
                    draft={draft}
                    index={index}
                    onChange={(next) => update(index, next)}
                    onRemove={() => setDrafts(list.filter((_, i) => i !== index))}
                    onDrop={move}
                    dragging={dragging}
                    setDragging={setDragging}
                  />
                ))}
              </ul>
              {list.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">
                  No personas yet. Add one or suggest a set from your profile.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDrafts([...list, blankDraft()])}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-white"
                >
                  <Plus size={15} /> Add persona
                </button>
                <button
                  type="button"
                  onClick={() => void suggest()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9d5ff] bg-[#eeecff] px-3.5 py-2 text-sm font-medium text-[#4d3fe0] hover:bg-[#e3e0ff] disabled:opacity-50"
                >
                  {busy === 'suggest' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  Suggest from my profile
                </button>
              </div>
            </>
          )}
          {notice && <p className="mt-4 text-sm text-slate-600">{notice}</p>}
          {error && (
            <p role="alert" className="mt-4 text-sm text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <span className="text-xs text-slate-400">
            {list.filter((d) => d.required).length} required ·{' '}
            {list.length} total · drag cards to reorder
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy !== null || drafts === null}
              className="rounded-xl bg-[#5b4cf0] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4d3fe0] disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save personas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
