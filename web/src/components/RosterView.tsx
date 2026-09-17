import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, Download, Search, UserCheck } from 'lucide-react';
import { deptColor, initials, ROLE_META } from '../lib/colors';
import { matchesAllTokens } from '../lib/searchText';
import { personLane, seniorityRank } from '../lib/layout';
import type { Person } from '../types';

type SortKey = 'org' | 'name' | 'department' | 'team' | 'seniority';

const SORT_LABEL: Record<SortKey, string> = {
  org: 'Organization',
  name: 'Name',
  department: 'Department',
  team: 'Team',
  seniority: 'Seniority',
};

function searchText(person: Person): string {
  return [
    person.name,
    person.title,
    person.department,
    person.team,
    person.productLine,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * The flat working surface for big accounts: every person as one scannable
 * row — searchable, filterable by business unit, sortable — with click-through
 * to the full person panel. Built for the 200+ person maps that read badly on
 * a canvas.
 */
export default function RosterView({
  people,
  managerOf,
  selectedId,
  onSelect,
  fileName,
}: {
  people: Person[];
  managerOf: Map<string, string>;
  selectedId: string | null;
  onSelect: (person: Person) => void;
  fileName?: string;
}) {
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState<Set<string>>(new Set());
  const [metFilter, setMetFilter] = useState<'all' | 'met' | 'unmet'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('org');

  const metCount = useMemo(
    () => people.filter((person) => person.metWith).length,
    [people]
  );

  // Coverage gaps: unmet people per lane, plus buying roles nobody met with.
  const gaps = useMemo(() => {
    if (metCount === 0) return null;
    const unmetByLane = new Map<string, number>();
    for (const person of people) {
      if (person.metWith) continue;
      const lane = personLane(person);
      unmetByLane.set(lane, (unmetByLane.get(lane) ?? 0) + 1);
    }
    const biggest = [...unmetByLane.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const roles = (
      ['champion', 'economic_buyer', 'decision_maker', 'technical_buyer'] as const
    ).filter(
      (role) =>
        people.some((person) => person.role === role) &&
        !people.some((person) => person.role === role && person.metWith)
    );
    return { biggest, roles };
  }, [people, metCount]);

  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) {
      const lane = personLane(person);
      counts.set(lane, (counts.get(lane) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
  }, [people]);

  const compare = useMemo(() => {
    const laneOrder = new Map<string, number>(
      departments.map(([lane], index) => [lane, index] as const)
    );
    const rank = (person: Person) => seniorityRank(person);
    return (a: Person, b: Person) => {
      let result = 0;
      switch (sortKey) {
        case 'name':
          result = (a.name ?? '').localeCompare(b.name ?? '');
          break;
        case 'department':
          result = personLane(a).localeCompare(personLane(b));
          break;
        case 'team':
          result = (a.team ?? '').localeCompare(b.team ?? '');
          break;
        case 'seniority':
          result = rank(a) - rank(b);
          break;
        default:
          result =
            (laneOrder.get(personLane(a)) ?? 0) -
              (laneOrder.get(personLane(b)) ?? 0) ||
            rank(a) - rank(b);
      }
      return result !== 0 ? result : (a.name ?? '').localeCompare(b.name ?? '');
    };
  }, [departments, sortKey]);

  const rows = useMemo(() => {
    const filtered = people.filter((person) => {
      if (deptFilter.size > 0 && !deptFilter.has(personLane(person))) {
        return false;
      }
      if (metFilter === 'met' && !person.metWith) return false;
      if (metFilter === 'unmet' && person.metWith) return false;
      return !query.trim() || matchesAllTokens(searchText(person), query);
    });
    return [...filtered].sort(compare);
  }, [people, deptFilter, metFilter, query, compare]);

  const toggleDept = (lane: string) => {
    setDeptFilter((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  };

  const cycleSort = () => {
    const order: SortKey[] = ['org', 'name', 'department', 'team', 'seniority'];
    setSortKey((prev) => order[(order.indexOf(prev) + 1) % order.length]);
  };

  const exportCsv = (scope: 'visible' | 'all') => {
    const esc = (value: string | null | undefined) =>
      `"${(value ?? '').replace(/"/g, '""')}"`;
    const list =
      scope === 'all' ? [...people].sort(compare) : rows;
    const lines = [
      ['Name', 'Title', 'Department', 'Team', 'Reports to', 'Buying role', 'Met', 'Email', 'LinkedIn']
        .map(esc)
        .join(','),
      ...list.map((person) =>
        [
          person.name,
          person.title,
          personLane(person),
          person.team ?? person.productLine ?? '',
          managerOf.get(person.id) ?? '',
          ROLE_META[person.role ?? 'none']?.label ?? '',
          person.metWith ? 'Yes' : '',
          person.email,
          person.linkedin,
        ]
          .map(esc)
          .join(',')
      ),
    ];
    // BOM keeps Excel on the right encoding.
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileName || 'roster'}${scope === 'all' ? '-all' : ''}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f7f2]">
      <div className="shrink-0 space-y-2 border-b border-slate-200/80 bg-white/80 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, titles, teams…"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={cycleSort}
            title="Change sort"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:text-[#5b4cf0]"
          >
            <ArrowDownWideNarrow size={14} />
            <span className="hidden sm:inline">{SORT_LABEL[sortKey]}</span>
          </button>
          <button
            type="button"
            onClick={() => exportCsv('visible')}
            title={`Export the ${rows.length} visible rows as CSV`}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:text-[#5b4cf0]"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
          {rows.length < people.length && (
            <button
              type="button"
              onClick={() => exportCsv('all')}
              title={`Filters are active — export all ${people.length} people instead`}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#5b4cf0]/30 bg-[#eeecff] px-3 py-2 text-xs font-semibold text-[#5144d7] shadow-sm hover:bg-[#e2dfff]"
            >
              <Download size={14} />
              <span className="hidden sm:inline">All {people.length}</span>
            </button>
          )}
          <div className="flex shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {(['all', 'met', 'unmet'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetFilter(value)}
                className={`px-2.5 py-2 text-xs font-semibold capitalize ${
                  metFilter === value
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {value === 'met' ? (
                  <span className="flex items-center gap-1">
                    <UserCheck size={12} /> Met
                  </span>
                ) : value === 'unmet' ? (
                  'Not met'
                ) : (
                  'All'
                )}
              </button>
            ))}
          </div>
          <span className="hidden shrink-0 text-xs font-medium text-slate-400 sm:inline">
            {rows.length} of {people.length}
          </span>
        </div>
        {gaps && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-semibold text-emerald-700">
              Met {metCount} of {people.length}
            </span>
            {gaps.biggest.length > 0 && (
              <span>
                Biggest gaps:{" "}
                {gaps.biggest
                  .map(([lane, count]) => `${lane} ${count}`)
                  .join(" · ")}
              </span>
            )}
            {gaps.roles.length > 0 && (
              <span className="text-amber-700">
                No{" "}
                {gaps.roles
                  .map((role) => ROLE_META[role].label ?? role)
                  .join(", ")}
                {" "}met yet
              </span>
            )}
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {departments.map(([lane, count]) => {
            const active = deptFilter.has(lane);
            return (
              <button
                key={lane}
                type="button"
                onClick={() => toggleDept(lane)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  active
                    ? 'border-[#5b4cf0] bg-[#eeecff] text-[#5b4cf0]'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${deptColor(
                    lane === 'Unassigned' ? null : lane
                  )}`}
                />
                {lane}
                <span className={active ? 'text-[#8c82ff]' : 'text-slate-400'}>
                  {count}
                </span>
              </button>
            );
          })}
          {deptFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setDeptFilter(new Set())}
              className="shrink-0 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            No one matches this view.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-[#f6f7f2]/95 backdrop-blur">
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">
                <th className="px-3 py-2 sm:px-4">Person</th>
                <th className="hidden px-3 py-2 md:table-cell">Department</th>
                <th className="hidden px-3 py-2 lg:table-cell">Team</th>
                <th className="hidden px-3 py-2 xl:table-cell">Reports to</th>
                <th className="hidden px-3 py-2 sm:table-cell">Role</th>
                <th className="px-3 py-2 text-center">Met</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => {
                const role = ROLE_META[person.role] ?? ROLE_META.none;
                const lane = personLane(person);
                const needsReview =
                  person.researchStatus === 'conflicting' ||
                  person.researchStatus === 'possibly_stale' ||
                  person.freshness === 'stale';
                return (
                  <tr
                    key={person.id}
                    onClick={() => onSelect(person)}
                    className={`cursor-pointer border-b border-slate-100 transition hover:bg-white ${
                      selectedId === person.id ? 'bg-[#f5f4ff]' : ''
                    }`}
                  >
                    <td className="px-3 py-2 sm:px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white ${deptColor(
                            person.department
                          )}`}
                        >
                          {initials(person.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-slate-900">
                              {person.name}
                            </span>
                            {needsReview && (
                              <span
                                title="Needs review"
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                              />
                            )}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {person.title || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${deptColor(
                            lane === 'Unassigned' ? null : lane
                          )}`}
                        />
                        {lane}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 lg:table-cell">
                      <span className="text-[12px] text-slate-600">
                        {person.team ?? person.productLine ?? '—'}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 xl:table-cell">
                      <span className="text-[12px] text-slate-600">
                        {managerOf.get(person.id) ?? '—'}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      {role.label ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${role.chip}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${role.dot}`} />
                          {role.label}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {person.metWith ? (
                        <span title="Met with" className="inline-flex">
                          <UserCheck size={15} className="text-emerald-600" />
                        </span>
                      ) : (
                        <span className="text-slate-200">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
