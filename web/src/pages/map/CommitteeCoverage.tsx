import { ROLE_META } from '../../lib/colors';
import { FN_LABELS, SENIORITY_LABELS } from '../../lib/taxonomy';
import type {
  BuyingRole,
  MapCoverage,
  Person,
  Persona,
  PersonaCoverage,
} from '../../types';
import { COMMITTEE_ROLES } from './helpers';

export default function CommitteeCoverage(props: {
  people: Person[];
  personaCoverage: MapCoverage | null;
  coverage: Map<BuyingRole, number>;
  committeeCovered: number;
  personaById: Map<string, Persona>;
  focusPersona: (entry: PersonaCoverage) => void;
  readOnly: boolean;
  committeeOpen: boolean;
  setCommitteeOpen: (
    open: boolean | ((prev: boolean) => boolean)
  ) => void;
  selectionRaised: boolean;
  densityRaised: boolean;
}) {
  const {
    people,
    personaCoverage,
    coverage,
    committeeCovered,
    personaById,
    focusPersona,
    readOnly,
    committeeOpen,
    setCommitteeOpen,
    selectionRaised,
    densityRaised,
  } = props;

  if (people.length === 0) return null;

  return (
    /* buying-committee coverage: a quiet pill with a segmented coverage bar. Persona-aware once
       workspace personas load; falls back to the buying-role breakdown otherwise. */
    <div className={`absolute right-2 z-10 flex flex-col items-end gap-2 sm:bottom-auto sm:right-4 sm:top-20 ${!readOnly && selectionRaised ? 'bottom-28' : densityRaised ? 'bottom-14' : 'bottom-2'}`}>
      <button
        type="button"
        onClick={() => setCommitteeOpen((open) => !open)}
        aria-expanded={committeeOpen}
        aria-controls="committee-coverage"
        title={
          personaCoverage
            ? `${personaCoverage.coveredCount} of ${personaCoverage.requiredCount} required personas covered`
            : `${committeeCovered} of ${COMMITTEE_ROLES.length} buying roles covered`
        }
        className={`flex items-center gap-3 rounded-full border bg-white/90 py-1.5 pl-3.5 pr-3 text-xs shadow-[0_10px_35px_rgba(15,23,42,.08)] backdrop-blur-xl transition hover:bg-white ${committeeOpen ? 'border-slate-300 text-slate-800' : 'border-white/80 text-slate-600 hover:text-slate-800'}`}
      >
        <span className="font-semibold">Buying committee</span>
        <span className="flex items-center gap-[3px]" aria-hidden>
          {personaCoverage
            ? personaCoverage.personas.map((entry) => (
                <span
                  key={entry.personaId}
                  className={`h-1.5 w-3 rounded-full ${
                    entry.covered
                      ? 'bg-[#5b4cf0]'
                      : entry.required
                        ? 'bg-slate-200'
                        : 'bg-slate-100'
                  }`}
                />
              ))
            : COMMITTEE_ROLES.map((r) => (
                <span
                  key={r}
                  className={`h-1.5 w-3 rounded-full ${(coverage.get(r) ?? 0) > 0 ? ROLE_META[r].dot : 'bg-slate-200'}`}
                />
              ))}
        </span>
        <span className="tabular-nums text-slate-500">
          {personaCoverage ? (
            <>
              {personaCoverage.coveredCount}
              <span className="text-slate-400">/{personaCoverage.requiredCount}</span>
            </>
          ) : (
            <>
              {committeeCovered}
              <span className="text-slate-400">/{COMMITTEE_ROLES.length}</span>
            </>
          )}
        </span>
      </button>
      {committeeOpen && personaCoverage && (
        <div
          id="committee-coverage"
          data-testid="persona-coverage"
          className="w-80 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl"
        >
          <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-slate-400">
              Persona coverage
            </span>
            <span className="text-xs text-slate-500">
              {personaCoverage.coveredCount} of {personaCoverage.requiredCount} required
              {personaCoverage.personas.length > personaCoverage.requiredCount
                ? ` · ${personaCoverage.totalCovered}/${personaCoverage.personas.length} total`
                : ''}
            </span>
          </div>
          <ul className="max-h-[50vh] overflow-auto px-2 pb-2">
            {personaCoverage.personas.map((entry) => {
              const persona = personaById.get(entry.personaId);
              const shown = entry.matches.slice(0, 3);
              const extra = entry.matches.length - shown.length;
              return (
                <li key={entry.personaId}>
                  <button
                    type="button"
                    onClick={() => focusPersona(entry)}
                    title={
                      entry.covered
                        ? 'Select the matched people'
                        : 'Filter the canvas to this function'
                    }
                    className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left text-[13px] transition hover:bg-slate-50"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        entry.covered
                          ? 'bg-[#5b4cf0]'
                          : 'border border-dashed border-slate-300 bg-transparent'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate ${entry.covered ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                          {entry.name}
                        </span>
                        {!entry.required && (
                          <span className="rounded bg-slate-100 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            optional
                          </span>
                        )}
                      </span>
                      {persona && (
                        <span className="block truncate text-[11px] text-slate-400">
                          {SENIORITY_LABELS[persona.minSeniority]}
                          {persona.minSeniority !== 'c_level' ? '+' : ''} ·{' '}
                          {persona.functions.length > 0
                            ? persona.functions.map((fn) => FN_LABELS[fn]).join(', ')
                            : 'any function'}
                        </span>
                      )}
                      {entry.covered ? (
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {shown.map((m) => m.name).join(', ')}
                          {extra > 0 ? ` +${extra} more` : ''}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-amber-600">
                          Missing — click to focus the lane
                        </span>
                      )}
                    </span>
                    {entry.covered && (
                      <span className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#4d3fe0]">
                        {entry.matches.length}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
            Personas are set per workspace under <b>Personas</b> on the accounts page.
            {' '}Buying roles tagged: {committeeCovered}/{COMMITTEE_ROLES.length}.
          </p>
        </div>
      )}
      {committeeOpen && !personaCoverage && (
        <div
          id="committee-coverage"
          className="w-64 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl"
        >
          <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-slate-400">
              Coverage
            </span>
            <span className="text-xs text-slate-500">
              {people.length} {people.length === 1 ? 'person' : 'people'} · {committeeCovered} of {COMMITTEE_ROLES.length} roles
            </span>
          </div>
          <ul className="px-2 pb-2">
            {COMMITTEE_ROLES.map((r) => {
              const count = coverage.get(r) ?? 0;
              const covered = count > 0;
              return (
                <li
                  key={r}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 text-[13px]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${covered ? ROLE_META[r].dot : 'border border-dashed border-slate-300 bg-transparent'}`}
                  />
                  <span className={`flex-1 ${covered ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                    {ROLE_META[r].label}
                  </span>
                  {covered ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${ROLE_META[r].chip}`}>
                      {count}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Not identified</span>
                  )}
                </li>
              );
            })}
          </ul>
          {committeeCovered < COMMITTEE_ROLES.length && (
            <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
              Set a person’s buying role from their profile to fill the gaps.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
