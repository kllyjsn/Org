import { useEffect, useRef, useState } from 'react';
import {
  BellRing,
  BriefcaseBusiness,
  Lightbulb,
  Loader2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { MapChangeAlert, Person } from '../types';

function AlertIcon({ type }: { type: MapChangeAlert['type'] }) {
  if (type === 'person_added') return <UserPlus size={16} />;
  if (type === 'person_removed') return <UserMinus size={16} />;
  if (type === 'initiative_added' || type === 'initiative_removed') {
    return <Lightbulb size={16} />;
  }
  return <BriefcaseBusiness size={16} />;
}

export default function ChangeAlertsModal({
  mapId,
  people,
  onClose,
  onFocusPerson,
}: {
  mapId: string;
  people: Person[];
  onClose: () => void;
  onFocusPerson: (person: Person) => void;
}) {
  const [changes, setChanges] = useState<MapChangeAlert[]>([]);
  const [baselineAt, setBaselineAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    api
      .listChanges(mapId)
      .then((result) => {
        setChanges(result.changes);
        setBaselineAt(result.baselineAt);
      })
      .catch(() => setError('TopDown could not compare this map right now.'))
      .finally(() => setLoading(false));
  }, [mapId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-alerts-modal-title"
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <BellRing size={13} />
              Account movement
            </div>
            <h2
              id="change-alerts-modal-title"
              className="text-3xl font-semibold tracking-[-0.045em] text-slate-950"
            >
              Change alerts
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              What changed since the latest saved version, without inventing
              activity that is not present in the map.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {baselineAt && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            Compared with {new Date(baselineAt).toLocaleString()}
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Comparing account versions…
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {!loading && !error && changes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
            <BellRing size={22} className="mx-auto text-slate-300" />
            <p className="mt-3 font-semibold text-slate-800">No new movement</p>
            <p className="mt-1 text-sm text-slate-500">
              {baselineAt
                ? 'The current map matches its latest saved baseline.'
                : 'Save an edit first to create a version TopDown can compare.'}
            </p>
          </div>
        )}
        <div className="space-y-2">
          {changes.map((change) => {
            const person = change.personId
              ? people.find((item) => item.id === change.personId)
              : undefined;
            return (
              <button
                key={change.id}
                onClick={() => person && onFocusPerson(person)}
                disabled={!person}
                className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left td-card-shadow enabled:hover:border-[#5b4cf0]/30 enabled:hover:bg-[#fbfaff]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eeecff] text-[#5b4cf0]">
                  <AlertIcon type={change.type} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">
                    {change.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {change.detail}
                  </span>
                  {change.sources && change.sources.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {change.sources.slice(0, 2).map((source, index) => (
                        /^https?:\/\//.test(source) ? (
                          <a
                            key={source}
                            href={source}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-[#5b4cf0]"
                          >
                            Source {index + 1}
                          </a>
                        ) : (
                          <span
                            key={source}
                            className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500"
                          >
                            {source}
                          </span>
                        )
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
