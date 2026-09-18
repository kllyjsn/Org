import { activeProvider, chat, type Provider } from './llm.js';
import { exaPeopleContext } from './exa.js';
import { sumbleOrgPeople, type SumbleOrgData } from './sumble.js';
import {
  deadSourceUrls,
  extractJson,
  fixtureOrg,
  FOCUSES,
  initiativesPrompt,
  missingFunctions,
  normalizeInitiatives,
  normalizePeople,
  peopleCapFor,
  researchPrompt,
  resolveSourceUrls,
  SYSTEM_PROMPT,
  verifyTitleClaims,
  type ResearchResult,
  type ResearchedPerson,
  type StrategicInitiative,
} from './research.js';
import type { SellerProfile } from './types.js';

export type ResearchStep =
  | 'discover'
  | 'sumble'
  | 'passes'
  | 'initiatives'
  | 'followup'
  | 'dead_sources'
  | 'verify'
  | 'done';

export interface ResearchCheckpoint {
  domain: string;
  focus: string | null;
  sellerProfile: SellerProfile | null;
  knownSources: string[];
  step: ResearchStep;
  discoveryContext: string;
  sumble: {
    people: unknown[];
    total: number;
    companyName: string | null;
  } | null;
  rawPeople: unknown[];
  companyName: string | null;
  provider: Provider | null;
  initiatives: StrategicInitiative[];
  deadSources: string[];
  passFailures: number;
  startedAt: string;
}

export interface ResearchEvent {
  at: string;
  step: ResearchStep;
  level: 'info' | 'warn';
  message: string;
  peopleCount?: number;
}

export interface PipelineDeps {
  chat: typeof chat;
  exaPeopleContext: typeof exaPeopleContext;
  sumbleOrgPeople: typeof sumbleOrgPeople;
  resolveSourceUrls: typeof resolveSourceUrls;
  verifyTitleClaims: typeof verifyTitleClaims;
  deadSourceUrls: typeof deadSourceUrls;
}

const REAL_DEPS: PipelineDeps = {
  chat,
  exaPeopleContext,
  sumbleOrgPeople,
  resolveSourceUrls,
  verifyTitleClaims,
  deadSourceUrls,
};

function mergeDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return { ...REAL_DEPS, ...overrides };
}

function event(
  step: ResearchStep,
  level: ResearchEvent['level'],
  message: string,
  peopleCount?: number
): ResearchEvent {
  return {
    at: new Date().toISOString(),
    step,
    level,
    message,
    ...(peopleCount === undefined ? {} : { peopleCount }),
  };
}

function next(step: ResearchStep, cp: ResearchCheckpoint): ResearchStep {
  switch (step) {
    case 'discover':
      return cp.focus ? 'passes' : 'sumble';
    case 'sumble':
      return 'passes';
    case 'passes':
      return cp.focus ? (cp.knownSources.length > 0 ? 'dead_sources' : 'verify') : 'initiatives';
    case 'initiatives':
      return 'followup';
    case 'followup':
      return cp.knownSources.length > 0 ? 'dead_sources' : 'verify';
    case 'dead_sources':
      return 'verify';
    case 'verify':
      return 'done';
    case 'done':
      return 'done';
  }
}

export function nextStep(cp: ResearchCheckpoint): ResearchStep {
  return next(cp.step, cp);
}

function focusList(cp: ResearchCheckpoint): string[] {
  return cp.focus
    ? [
        `targeted enrichment for: ${cp.focus}. Find the named person or ` +
          'team first, then include closely related leaders and reporting lines ' +
          'only when public evidence supports them.',
      ]
    : [...FOCUSES];
}

function focusLabel(focus: string, index: number): string {
  if (index === 0 && focus.startsWith('targeted enrichment')) return 'Targeted';
  return ['Leadership', 'Engineering', 'Product', 'Revenue', 'Operations'][index] ?? `Pass ${index + 1}`;
}

function callDeadline(deadlineMs: number): number {
  return Math.min(deadlineMs, Date.now() + 60_000);
}

function cloneCheckpoint(cp: ResearchCheckpoint): ResearchCheckpoint {
  return {
    ...cp,
    knownSources: [...cp.knownSources],
    rawPeople: [...cp.rawPeople],
    initiatives: [...cp.initiatives],
    deadSources: [...cp.deadSources],
    ...(cp.sumble ? { sumble: { ...cp.sumble, people: [...cp.sumble.people] } } : {}),
  };
}

function sumbleCheckpoint(data: SumbleOrgData | null): ResearchCheckpoint['sumble'] {
  return data
    ? {
        people: data.people,
        total: data.total ?? 0,
        companyName: data.companyName,
      }
    : null;
}

