import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { FUNCTIONS, FN_LABELS, SENIORITY_LABELS, SENIORITY_ORDER } from '../lib/taxonomy';
import { useSession } from '../store';
import type {
  LoadedMap,
  SuggestChartRequest,
  SuggestedPerson,
} from '../types';

interface Props {
  mapId: string;
  readOnly: boolean;
  peopleCount: number;
  onClose(): void;
  onApplied(map: LoadedMap): void;
  beforeApply?: () => Promise<void>;
}

const PRESETS = [
  'Prioritize GTM leadership',
  'Group by region',
  'Group by product line',
  'Focus on technical decision makers',
  "Only people we've met",
];

const SENIORITIES = SENIORITY_ORDER.filter((value) => value !== 'unknown');
const LIMITS = [50, 100, 200, 1000];

function confidenceLabel(value: SuggestedPerson['confidence']): string {
  return value[0].toUpperCase() + value.slice(1);
}

function confidenceClass(value: SuggestedPerson['confidence']): string {
  return value === 'high'
    ? 'bg-emerald-50 text-emerald-700'
    : value === 'medium'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';
}

function compactParams(
  params: SuggestChartRequest,
  declined: Set<string>
): SuggestChartRequest {
  return {
    ...params,
    excludeRosterIds: [...declined],
  };
}

