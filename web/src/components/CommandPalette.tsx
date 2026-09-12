import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BellRing,
  Building2,
  Compass,
  CornerDownLeft,
  LayoutGrid,
  Lightbulb,
  Search,
  Share2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { Person } from '../types';

export type PaletteAction =
  | 'layout'
  | 'overview'
  | 'strategy'
  | 'changes'
  | 'initiatives'
  | 'share';

type Choice =
  | { kind: 'person'; person: Person }
  | {
      kind: 'action';
      id: PaletteAction;
      label: string;
      detail: string;
      icon: typeof LayoutGrid;
    }
  | { kind: 'agent'; query: string };

const ACTIONS: Extract<Choice, { kind: 'action' }>[] = [
  {
    kind: 'action',
    id: 'overview',
    label: 'Show the whole account',
    detail: 'Fit every person into view',
    icon: Building2,
  },
  {
    kind: 'action',
    id: 'layout',
    label: 'Arrange the org chart',
    detail: 'Rebuild a clean reporting layout',
    icon: LayoutGrid,
  },
  {
    kind: 'action',
    id: 'strategy',
    label: 'Build the account strategy',
    detail: 'Find the best path in and copy a meeting brief',
    icon: Compass,
  },
  {
    kind: 'action',
    id: 'changes',
    label: 'Show account changes',
    detail: 'Compare this map with its latest saved version',
    icon: BellRing,
  },
  {
    kind: 'action',
    id: 'initiatives',
    label: 'Open initiative intelligence',
    detail: 'See the signals shaping this account',
    icon: Lightbulb,
  },
  {
    kind: 'action',
    id: 'share',
    label: 'Share this account map',
    detail: 'Create or manage a live link',
    icon: Share2,
  },
];

function personSearchText(person: Person) {
  return [
    person.name,
    person.title,
    person.department,
    person.team,
    person.productLine,
    person.role.replaceAll('_', ' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function CommandPalette({
  people,
  readOnly,
  hasInitiatives,
  onClose,
  onFocusPerson,
  onRunAction,
  onRunAgent,
}: {
  people: Person[];
  readOnly: boolean;
  hasInitiatives: boolean;
  onClose: () => void;
  onFocusPerson: (person: Person) => void;
  onRunAction: (action: PaletteAction) => void;
  onRunAgent: (query: string) => string;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const choices = useMemo<Choice[]>(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return hasInitiatives
        ? ACTIONS
        : ACTIONS.filter((action) => action.id !== 'initiatives');
    }
    const tokens = normalized.split(/\s+/);
    const matches = people
      .filter((person) => {
        const text = personSearchText(person);
        return tokens.every((token) => text.includes(token));
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aStarts = aName.startsWith(normalized) ? 1 : 0;
        const bStarts = bName.startsWith(normalized) ? 1 : 0;
        return bStarts - aStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 7)
      .map((person): Choice => ({ kind: 'person', person }));
    return [
      ...matches,
      { kind: 'agent', query: query.trim() },
    ];
  }, [hasInitiatives, people, query]);

  useEffect(() => {
    setActiveIndex(0);
    setMessage('');
  }, [query]);

  const run = (choice: Choice | undefined) => {
    if (!choice) return;
    if (choice.kind === 'person') {
      onFocusPerson(choice.person);
      onClose();
      return;
    }
    if (choice.kind === 'action') {
      onRunAction(choice.id);
      onClose();
      return;
    }
    const result = onRunAgent(choice.query);
    setMessage(result);
    if (!result.startsWith('I couldn’t')) {
      window.setTimeout(onClose, 700);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-slate-950/45 px-3 pt-[8vh] backdrop-blur-sm sm:pt-[12vh]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.div
        initial={{ y: -12, opacity: 0, scale: 0.985 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -8, opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="h-fit max-h-[78vh] w-full max-w-2xl overflow-hidden rounded-[26px] border border-white/70 bg-[#fbfcf9]/95 shadow-[0_30px_100px_rgba(15,23,42,.35)] backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3.5 sm:px-5">
          <Search size={20} className="shrink-0 text-[#5b4cf0]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % choices.length);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(
                  (index) => (index - 1 + choices.length) % choices.length
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                run(choices[activeIndex]);
              }
            }}
            placeholder="Find anyone, or tell TopDown what to do…"
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400 focus-visible:!outline-none sm:text-lg"
          />
          <kbd className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-400 shadow-sm sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-2 sm:p-3">
          {!query && (
            <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">
              Quick commands
            </div>
          )}
          {query && choices.length === 1 && (
            <div className="px-3 py-3 text-sm text-slate-500">
              No exact people match. TopDown can still interpret the request.
            </div>
          )}
          <div className="space-y-1">
            {choices.map((choice, index) => {
              const active = index === activeIndex;
              if (choice.kind === 'person') {
                const { person } = choice;
                return (
                  <button
                    key={person.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(choice)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                      active ? 'bg-[#eeecff]' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#5b4cf0] shadow-sm">
                      <UserRound size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950">
                        {person.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {[person.title, person.team || person.department]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {person.teamEvidence === 'inferred' && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold uppercase text-amber-700">
                        inferred
                      </span>
                    )}
                    <ArrowRight
                      size={15}
                      className={active ? 'text-[#5b4cf0]' : 'text-slate-300'}
                    />
                  </button>
                );
              }
              if (choice.kind === 'action') {
                const Icon = choice.icon;
                return (
                  <button
                    key={choice.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(choice)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                      active ? 'bg-[#eeecff]' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#5b4cf0] shadow-sm">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {choice.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {choice.detail}
                      </span>
                    </span>
                    <CornerDownLeft size={14} className="text-slate-300" />
                  </button>
                );
              }
              return (
                <button
                  key="agent"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(choice)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                    active
                      ? 'bg-slate-950 text-white'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      active
                        ? 'bg-[#c9f04b] text-slate-950'
                        : 'bg-slate-950 text-[#c9f04b]'
                    }`}
                  >
                    <Sparkles size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      Ask TopDown to do this
                    </span>
                    <span
                      className={`block truncate text-xs ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      “{choice.query}”
                    </span>
                  </span>
                  <CornerDownLeft
                    size={14}
                    className={active ? 'text-slate-400' : 'text-slate-300'}
                  />
                </button>
              );
            })}
          </div>
          {message && (
            <div
              className={`mx-2 mt-2 rounded-xl px-3 py-2 text-xs ${
                message.startsWith('I couldn’t')
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3 text-[10px] text-slate-400 sm:px-5">
          <span>
            Try “make Jordan a champion” or “show the payments team”
          </span>
          {!readOnly && (
            <span className="hidden items-center gap-1 sm:flex">
              <Sparkles size={11} /> Agent commands can edit this map
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