export function initialCheckpoint(input: {
  domain: string;
  focus?: string | null;
  sellerProfile?: SellerProfile | null;
  knownSources?: string[];
}): ResearchCheckpoint {
  const focus = input.focus?.trim() || null;
  const provider = activeProvider();
  if (provider === 'fixture') {
    const fixture = fixtureOrg(input.domain);
    return {
      domain: input.domain,
      focus,
      sellerProfile: input.sellerProfile ?? null,
      knownSources: input.knownSources ?? [],
      step: 'done',
      discoveryContext: '',
      sumble: null,
      rawPeople: fixture.people,
      companyName: fixture.companyName,
      provider: 'fixture',
      initiatives: [],
      deadSources: [],
      passFailures: 0,
      startedAt: new Date().toISOString(),
    };
  }
  return {
    domain: input.domain,
    focus,
    sellerProfile: input.sellerProfile ?? null,
    knownSources: (input.knownSources ?? []).slice(0, 96),
    step: 'discover',
    discoveryContext: '',
    sumble: null,
    rawPeople: [],
    companyName: null,
    provider: null,
    initiatives: [],
    deadSources: [],
    passFailures: 0,
    startedAt: new Date().toISOString(),
  };
}

function partialPeople(cp: ResearchCheckpoint): ResearchedPerson[] {
  return normalizePeople(cp.rawPeople, peopleCapFor(cp.sumble));
}

export function partialResult(cp: ResearchCheckpoint): ResearchResult {
  if (cp.provider === 'fixture') {
    return {
      ...fixtureOrg(cp.domain),
      complete: cp.step === 'done',
      deadSources: cp.deadSources,
    };
  }
  return {
    companyName: cp.companyName,
    domain: cp.domain,
    people: partialPeople(cp),
    provider: cp.provider ?? activeProvider(),
    tier: 'T0',
    demo: false,
    initiatives: cp.initiatives,
    deadSources: cp.deadSources,
    complete: cp.step === 'done',
  };
}

