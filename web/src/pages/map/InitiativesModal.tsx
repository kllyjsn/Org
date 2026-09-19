import { useRef } from 'react';
import { Lightbulb } from 'lucide-react';
import { api } from '../../api';
import { useFocusTrap } from '../../lib/useFocusTrap';
import type { MapState } from '../../types';

export default function InitiativesModal(props: {
  mapId: string | undefined;
  fixtureMode: boolean;
  meta: MapState['meta'] | null;
  onClose: () => void;
}) {
  const { mapId, fixtureMode, meta, onClose } = props;
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="initiatives-modal-title"
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:max-w-3xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Lightbulb size={13} />
              Why this account changes now
            </div>
            <h2
              id="initiatives-modal-title"
              className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
            >
              Initiative intelligence
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
              Recent company signals, the people accountable for them, and
              evidence-backed ways your solution may fit.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {meta?.initiatives?.map((initiative, index) => (
            <article
              key={initiative.name}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow"
            >
              <div className="absolute right-3 top-2 text-4xl font-semibold tracking-tighter text-slate-100">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="relative pr-10 font-semibold tracking-tight text-slate-900">
                  {initiative.name}
                </h3>
                <span className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#5144d7]">
                  {initiative.category}
                </span>
              </div>
              <p className="text-sm text-slate-600">{initiative.summary}</p>
              {((initiative.relevantTeams ?? []).length > 0 ||
                (initiative.relevantPeople ?? []).length > 0) && (
                <p className="mt-2 text-xs text-slate-500">
                  <b>Relevant:</b>{' '}
                  {[
                    ...(initiative.relevantTeams ?? []),
                    ...(initiative.relevantPeople ?? []),
                  ].join(' · ')}
                </p>
              )}
              {(initiative.salesAngles ?? []).length > 0 && (
                <div className="mt-3 rounded-xl bg-slate-950 p-3 text-white">
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[.14em] text-[#c9f04b]">
                    Conversation opening
                  </div>
                  <ul className="space-y-1.5 text-xs leading-5 text-slate-200">
                    {(initiative.salesAngles ?? []).map((angle) => (
                      <li key={angle}>• {angle}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(initiative.evidence ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {(initiative.evidence ?? []).map((source) =>
                    source.startsWith('http') ? (
                      <a
                        key={source}
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          if (mapId && !fixtureMode) {
                            void api
                              .trackEvent(mapId, 'source_opened', {
                                surface: 'initiative',
                              })
                              .catch(() => undefined);
                          }
                        }}
                        className="max-w-full truncate text-indigo-600 hover:underline"
                      >
                        Source
                      </a>
                    ) : (
                      <span key={source} className="text-slate-400">
                        {source}
                      </span>
                    )
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