export default function SuggestChartPanel({
  mapId,
  readOnly,
  peopleCount,
  onClose,
  onApplied,
  beforeApply,
}: Props) {
  const personas = useSession((state) => state.personas);
  const chart = useSession((state) => state.suggestChart);
  const setSuggestion = useSession((state) => state.setSuggestion);
  const mergeRefined = useSession((state) => state.mergeRefined);
  const confirmHighOnly = useSession((state) => state.confirmHighOnly);
  const applySuggestion = useSession((state) => state.applySuggestion);
  const setSuggestionStatus = useSession((state) => state.setSuggestionStatus);
  const [functions, setFunctions] = useState(() => {
    const selected = new Set(personas.flatMap((persona) => persona.functions));
    return selected.size > 0 ? selected : new Set(FUNCTIONS);
  });
  const [minSeniority, setMinSeniority] = useState<SuggestChartRequest['minSeniority']>('director');
  const [limit, setLimit] = useState(200);
  const [guidance, setGuidance] = useState('');
  const [personasOnly, setPersonasOnly] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [tookMs, setTookMs] = useState<number | null>(null);
  const selectedPeople = useMemo(
    () =>
      (chart.suggestion?.people ?? []).filter(
        (person) =>
          chart.confirmed.has(person.rosterId) &&
          !chart.declined.has(person.rosterId)
      ),
    [chart.confirmed, chart.declined, chart.suggestion]
  );
  const ghostPeople = useMemo(
    () =>
      (chart.suggestion?.people ?? []).filter(
        (person) => !chart.declined.has(person.rosterId)
      ),
    [chart.declined, chart.suggestion]
  );
  const stats = chart.suggestion?.stats;
  const canGenerate = functions.size > 0 && !chart.generating && !chart.applying;

  const toggleFunction = (value: (typeof FUNCTIONS)[number]) => {
    setFunctions((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const request = (nextGuidance = guidance): SuggestChartRequest => ({
    functions: [...functions],
    minSeniority,
    limit,
    personasOnly: personasOnly && personas.length > 0,
    guidance: nextGuidance,
    excludeRosterIds: [...chart.declined],
  });

  const generate = async (params: SuggestChartRequest, refined = false) => {
    setSuggestionStatus({ generating: true, error: null });
    try {
      const result = await api.suggestChart(mapId, params);
      setTookMs(result.tookMs);
      if (refined) mergeRefined(result.suggestion, params);
      else setSuggestion(mapId, result.suggestion, params);
    } catch (error) {
      setSuggestionStatus({
        generating: false,
        error: error instanceof Error ? error.message : 'Could not generate a chart',
      });
    }
  };

  const apply = async (mode: 'confirmed' | 'all' | 'declineAll') => {
    if (readOnly || chart.applying) return;
    const result = await applySuggestion(mapId, mode, beforeApply);
    if (result) onApplied(result.map);
  };

  const appendPreset = (preset: string) => {
    setGuidance((current) =>
      current
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .includes(preset)
        ? current
        : current.trim()
          ? `${current.trim()}\n${preset}`
          : preset
    );
  };

  return (
    <motion.aside
      aria-label="Suggested org chart"
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className="absolute inset-x-0 bottom-0 z-30 flex h-[88%] flex-col rounded-t-3xl border-t border-slate-200 bg-[#f9faf7] shadow-[0_-20px_60px_rgba(15,23,42,.15)] sm:inset-y-0 sm:left-auto sm:h-full sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-[-20px_0_60px_rgba(15,23,42,.12)]"
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
            F4 suggested org chart
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">
            Suggest structure
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close suggested org chart"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 sm:h-8 sm:w-8"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Functions</span>
            <span className="flex gap-2 text-[11px] text-[#5b4cf0]">
              <button type="button" onClick={() => setFunctions(new Set(FUNCTIONS))}>All</button>
              <button type="button" onClick={() => setFunctions(new Set())}>None</button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FUNCTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleFunction(value)}
                className={`min-h-9 rounded-xl border px-2.5 text-[11px] font-semibold ${
                  functions.has(value)
                    ? 'border-[#5b4cf0] bg-[#eeecff] text-[#5144d7]'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {FN_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-slate-600">Minimum seniority</div>
          <div className="flex flex-wrap gap-1.5">
            {SENIORITIES.map((value, index) => (
              <button
                key={value}
                type="button"
                onClick={() => setMinSeniority(value)}
                className={`rounded-xl border px-2.5 py-2 text-[11px] font-semibold ${
                  minSeniority === value
                    ? 'border-[#5b4cf0] bg-[#5b4cf0] text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {index === 0 ? 'C-level+' : `${SENIORITY_LABELS[value]}+`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMinSeniority('unknown')}
              className={`rounded-xl border px-2.5 py-2 text-[11px] font-semibold ${
                minSeniority === 'unknown'
                  ? 'border-[#5b4cf0] bg-[#5b4cf0] text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              Everyone
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-slate-600">Limit</div>
          <div className="flex gap-1.5">
            {LIMITS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLimit(value)}
                className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${
                  limit === value
                    ? 'border-[#5b4cf0] bg-[#5b4cf0] text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {value === 1000 ? 'All' : value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <textarea
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            placeholder="Guidance for the suggested structure…"
            className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-[#5b4cf0]"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => appendPreset(preset)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-600 hover:border-[#5b4cf0] hover:text-[#5144d7]"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {personas.length > 0 && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={personasOnly}
              onChange={(event) => setPersonasOnly(event.target.checked)}
              className="h-4 w-4 accent-[#5b4cf0]"
            />
            Only personas
          </label>
        )}

        <button
          type="button"
          disabled={!canGenerate || readOnly}
          onClick={() => void generate(request())}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5b4cf0] px-3 text-sm font-semibold text-white hover:bg-[#6b5cf8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {chart.generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {chart.generating ? 'Generating…' : 'Generate suggested chart'}
        </button>

        {chart.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {chart.error}
          </div>
        )}

        {chart.suggestion && stats && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              {stats.suggested} suggested of {stats.candidates} candidates · {stats.withEvidenceEdges} evidence-backed edges
              {tookMs !== null && ` · took ${tookMs} ms`}
              {chart.params.guidance && <span> · guidance applied</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['high', 'medium', 'low'] as const).map((confidence) => (
                <span key={confidence} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${confidenceClass(confidence)}`}>
                  {chart.suggestion?.people.filter((person) => person.confidence === confidence).length} {confidenceLabel(confidence)}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={chart.applying || readOnly} onClick={() => void apply('all')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">
                Confirm all
              </button>
              <button type="button" disabled={chart.applying} onClick={confirmHighOnly} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">
                Confirm high-confidence only
              </button>
              <button type="button" disabled={chart.applying || readOnly} onClick={() => void apply('declineAll')} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40">
                Decline all
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={refineText}
                onChange={(event) => setRefineText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && refineText.trim()) {
                    const next = `${chart.params.guidance ?? ''}\n${refineText.trim()}`.trim();
                    setGuidance(next);
                    setRefineText('');
                    void generate(compactParams({ ...chart.params, guidance: next }, chart.declined), true);
                  }
                }}
                placeholder="Refine…"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-[#5b4cf0]"
              />
              <button
                type="button"
                disabled={!refineText.trim() || chart.generating}
                onClick={() => {
                  const next = `${chart.params.guidance ?? ''}\n${refineText.trim()}`.trim();
                  setGuidance(next);
                  setRefineText('');
                  void generate(compactParams({ ...chart.params, guidance: next }, chart.declined), true);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#5144d7] disabled:opacity-40"
              >
                Refine
              </button>
            </div>
            <button
              type="button"
              disabled={chart.applying || readOnly}
              onClick={() => void apply('confirmed')}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {chart.applying && <Loader2 size={16} className="animate-spin" />}
              <Check size={16} /> Apply ({selectedPeople.length} confirmed)
            </button>
            <p className="text-[11px] text-slate-400">
              {ghostPeople.length} visible suggestions · {peopleCount} people already on this map
            </p>
          </>
        )}
      </div>
    </motion.aside>
  );
}