export async function runStep(
  cp: ResearchCheckpoint,
  opts: {
    deadlineMs: number;
    deps?: Partial<PipelineDeps>;
    emit: (event: ResearchEvent) => void;
  }
): Promise<ResearchCheckpoint> {
  const deps = mergeDeps(opts.deps);
  const current = cloneCheckpoint(cp);
  if (current.step === 'done') return current;

  if (current.step === 'discover') {
    try {
      current.discoveryContext = await deps.exaPeopleContext(
        current.domain,
        current.focus ?? undefined
      );
      opts.emit(event('discover', 'info', 'Discovery complete'));
    } catch (error) {
      current.discoveryContext = '';
      opts.emit(
        event('discover', 'warn', `Discovery failed: ${String(error).slice(0, 160)}`)
      );
    }
  } else if (current.step === 'sumble') {
    try {
      const sumble = await deps.sumbleOrgPeople(
        current.domain,
        Math.min(opts.deadlineMs, Date.now() + 30_000)
      );
      current.sumble = sumbleCheckpoint(sumble);
      opts.emit(event('sumble', 'info', 'Structured organization data complete'));
    } catch (error) {
      current.sumble = null;
      opts.emit(
        event('sumble', 'warn', `Structured organization data failed: ${String(error).slice(0, 160)}`)
      );
    }
  } else if (current.step === 'passes') {
    const focuses = focusList(current);
    const passes = await Promise.allSettled(
      focuses.map(async (focus, index) => {
        const result = await deps.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: researchPrompt(current.domain, focus, current.discoveryContext),
            },
          ],
          {
            webSearch: true,
            maxTokens: 8_000,
            deadlineMs: callDeadline(opts.deadlineMs),
          }
        );
        const parsed = extractJson(result.content) as {
          companyName?: unknown;
          people?: unknown;
        };
        const people = Array.isArray(parsed.people) ? parsed.people : [];
        opts.emit(
          event(
            'passes',
            'info',
            `${focusLabel(focus, index)} pass: ${people.length} people`,
            people.length
          )
        );
        return { parsed, provider: result.provider };
      })
    );
    let successful = 0;
    for (let index = 0; index < passes.length; index += 1) {
      const pass = passes[index];
      if (pass.status === 'fulfilled') {
        successful += 1;
        current.rawPeople.push(
          ...(Array.isArray(pass.value.parsed.people) ? pass.value.parsed.people : [])
        );
        if (typeof pass.value.parsed.companyName === 'string' && !current.companyName) {
          current.companyName = pass.value.parsed.companyName;
        }
        current.provider ??= pass.value.provider;
        continue;
      }
      current.passFailures += 1;
      const label = focusLabel(focuses[index] ?? '', index);
      opts.emit(
        event('passes', 'warn', `${label} pass failed: ${String(pass.reason).slice(0, 160)}`)
      );
    }
    if (successful === 0) throw new Error('All company research passes failed');
  } else if (current.step === 'initiatives') {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: initiativesPrompt(current.domain, current.sellerProfile),
      },
    ];
    try {
      let result;
      try {
        result = await deps.chat(messages, {
          webSearch: true,
          maxTokens: 4_000,
          deadlineMs: callDeadline(opts.deadlineMs),
        });
      } catch {
        result = await deps.chat(messages, {
          json: true,
          maxTokens: 4_000,
          deadlineMs: callDeadline(opts.deadlineMs),
        });
      }
      const parsed = extractJson(result.content) as { initiatives?: unknown };
      current.initiatives = normalizeInitiatives(parsed.initiatives);
      current.provider ??= result.provider;
      opts.emit(
        event('initiatives', 'info', `Initiatives complete: ${current.initiatives.length}`)
      );
    } catch (error) {
      opts.emit(
        event('initiatives', 'warn', `Initiatives failed: ${String(error).slice(0, 160)}`)
      );
    }
  } else if (current.step === 'followup') {
    const people = partialPeople(current);
    const missing = missingFunctions(people);
    if (missing.length > 0) {
      try {
        const result = await deps.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: researchPrompt(
                current.domain,
                `missing or underrepresented functions: ${missing.join(', ')}. ` +
                  'Return only people you can verify; some functions may not exist.',
                current.discoveryContext
              ),
            },
          ],
          {
            webSearch: true,
            maxTokens: 4_000,
            deadlineMs: callDeadline(opts.deadlineMs),
          }
        );
        const parsed = extractJson(result.content) as { people?: unknown };
        current.rawPeople.push(
          ...(Array.isArray(parsed.people) ? parsed.people : [])
        );
        current.provider ??= result.provider;
        opts.emit(event('followup', 'info', `Follow-up complete: ${missing.length} gaps checked`));
      } catch (error) {
        opts.emit(
          event('followup', 'warn', `Follow-up failed: ${String(error).slice(0, 160)}`)
        );
      }
    } else {
      opts.emit(event('followup', 'info', 'No missing functions found'));
    }
  } else if (current.step === 'dead_sources') {
    try {
      current.deadSources = Array.from(
        await deps.deadSourceUrls(new Set(current.knownSources), opts.deadlineMs)
      );
      opts.emit(
        event('dead_sources', 'info', `Checked ${current.knownSources.length} known sources`)
      );
    } catch (error) {
      opts.emit(
        event('dead_sources', 'warn', `Dead-source check failed: ${String(error).slice(0, 160)}`)
      );
    }
  } else if (current.step === 'verify') {
    const people = partialPeople(current);
    try {
      await deps.resolveSourceUrls(
        people,
        current.initiatives,
        Math.min(opts.deadlineMs, Date.now() + 45_000)
      );
      await deps.verifyTitleClaims(
        people,
        Math.min(opts.deadlineMs, Date.now() + 30_000)
      );
      current.rawPeople = people;
      opts.emit(event('verify', 'info', `Evidence verification complete: ${people.length} people`, people.length));
    } catch (error) {
      opts.emit(
        event('verify', 'warn', `Evidence verification failed: ${String(error).slice(0, 160)}`)
      );
    }
  }
  current.step = nextStep(current);
  return current;
}

export async function runToCompletion(
  checkpoint: ResearchCheckpoint,
  opts: {
    deadlineMs: number;
    deps?: Partial<PipelineDeps>;
    emit?: (event: ResearchEvent) => void;
    persist?: (checkpoint: ResearchCheckpoint, partial: ResearchResult) => Promise<void>;
  }
): Promise<ResearchCheckpoint> {
  let current = checkpoint;
  const emit = opts.emit ?? (() => undefined);
  while (current.step !== 'done') {
    if (Date.now() >= opts.deadlineMs) {
      if (opts.persist) await opts.persist(current, partialResult(current));
      return current;
    }
    current = await runStep(current, {
      deadlineMs: opts.deadlineMs,
      deps: opts.deps,
      emit,
    });
    if (opts.persist) await opts.persist(current, partialResult(current));
  }
  emit(
    event(
      'done',
      'info',
      `Research complete: ${partialResult(current).people.length} people`,
      partialResult(current).people.length
    )
  );
  if (opts.persist) await opts.persist(current, partialResult(current));
  return current;
}
