import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BellRing,
  Building2,
  Compass,
  CornerDownLeft,
  ExternalLink,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Search,
  Send,
  X,
  Share2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type {
  AccountAgentAction,
  AccountAgentAnswer,
  AccountAgentMessage,
  Person,
} from '../types';
import type { AgentCommandResult } from '../lib/agentCanvas';

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

interface ConversationMessage extends AccountAgentMessage {
  citations?: AccountAgentAnswer['citations'];
  actions?: AccountAgentAction[];
  canvasAction?: AgentCommandResult['command'];
}

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

function looksLikeQuestion(query: string) {
  return (
    query.includes('?') ||
    /^(who|what|why|how|which|where|when|tell me|help me|summarize|compare|explain|prepare)\b/i.test(
      query.trim()
    )
  );
}

export default function CommandPalette({
  people,
  readOnly,
  hasInitiatives,
  onClose,
  onFocusPerson,
  onRunAction,
  onRunCommand,
  onAskAgent,
  onRunAgentAction,
}: {
  people: Person[];
  readOnly: boolean;
  hasInitiatives: boolean;
  onClose: () => void;
  onFocusPerson: (person: Person) => void;
  onRunAction: (action: PaletteAction) => void;
  onRunCommand: (query: string) => AgentCommandResult | null;
  onAskAgent: (messages: AccountAgentMessage[]) => Promise<AccountAgentAnswer>;
  onRunAgentAction: (action: AccountAgentAction) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, loading]);

  const choices = useMemo<Choice[]>(() => {
    if (conversation.length > 0) return [];
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
    const agent: Choice = { kind: 'agent', query: query.trim() };
    return looksLikeQuestion(query) ? [agent, ...matches] : [...matches, agent];
  }, [conversation.length, hasInitiatives, people, query]);

  useEffect(() => {
    setActiveIndex(0);
    setError('');
  }, [query]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    const localResult = onRunCommand(question);
    if (localResult) {
      setConversation((messages) => [
        ...messages,
        { role: 'user', content: question },
        {
          role: 'assistant',
          content: localResult.message,
          canvasAction: localResult.command,
        },
      ]);
      setQuery('');
      return;
    }
    const nextMessages: ConversationMessage[] = [
      ...conversation,
      { role: 'user', content: question },
    ];
    setConversation(nextMessages);
    setQuery('');
    setLoading(true);
    setError('');
    try {
      const response = await onAskAgent(
        nextMessages.map(({ role, content }) => ({ role, content }))
      );
      setConversation((messages) => [
        ...messages,
        {
          role: 'assistant',
          content: response.answer,
          citations: response.citations,
          actions: response.actions,
        },
      ]);
    } catch {
      setError('The account analyst is temporarily unavailable. Your map is unchanged.');
    } finally {
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const run = (choice: Choice | undefined) => {
    if (!choice || loading) return;
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
    void ask(choice.query);
  };

  const runCanvasCommand = (
    command: AgentCommandResult['command'],
    index: number
  ) => {
    if (!command) return;
    const result = command.run();
    setConversation((messages) =>
      messages.map((message, messageIndex) =>
        messageIndex === index
          ? { ...message, content: result, canvasAction: undefined }
          : message
      )
    );
  };

  const cancelCanvasCommand = (index: number) => {
    setConversation((messages) =>
      messages.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              content: `${message.content} Cancelled — no canvas changes were applied.`,
              canvasAction: undefined,
            }
          : message
      )
    );
  };

  const submit = () => {
    if (conversation.length > 0) {
      void ask(query);
      return;
    }
    run(choices[activeIndex]);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-slate-950/45 px-3 pt-[5vh] backdrop-blur-sm sm:pt-[9vh]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.div
        initial={{ y: -12, opacity: 0, scale: 0.985 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -8, opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[#fbfcf9]/95 shadow-[0_30px_100px_rgba(15,23,42,.35)] backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3.5 sm:px-5">
          {conversation.length > 0 ? (
            <Sparkles size={20} className="shrink-0 text-[#5b4cf0]" />
          ) : (
            <Search size={20} className="shrink-0 text-[#5b4cf0]" />
          )}
          <input
            ref={inputRef}
            value={query}
            disabled={loading}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (conversation.length === 0 && event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % choices.length);
              }
              if (conversation.length === 0 && event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(
                  (index) => (index - 1 + choices.length) % choices.length
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              conversation.length > 0
                ? 'Ask a follow-up or preview another change…'
                : 'Find anyone, preview a change, or ask about the account…'
            }
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400 focus-visible:!outline-none sm:text-lg"
          />
          <kbd className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-400 shadow-sm sm:block">
            ESC
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
          {conversation.length > 0 ? (
            <div className="space-y-4 px-1 py-2 sm:px-2">
              {conversation.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={
                    message.role === 'user'
                      ? 'ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-sm text-white'
                      : 'max-w-[96%]'
                  }
                >
                  {message.role === 'assistant' ? (
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {message.content}
                      </div>
                      {(message.citations?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                          {message.citations?.map((citation) =>
                            citation.url ? (
                              <a
                                key={citation.id}
                                href={citation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#eeecff] px-2.5 py-1 text-[10px] font-semibold text-[#5b4cf0] hover:bg-[#e3e0ff]"
                              >
                                {citation.id} · {citation.label}
                                <ExternalLink size={10} className="shrink-0" />
                              </a>
                            ) : (
                              <span
                                key={citation.id}
                                className="max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600"
                              >
                                {citation.id} · {citation.label}
                              </span>
                            )
                          )}
                        </div>
                      )}
                      {message.canvasAction && (
                        <div className="mt-3 rounded-2xl border border-[#ddd9ff] bg-[#f5f4ff] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#5b4cf0]">
                                Canvas preview
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-950">
                                {message.canvasAction.preview.title}
                              </div>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
                              {message.canvasAction.preview.source === 'sourced'
                                ? 'sourced'
                                : message.canvasAction.preview.inferredCount > 0
                                  ? `${message.canvasAction.preview.inferredCount} inferred`
                                  : 'safe'}
                            </span>
                          </div>
                          {message.canvasAction.preview.kind === 'group' && (
                            <div className="mt-3 grid gap-1.5">
                              {message.canvasAction.preview.groups.map((group) => (
                                <div
                                  key={group.name}
                                  className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs"
                                >
                                  <span className="truncate font-medium text-slate-700">
                                    {group.name}
                                  </span>
                                  <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                                    {group.count} people
                                    {group.inferred > 0 ? ` · ${group.inferred} inferred` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {message.canvasAction.preview.kind === 'edit' && (
                            <div className="mt-3 space-y-1.5">
                              {message.canvasAction.preview.people.map((person) => (
                                <div
                                  key={person.name}
                                  className="rounded-xl bg-white px-3 py-2 text-xs"
                                >
                                  <div className="font-semibold text-slate-700">{person.name}</div>
                                  <div className="mt-1 space-y-0.5 text-slate-500">
                                    {person.changes.map((change) => (
                                      <div key={change}>{change}</div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {message.canvasAction.preview.kind === 'relationship' && (
                            <div className="mt-3 space-y-1.5">
                              {message.canvasAction.preview.edges.map((edge, edgeIndex) => (
                                <div
                                  key={`${edge.from}-${edge.to}-${edgeIndex}`}
                                  className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600"
                                >
                                  {edge.from} {edge.kind === 'reports' ? 'manages' : 'influences'} {edge.to}
                                  {edge.inferred ? ' · inferred' : ''}
                                </div>
                              ))}
                            </div>
                          )}
                          {message.canvasAction.preview.kind === 'relationship_view' && (
                            <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-500">
                              Switch visible relationships to{' '}
                              {message.canvasAction.preview.view === 'all'
                                ? 'all reporting and influence links'
                                : `${message.canvasAction.preview.view} links only`}.
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              onClick={() =>
                                runCanvasCommand(message.canvasAction, index)
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white hover:bg-[#6b5cf8]"
                            >
                              <Send size={12} /> Apply
                            </button>
                            <button
                              onClick={() => cancelCanvasCommand(index)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300"
                            >
                              <X size={12} /> Cancel
                            </button>
                            <span className="text-[10px] text-slate-400">
                              Undo remains available after applying
                            </span>
                          </div>
                        </div>
                      )}
                      {(message.actions?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.actions
                            ?.filter(
                              (action) =>
                                !readOnly || action.type !== 'deep_research'
                            )
                            .map((action, actionIndex) => (
                              <button
                                key={`${action.type}-${actionIndex}`}
                                onClick={() => {
                                  onRunAgentAction(action);
                                  onClose();
                                }}
                                className="rounded-xl border border-slate-200 bg-[#fbfcf9] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#5b4cf0] hover:text-[#5b4cf0]"
                              >
                                {action.label}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    message.content
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                  <Loader2 size={14} className="animate-spin text-[#5b4cf0]" />
                  Reading the map and its evidence…
                </div>
              )}
              {error && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {error}
                </div>
              )}
              <div ref={conversationEndRef} />
            </div>
          ) : (
            <>
              {!query && (
                <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">
                  Quick commands
                </div>
              )}
              {query && choices.length === 1 && (
                <div className="px-3 py-3 text-sm text-slate-500">
                  No exact people match. Ask TopDown about the account instead.
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
                          Ask TopDown
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
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3 text-[10px] text-slate-400 sm:px-5">
          <span>
            {conversation.length > 0
              ? 'Answers stay grounded in this map and its saved evidence'
              : 'Try “split this group by product” or “who should I contact and why?”'}
          </span>
          {!readOnly && (
            <span className="hidden items-center gap-1 sm:flex">
              <Sparkles size={11} /> Commands can also edit this map
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
