import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Users, X } from 'lucide-react';
import {
  matchMeetingPeople,
  parseMeetingText,
} from '../lib/meetingImport';
import type { MeetingMatch } from '../lib/meetingImport';
import type { Person } from '../types';

const CONFIDENCE_STYLE: Record<string, string> = {
  exact: 'bg-emerald-50 text-emerald-700',
  strong: 'bg-emerald-50 text-emerald-700',
  guess: 'bg-amber-50 text-amber-700',
  none: 'bg-slate-100 text-slate-500',
};

/**
 * Paste a "who I've met" export (Granola-style: `Name — Title` lines and
 * bare name lists), match each name to people on the map, mark them Met,
 * and optionally add unmatched names as new nodes.
 */
export default function MeetingsImportModal({
  people,
  onApply,
  onClose,
}: {
  people: Person[];
  onApply: (
    matched: { person: Person; title: string | null }[],
    unmatched: { name: string; title: string | null }[]
  ) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<MeetingMatch[] | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [addUnmatched, setAddUnmatched] = useState(true);

  const entries = useMemo(() => parseMeetingText(raw), [raw]);
  const matchedCount = useMemo(
    () =>
      (parsed ?? []).filter(
        (match, index) => match.person && !excluded.has(index)
      ).length,
    [parsed, excluded]
  );
  const unmatchedCount = useMemo(
    () =>
      (parsed ?? []).filter(
        (match, index) => !match.person && !excluded.has(index)
      ).length,
    [parsed, excluded]
  );

  const toggleExcluded = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const apply = () => {
    if (!parsed) return;
    const matchedEntries: { person: Person; title: string | null }[] = [];
    const unmatchedEntries: { name: string; title: string | null }[] = [];
    parsed.forEach((match, index) => {
      if (excluded.has(index)) return;
      if (match.person) {
        matchedEntries.push({
          person: match.person,
          title: match.entry.title,
        });
      } else if (addUnmatched) {
        unmatchedEntries.push({
          name: match.entry.name,
          title: match.entry.title,
        });
      }
    });
    onApply(matchedEntries, unmatchedEntries);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-[#f9faf7] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200/80 px-5 py-4">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              Meetings import
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-950">
              Who have you met with?
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Paste a Granola-style export — names matched to the map are
              marked Met; the rest can be added as new people.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close meetings import"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!parsed ? (
            <>
              <textarea
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                rows={12}
                placeholder={
                  '- Yi Gu — Head of Talent Experience Engineering\n- Jonathan Carter — Principal Security Engineer\n\nAbhishek Kottamasu; Alex Kreidler; Rahul Chalamala…'
                }
                className="w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs leading-5 text-slate-800 outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>
                  {entries.length > 0
                    ? `${entries.length} names recognized`
                    : 'Paste names — one per line, semicolon-separated, or "Name — Title"'}
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                  <CheckCircle2 size={12} /> {matchedCount} matched
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
                  <CircleAlert size={12} /> {unmatchedCount} not on the map
                </span>
                <button
                  onClick={() => setParsed(null)}
                  className="ml-auto font-medium text-[#5b4cf0] hover:underline"
                >
                  Edit paste
                </button>
              </div>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {parsed.map((match, index) => {
                  const off = excluded.has(index);
                  return (
                    <li
                      key={index}
                      className={`flex items-center gap-3 px-3 py-2 ${off ? 'opacity-40' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => toggleExcluded(index)}
                        className="h-4 w-4 shrink-0 accent-[#5b4cf0]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-800">
                          {match.entry.name}
                          {match.entry.title && (
                            <span className="font-normal text-slate-400">
                              {' '}— {match.entry.title}
                            </span>
                          )}
                        </div>
                        {match.person ? (
                          <div className="truncate text-[11px] text-slate-500">
                            → {match.person.name} · {match.person.title}
                            {match.alternates.length > 0 && (
                              <span className="text-amber-600">
                                {' '}
                                (also:{' '}
                                {match.alternates
                                  .map((alt) => alt.name)
                                  .join(', ')}
                                )
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            no match — will be added as a new person
                          </div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CONFIDENCE_STYLE[match.confidence]}`}
                      >
                        {match.confidence}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200/80 bg-white/70 px-5 py-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={addUnmatched}
              onChange={(event) => setAddUnmatched(event.target.checked)}
              className="h-4 w-4 accent-[#5b4cf0]"
            />
            Add unmatched people to the map
          </label>
          <div className="flex-1" />
          {!parsed ? (
            <button
              onClick={() => setParsed(matchMeetingPeople(entries, people))}
              disabled={entries.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-[#5b4cf0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6b5cf8] disabled:opacity-40"
            >
              <Users size={14} /> Match {entries.length || ''}
            </button>
          ) : (
            <button
              onClick={apply}
              disabled={matchedCount === 0 && (!addUnmatched || unmatchedCount === 0)}
              className="flex items-center gap-1.5 rounded-xl bg-[#5b4cf0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6b5cf8] disabled:opacity-40"
            >
              <CheckCircle2 size={14} /> Mark {matchedCount} met
              {addUnmatched && unmatchedCount > 0
                ? ` + add ${unmatchedCount}`
                : ''}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
