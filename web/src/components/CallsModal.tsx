import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  PhoneCall,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type {
  CallTranscript,
  Person,
  Stance,
} from '../types';

const STANCE_STYLES: Record<Stance, string> = {
  advocate: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  skeptic: 'bg-rose-50 text-rose-700',
  unknown: 'border border-dashed border-slate-300 text-slate-400',
};

const SOURCE_LABELS = { paste: 'Pasted', upload: 'Upload', gong: 'Gong' } as const;

function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '';
}

export default function CallsModal({
  mapId,
  people,
  readOnly,
  onApply,
  onClose,
}: {
  mapId: string;
  people: Person[];
  readOnly: boolean;
  /** Server-persisted map state — replaces the canvas without history/dirty. */
  onApply: (state: import('../types').MapState) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CallTranscript[] | null>(null);
  const [gongConfigured, setGongConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listTranscripts(mapId);
      setItems(res.transcripts);
      setGongConfigured(res.gongConfigured);
      setSelectedId((id) => id ?? res.transcripts[0]?.id ?? null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load transcripts.'
      );
      setItems([]);
    }
  }, [mapId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => items?.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (source: 'paste' | 'upload', file?: File) => {
    await run('add', async () => {
      const body = file ? await file.text() : text;
      await api.addTranscript(mapId, {
        source,
        title: title || file?.name || 'Call',
        occurredAt: occurredAt || undefined,
        text: body,
        filename: file?.name,
      });
      setAdding(false);
      setTitle('');
      setOccurredAt('');
      setText('');
    });
  };

  const apply = async () => {
    if (!selected) return;
    setBusy('apply');
    setError('');
    try {
      const { state } = await api.applyTranscript(mapId, selected.id, overrides);
      onApply(state);
      setOverrides({});
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply failed.');
    } finally {
      setBusy(null);
    }
  };

  const overridesDirty = Object.keys(overrides).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calls-modal-title"
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 id="calls-modal-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <PhoneCall size={17} className="text-[#5b4cf0]" /> Call transcripts
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="px-6 pb-3 pt-1 text-xs text-slate-500">
          Stances come from what stakeholders actually said — quotes are the
          evidence. Applying updates the strategy plan.
        </p>
        {error && (
          <p role="alert" className="mx-6 mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        )}

        <div className="flex min-h-0 flex-1 gap-0 border-t border-slate-100">
          {/* left: transcript list */}
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-100 p-3">
            {!readOnly && (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="mb-2 w-full rounded-lg bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white hover:bg-[#6b5cf8]"
              >
                {adding ? 'Cancel' : 'Add transcript'}
              </button>
            )}
            {adding && (
              <div className="mb-3 space-y-2 rounded-xl border border-slate-200 p-3">
                <input
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  placeholder="Title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
                <textarea
                  className="h-20 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  placeholder="Paste transcript text…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy === 'add' || text.length < 200}
                  onClick={() => void submit('paste')}
                  className="w-full rounded-lg border border-[#5b4cf0] px-3 py-1.5 text-xs font-semibold text-[#5b4cf0] disabled:opacity-50"
                >
                  {busy === 'add' ? 'Analyzing…' : 'Paste & analyze'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.vtt,.srt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void submit('upload', file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={busy === 'add'}
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300"
                >
                  <Upload size={12} /> Upload .txt/.vtt/.srt
                </button>
                {gongConfigured ? (
                  <button
                    type="button"
                    disabled={busy === 'gong'}
                    onClick={() =>
                      void run('gong', async () => {
                        const res = await api.importGongCalls(mapId);
                        setError(res.imported === 0 ? 'No matching Gong calls found.' : '');
                      })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300"
                  >
                    {busy === 'gong' ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      'Import from Gong (last 30d)'
                    )}
                  </button>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    Set GONG_ACCESS_KEY/GONG_ACCESS_KEY_SECRET to import from Gong.
                  </p>
                )}
              </div>
            )}
            {items === null ? (
              <Loader2 className="mx-auto mt-8 animate-spin text-slate-300" />
            ) : items.length === 0 ? (
              <p className="px-1 text-[11px] text-slate-400">No calls yet.</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setOverrides({});
                      }}
                      className={`w-full rounded-lg px-2.5 py-2 text-left ${
                        item.id === selectedId
                          ? 'bg-[#eeecff]'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="truncate text-xs font-medium text-slate-800">
                        {item.title || 'Untitled call'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold">
                          {SOURCE_LABELS[item.source]}
                        </span>
                        {dateLabel(item.occurredAt ?? item.createdAt)}
                        <span
                          className={
                            item.analysisError
                              ? 'text-rose-500'
                              : item.appliedAt
                                ? 'text-emerald-600'
                                : item.analysis
                                  ? 'text-slate-500'
                                  : 'text-amber-600'
                          }
                        >
                          {item.analysisError
                            ? 'Failed'
                            : item.appliedAt
                              ? 'Applied'
                              : item.analysis
                                ? 'Analyzed'
                                : 'Analyzing'}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* right: selected analysis */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {!selected ? (
              <p className="pt-10 text-center text-sm text-slate-400">
                Select a call to see the analysis.
              </p>
            ) : (
              <div className="space-y-4">
                {selected.analysisError && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    Analysis failed: {selected.analysisError}
                  </p>
                )}
                {selected.analysis?.speakers.map((speaker) => (
                  <div
                    key={speaker.speakerLabel}
                    className="rounded-xl border border-slate-200 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-sm font-semibold text-slate-900">
                          {speaker.speakerLabel}
                        </span>
                        {speaker.inferredTitle && (
                          <span className="ml-2 text-xs text-slate-400">
                            {speaker.inferredTitle}
                          </span>
                        )}
                      </div>
                      <select
                        disabled={readOnly}
                        value={
                          overrides[speaker.speakerLabel] !== undefined
                            ? (overrides[speaker.speakerLabel] ?? '')
                            : (speaker.matchedPersonId ?? '')
                        }
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [speaker.speakerLabel]: e.target.value || null,
                          }))
                        }
                        className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        aria-label={`Match ${speaker.speakerLabel} to a person`}
                      >
                        <option value="">Not on map</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STANCE_STYLES[speaker.stance]}`}
                      >
                        {speaker.stance}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {speaker.confidence} confidence
                      </span>
                    </div>
                    {speaker.summary && (
                      <p className="mt-2 text-xs text-slate-600">
                        {speaker.summary}
                      </p>
                    )}
                    {speaker.quotes.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {speaker.quotes.map((quote, index) => (
                          <blockquote
                            key={index}
                            className="border-l-2 border-[#5b4cf0]/30 pl-2.5 text-xs italic text-slate-600"
                          >
                            “{quote.text}”
                            <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase not-italic text-slate-500">
                              {quote.signal}
                            </span>
                          </blockquote>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {selected.analysis && (
                  <>
                    {(selected.analysis.nextSteps.length > 0 ||
                      selected.analysis.risks.length > 0) && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Next steps
                          </h4>
                          <ul className="space-y-1 text-xs text-slate-600">
                            {selected.analysis.nextSteps.map((step, i) => (
                              <li key={i}>• {step}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Risks
                          </h4>
                          <ul className="space-y-1 text-xs text-rose-600">
                            {selected.analysis.risks.map((risk, i) => (
                              <li key={i}>• {risk}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {!readOnly && (
                  <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run('reanalyze', async () => {
                          const { transcript } = await api.reanalyzeTranscript(
                            mapId,
                            selected.id
                          );
                          setItems((prev) =>
                            prev?.map((t) =>
                              t.id === transcript.id ? transcript : t
                            ) ?? null
                          );
                        })
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-50"
                    >
                      {busy === 'reanalyze' ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Re-analyze
                    </button>
                    <button
                      type="button"
                      disabled={
                        !!busy ||
                        !selected.analysis ||
                        (!!selected.appliedAt && !overridesDirty)
                      }
                      onClick={() => void apply()}
                      className="flex items-center gap-1.5 rounded-lg bg-[#5b4cf0] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6b5cf8] disabled:opacity-50"
                    >
                      {busy === 'apply' ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      {selected.appliedAt ? 'Re-apply to strategy' : 'Apply to strategy'}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        if (window.confirm('Delete this transcript?')) {
                          void run('delete', async () => {
                            await api.deleteTranscript(mapId, selected.id);
                            setSelectedId(null);
                          });
                        }
                      }}
                      className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
