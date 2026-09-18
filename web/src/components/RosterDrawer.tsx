import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Link as LinkIcon,
  Loader2,
  Search,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  type RosterFn,
  type RosterListResponse,
  type RosterPerson,
  type RosterSeniority,
  type RosterSyncJob,
} from '../api';
import type { LoadedMap } from '../types';

type RosterStatus = RosterPerson['status'];
type RosterCounts = RosterListResponse['counts'];

interface Props {
  mapId: string;
  domain: string;
  readOnly: boolean;
  onClose(): void;
  onMapUpdated(map: LoadedMap): void;
  onCountsChange(counts: RosterCounts): void;
  beforeAdd?(): Promise<void>;
}

const SENIORITY_ORDER: RosterSeniority[] = [
  'c_level',
  'evp_svp',
  'vp',
  'director',
  'manager',
  'lead',
  'ic',
  'unknown',
];

const FUNCTIONS: RosterFn[] = [
  'executive',
  'engineering',
  'product',
  'design',
  'data',
  'security',
  'it',
  'sales',
  'marketing',
  'customer_success',
  'support',
  'finance',
  'legal',
  'people',
  'operations',
  'other',
];

function humanize(value: string): string {
  return value
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function SourceIcon({ source }: { source: RosterPerson['source'] }) {
  if (source === 'csv') return <FileSpreadsheet size={14} />;
  if (source === 'linkedin_url') return <LinkIcon size={14} />;
  if (source === 'research') return <Sparkles size={14} />;
  return <Database size={14} />;
}

function emptyJob(id: string): RosterSyncJob {
  return {
    id,
    status: 'queued',
    events: [],
    summary: null,
    error: null,
  };
}

export default function RosterDrawer({
  mapId,
  domain,
  readOnly,
  onClose,
  onMapUpdated,
  onCountsChange,
  beforeAdd,
}: Props) {
  const [tab, setTab] = useState<RosterStatus>('suggested');
  const [query, setQuery] = useState('');
  const [functionFilter, setFunctionFilter] = useState<RosterFn | undefined>();
  const [seniorityFilter, setSeniorityFilter] = useState<
    RosterSeniority | undefined
  >();
  const [response, setResponse] = useState<RosterListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<RosterSyncJob | null>(null);
  const [notice, setNotice] = useState('');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      setLoading(true);
      try {
        const result = await api.getRoster(mapId, {
          q: query.trim() || undefined,
          function: functionFilter,
          seniority: seniorityFilter,
          status: tab,
          page,
          pageSize: 50,
        });
        setResponse((previous) =>
          append && previous
            ? { ...result, people: [...previous.people, ...result.people] }
            : result
        );
        onCountsChange(result.counts);
      } catch {
        setNotice('Could not load the roster — try again.');
      } finally {
        setLoading(false);
      }
    },
    [functionFilter, mapId, onCountsChange, query, seniorityFilter, tab]
  );

  useEffect(() => {
    setSelected(new Set());
    const timer = window.setTimeout(() => {
      void fetchPage(0, false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchPage]);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    let active = true;
    const poll = () => {
      void api
        .getRosterSync(mapId, job.id)
        .then(({ job: next }) => {
          if (active) setJob(next);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job, mapId]);

  useEffect(() => {
    if (!job || (job.status !== 'done' && job.status !== 'failed')) return;
    void fetchPage(0, false);
  }, [fetchPage, job]);

  const counts = response?.counts ?? {
    suggested: 0,
    added: 0,
    dismissed: 0,
  };
  const total = response?.total ?? 0;
  const people = response?.people ?? [];
  const syncRunning = job?.status === 'queued' || job?.status === 'running';

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    people.length > 0 && people.every((person) => selected.has(person.id));

  const toggleAll = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        people.forEach((person) => next.delete(person.id));
      } else {
        people.forEach((person) => next.add(person.id));
      }
      return next;
    });
  };

  const startSync = async () => {
    if (readOnly || syncRunning) return;
    setNotice('');
    try {
      const { jobId } = await api.startRosterSync(mapId);
      setJob(emptyJob(jobId));
    } catch {
      setNotice('Could not start roster sync — try again.');
    }
  };

  const runAction = async (action: 'add' | 'dismiss' | 'restore') => {
    const ids = [...selected];
    if (ids.length === 0 || readOnly) return;
    setNotice('');
    try {
      if (action === 'add') {
        await beforeAdd?.();
        const result = await api.addRosterPeople(mapId, ids);
        onMapUpdated(result.map);
        setNotice(`Added ${result.added} people to the map`);
      } else if (action === 'dismiss') {
        await api.dismissRosterPeople(mapId, ids);
        setNotice(`Dismissed ${ids.length} people`);
      } else {
        await api.restoreRosterPeople(mapId, ids);
        setNotice(`Restored ${ids.length} people`);
      }
      setSelected(new Set());
      await fetchPage(0, false);
    } catch {
      setNotice('That roster update failed — try again.');
    }
  };

  const importRoster = async (value = importText) => {
    const trimmed = value.trim();
    if (!trimmed || importing) return;
    setImporting(true);
    setNotice('');
    try {
      const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const body = lines.every((line) => line.toLowerCase().includes('linkedin.com/'))
        ? { linkedinUrls: lines }
        : { csv: value };
      const result = await api.importRoster(mapId, body);
      setImportText('');
      setNotice(`Imported ${result.imported} rows`);
      await fetchPage(0, false);
    } catch {
      setNotice('Import failed — check the CSV or LinkedIn URLs and try again.');
    } finally {
      setImporting(false);
    }
  };

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      setImportText(value);
      void importRoster(value);
    };
    reader.readAsText(file);
  };

  const functionFacets = useMemo(
    () => FUNCTIONS.filter((value) => (response?.byFunction[value] ?? 0) > 0),
    [response]
  );
  const seniorityFacets = useMemo(
    () =>
      SENIORITY_ORDER.filter(
        (value) => (response?.bySeniority[value] ?? 0) > 0
      ),
    [response]
  );

  return (
    <motion.aside
      aria-label="Suggested contacts"
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className="absolute inset-x-0 bottom-0 z-30 flex h-[82%] flex-col rounded-t-3xl border-t border-slate-200 bg-[#f9faf7] shadow-[0_-20px_60px_rgba(15,23,42,.15)] sm:inset-y-0 sm:left-auto sm:h-full sm:w-[420px] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-[-20px_0_60px_rgba(15,23,42,.12)]"
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
            Account roster
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">
            Suggested contacts{' '}
            <span className="text-slate-400">({total})</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void startSync()}
            disabled={readOnly || syncRunning}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#5b4cf0] px-3 text-xs font-semibold text-white transition hover:bg-[#6b5cf8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncRunning ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            {syncRunning ? 'Syncing…' : 'Sync roster'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close roster"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 sm:h-8 sm:w-8"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4 sm:p-5">
        {job && job.events.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            {job.events.map((event, index) => (
              <div
                key={`${event.provider}-${index}`}
                className={`flex items-center justify-between gap-2 ${
                  event.status === 'failed' ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                <span className="font-semibold">{humanize(event.provider)}</span>
                <span className="text-right">
                  {event.status === 'fetching'
                    ? `fetching… ${event.fetched ?? 0} people`
                    : event.status === 'done'
                      ? `${event.fetched ?? 0} people (${event.upserted ?? 0} new/updated)`
                      : event.message ?? humanize(event.status)}
                </span>
              </div>
            ))}
            {job.summary?.message === 'no providers configured' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                No providers configured — import a CSV or LinkedIn URLs instead.
              </p>
            )}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            {notice}
          </div>
        )}

        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {(['suggested', 'added', 'dismissed'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold capitalize ${
                tab === value
                  ? 'bg-[#eeecff] text-[#5144d7]'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {humanize(value)} ({counts[value]})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names or titles…"
            aria-label="Search suggested contacts"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {functionFacets.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFunctionFilter((current) => current === value ? undefined : value)}
                className={`min-h-11 rounded-xl border px-2.5 text-[11px] font-semibold sm:min-h-9 ${
                  functionFilter === value
                    ? 'border-[#5b4cf0] bg-[#5b4cf0] text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {humanize(value)} {response?.byFunction[value]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {seniorityFacets.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSeniorityFilter((current) => current === value ? undefined : value)}
                className={`min-h-11 rounded-xl border px-2.5 text-[11px] font-semibold sm:min-h-9 ${
                  seniorityFilter === value
                    ? 'border-[#5b4cf0] bg-[#5b4cf0] text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {humanize(value)} {response?.bySeniority[value]}
              </button>
            ))}
          </div>
        </div>

        {people.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <label className="flex min-h-11 items-center gap-2 border-b border-slate-100 px-3 text-xs font-semibold text-slate-500">
              {!readOnly && (
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-[#5b4cf0]"
                />
              )}
              Select all on page
            </label>
            <div className="divide-y divide-slate-100">
              {people.map((person) => (
                <div key={person.id} className="flex min-h-11 items-center gap-2 px-3 py-2">
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={() => toggleSelected(person.id)}
                      className="h-4 w-4 shrink-0 accent-[#5b4cf0]"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-800">
                      {person.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">
                      {person.title || 'Title unknown'}
                    </div>
                  </div>
                  {person.seniority && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                      {humanize(person.seniority)}
                    </span>
                  )}
                  <span
                    title={humanize(person.source)}
                    className="shrink-0 text-slate-400"
                  >
                    <SourceIcon source={person.source} />
                  </span>
                  {person.linkedin && (
                    <a
                      href={person.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      title="Open LinkedIn profile"
                      className="shrink-0 text-[#5b4cf0] hover:text-[#4135c7]"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-5 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {!loading && people.length === 0 && tab === 'suggested' && !syncRunning && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">
            <p className="font-semibold text-slate-700">
              No suggested contacts yet
            </p>
            <p className="mt-2 leading-relaxed">
              Sync pulls the full employee directory for {domain} from configured providers.
            </p>
            <p className="mt-2">
              {response?.providers.length
                ? `Configured: ${response.providers.map(humanize).join(', ')}`
                : 'No providers configured — set SUMBLE_API_KEY or CRUSTDATA_API_KEY, or import a CSV / LinkedIn URLs below'}
            </p>
          </div>
        )}
        {people.length < total && (
          <button
            type="button"
            onClick={() => void fetchPage(Math.floor(people.length / 50), true)}
            disabled={loading}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 hover:text-[#5b4cf0] disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}

        <details open={showImport} onToggle={(event) => setShowImport(event.currentTarget.open)} className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-3 py-3 text-xs font-semibold text-slate-700">
            Import
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Paste CSV or one LinkedIn URL per line"
              className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#5b4cf0]"
            />
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = [...event.dataTransfer.files].find((item) =>
                  item.name.toLowerCase().endsWith('.csv')
                );
                if (file) readFile(file);
              }}
              className="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-center text-[11px] text-slate-400"
            >
              Drop a CSV here
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
              >
                <Upload size={14} /> Choose CSV
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readFile(file);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => void importRoster()}
                disabled={importing || !importText.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Import
              </button>
            </div>
          </div>
        </details>
      </div>

      {selected.size > 0 && !readOnly && (
        <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-[#f9faf7] p-4">
          {(tab === 'suggested' || tab === 'dismissed') && (
            <button
              type="button"
              onClick={() => void runAction('add')}
              className="flex-1 rounded-xl bg-[#5b4cf0] px-3 py-2.5 text-xs font-semibold text-white"
            >
              Add to map ({selected.size})
            </button>
          )}
          {tab === 'suggested' && (
            <button
              type="button"
              onClick={() => void runAction('dismiss')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600"
            >
              Dismiss
            </button>
          )}
          {tab === 'dismissed' && (
            <button
              type="button"
              onClick={() => void runAction('restore')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600"
            >
              Restore
            </button>
          )}
        </div>
      )}
    </motion.aside>
  );
}
