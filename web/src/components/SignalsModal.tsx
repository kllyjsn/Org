import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, MapPin, X } from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { PersonSignal } from '../types';

export default function SignalsModal({
  workspaceId,
  onClose,
  onOpenMap,
  onResearchCompany,
}: {
  workspaceId: string;
  onClose: () => void;
  onOpenMap: (mapId: string) => void;
  onResearchCompany: (domain: string, companyName: string | null) => void;
}) {
  const [signals, setSignals] = useState<PersonSignal[] | null>(null);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    api
      .listSignals(workspaceId)
      .then((r) => setSignals(r.signals))
      .catch(() => setError('Could not load signals.'));
  }, [workspaceId]);

  const dismiss = async (signalId: string) => {
    try {
      await api.dismissSignal(workspaceId, signalId);
      setSignals((items) => items?.filter((s) => s.id !== signalId) ?? null);
    } catch {
      setError('Could not dismiss the signal.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signals-modal-title"
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              People signals
            </div>
            <h2
              id="signals-modal-title"
              className="text-lg font-semibold tracking-tight"
            >
              Watched stakeholder moves
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Job changes detected for people you're tracking.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close signals"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="py-8 text-center text-sm text-rose-600">{error}</p>}
          {!error && signals === null && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading signals…
            </div>
          )}
          {!error && signals?.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500">
              No signals yet. Open a stakeholder on a map and hit
              "Track job moves" to start watching them.
            </p>
          )}
          <ul className="space-y-2">
            {signals?.map((signal) => (
              <li
                key={signal.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <MapPin
                        size={13}
                        className={
                          signal.kind === 'moved'
                            ? 'shrink-0 text-emerald-600'
                            : 'shrink-0 text-amber-600'
                        }
                      />
                      <span className="truncate">{signal.title}</span>
                    </p>
                    {signal.detail && (
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {signal.detail}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                      {signal.map_name} ·{' '}
                      {new Date(signal.created_at).toLocaleDateString()}
                    </p>
                    {Array.isArray(signal.sources) &&
                      signal.sources.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {(signal.sources as string[]).slice(0, 2).map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-[11px] text-indigo-600 hover:underline"
                              >
                                {url.replace(/^https?:\/\/(www\.)?/, '')}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                  <button
                    onClick={() => void dismiss(signal.id)}
                    aria-label="Dismiss signal"
                    className="shrink-0 rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => onOpenMap(signal.map_id)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Open {signal.map_name}
                  </button>
                  {signal.kind === 'moved' && (
                    <button
                      onClick={() =>
                        onResearchCompany(signal.new_domain ?? '', signal.new_company)
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-[#5b4cf0] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#4a3ee0]"
                    >
                      Map {signal.new_company ?? 'new company'}
                      <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
