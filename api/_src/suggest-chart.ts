import { classifyTitle, functionToDepartment, seniorityToJobLevel } from './classify.js';
import { personMatchesPersona } from './coverage.js';
import {
  atLeast,
  FN_LABELS,
  isFn,
  isSeniority,
  personDepartmentToFn,
  personSeniority,
  seniorityRank,
  type Fn,
  type Seniority,
} from './taxonomy.js';
import { activeProvider, chat, type ChatResult } from './llm.js';
import type { Persona } from './personas.js';
import type { RosterPersonRow } from './roster.js';
import type { MapEdge, Person } from './types.js';

export type Confidence = 'high' | 'medium' | 'low';
export type EvidenceKind =
  | 'sumble_relationship'
  | 'research_reportsTo'
  | 'title_inference'
  | 'llm';
export interface SuggestedGroup {
  id: string;
  name: string;
  parentGroupId: string | null;
  function: Fn | null;
  confidence: Confidence;
}
export interface SuggestedPerson {
  rosterId: string;
  name: string;
  title: string;
  function: Fn;
  seniority: Seniority;
  groupId: string;
  reportsToRosterId: string | null;
  reportsToPersonId: string | null;
  confidence: Confidence;
  evidence: {
    kind: EvidenceKind;
    sourceUrl?: string;
    note?: string;
  };
}
export interface ChartSuggestion {
  groups: SuggestedGroup[];
  people: SuggestedPerson[];
  stats: {
    candidates: number;
    suggested: number;
    withEvidenceEdges: number;
  };
}
export interface SuggestChartOptions {
  functions?: Fn[];
  minSeniority?: Seniority;
  limit?: number;
  personasOnly?: boolean;
  guidance?: string;
  excludeRosterIds?: string[];
}
export interface SuggestChartInput {
  roster: RosterPersonRow[];
  mapPeople: Person[];
  mapEdges: MapEdge[];
  personas?: Persona[];
  options: SuggestChartOptions;
}

interface Candidate {
  row: RosterPersonRow;
  fn: Fn;
  seniority: Seniority;
  groupId: string;
  region: string | null;
}

const REGION_WORDS: Record<string, string[]> = {
  EMEA: [
    'uk', 'united kingdom', 'london', 'germany', 'berlin', 'france', 'paris',
    'netherlands', 'amsterdam', 'ireland', 'dublin', 'spain', 'italy', 'sweden',
    'poland', 'israel', 'dubai', 'uae', 'south africa', 'emea', 'europe',
  ],
  APAC: [
    'australia', 'sydney', 'singapore', 'japan', 'tokyo', 'india', 'bangalore',
    'bengaluru', 'china', 'hong kong', 'korea', 'apac', 'asia',
  ],
  LATAM: [
    'brazil', 'são paulo', 'sao paulo', 'mexico', 'argentina', 'colombia',
    'chile', 'latam',
  ],
  AMER: [
    'united states', 'usa', 'us', 'canada', 'toronto', 'new york',
    'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'denver',
    'los angeles', 'amer', 'north america', 'remote - us',
  ],
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REGION_PATTERNS = Object.fromEntries(
  Object.entries(REGION_WORDS).map(([region, words]) => [
    region,
    new RegExp(`\\b(${words.map(escapeRegex).join('|')})\\b`, 'i'),
  ])
) as Record<string, RegExp>;

function regionFor(row: RosterPersonRow): string | null {
  for (const text of [row.location ?? '', row.title ?? '']) {
    for (const [region, pattern] of Object.entries(REGION_PATTERNS)) {
      if (pattern.test(text)) return region;
    }
  }
  return null;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function confidenceAtMostMedium(confidence: Confidence): Confidence {
  return confidence === 'low' ? 'low' : 'medium';
}

function guidancePriority(guidance: string): Fn[] {
  const value = guidance.toLowerCase();
  if (/gtm|go\.to\.market|sales leadership|revenue/.test(value)) {
    return ['sales', 'marketing', 'customer_success'];
  }
  if (/technical|engineering|cto|decision makers/.test(value)) {
    return ['engineering', 'security', 'it', 'data', 'product'];
  }
  return [];
}

function groupForCandidate(candidate: Candidate, leadership: boolean): string {
  return leadership ? 'grp:leadership' : `grp:fn:${candidate.fn}`;
}

function wouldCycle(
  parentByChild: Map<string, string>,
  child: string,
  parent: string
): boolean {
  if (child === parent) return true;
  const seen = new Set<string>();
  let cursor: string | undefined = parent;
  while (cursor && !seen.has(cursor)) {
    if (cursor === child) return true;
    seen.add(cursor);
    cursor = parentByChild.get(cursor);
  }
  return false;
}

export function buildChartSuggestion(input: SuggestChartInput): ChartSuggestion {
  const options = input.options ?? {};
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 200)));
  const functions = options.functions?.length ? new Set(options.functions) : null;
  const excluded = new Set(options.excludeRosterIds ?? []);
  const personas = input.personas ?? [];
  const guidance = options.guidance ?? '';
  const candidates = input.roster.flatMap((row): Candidate[] => {
    if (
      row.status !== 'suggested' ||
      excluded.has(row.id)
    ) return [];
    const classified = classifyTitle(row.title);
    const fn = isFn(row.function) ? row.function : classified.function as Fn;
    const seniority = isSeniority(row.seniority)
      ? row.seniority
      : classified.seniority as Seniority;
    if (functions && !functions.has(fn)) return [];
    if (options.minSeniority && !atLeast(seniority, options.minSeniority)) {
      return [];
    }
    if (
      options.personasOnly &&
      personas.length > 0 &&
      !personas.some((persona) => personMatchesPersona(persona, {
          id: row.id,
          name: row.name,
          title: row.title ?? '',
          department: functionToDepartment(fn),
          jobLevel: seniorityToJobLevel(seniority),
        }))
    ) return [];
    return [{ row, fn, seniority, groupId: '', region: regionFor(row) }];
  });
  const priority = guidancePriority(guidance);
  const priorityRank = new Map(priority.map((fn, index) => [fn, index]));
  candidates.sort((a, b) =>
    (priorityRank.get(a.fn) ?? priority.length) -
      (priorityRank.get(b.fn) ?? priority.length) ||
    seniorityRank(a.seniority) - seniorityRank(b.seniority) ||
    a.row.name.localeCompare(b.row.name)
  );
  const selected = candidates.slice(0, limit);
  const hasLeadership = selected.some(
    (candidate) =>
      candidate.seniority === 'c_level' || candidate.seniority === 'evp_svp'
  );
  for (const candidate of selected) {
    candidate.groupId = groupForCandidate(candidate, hasLeadership &&
      (candidate.seniority === 'c_level' || candidate.seniority === 'evp_svp'));
  }

  const groupMembers = new Map<string, Candidate[]>();
  for (const candidate of selected) {
    const list = groupMembers.get(candidate.groupId) ?? [];
    list.push(candidate);
    groupMembers.set(candidate.groupId, list);
  }
  const groups: SuggestedGroup[] = [];
  if (hasLeadership) {
    groups.push({
      id: 'grp:leadership',
      name: 'Leadership',
      parentGroupId: null,
      function: null,
      confidence: 'high',
    });
  }
  const functionsPresent = [...new Set(
    selected
      .filter((candidate) => candidate.groupId !== 'grp:leadership')
      .map((candidate) => candidate.fn)
  )];
  for (const fn of functionsPresent) {
    groups.push({
      id: `grp:fn:${fn}`,
      name: FN_LABELS[fn],
      parentGroupId: hasLeadership ? 'grp:leadership' : null,
      function: fn,
      confidence: 'low',
    });
  }
  const useRegions = /region|geo|emea|apac|amer|latam|europe|asia|americas/i.test(guidance);
  if (useRegions) {
    for (const fn of functionsPresent) {
      for (const region of Object.keys(REGION_WORDS)) {
        const members = selected.filter(
          (candidate) =>
            candidate.fn === fn &&
            candidate.region === region &&
            candidate.groupId !== 'grp:leadership'
        );
        if (members.length >= 2) {
          groups.push({
            id: `grp:fn:${fn}:${region}`,
            name: `${FN_LABELS[fn]} — ${region}`,
            parentGroupId: `grp:fn:${fn}`,
            function: fn,
            confidence: 'low',
          });
        }
      }
    }
  }
  for (const candidate of selected) {
    if (candidate.groupId !== 'grp:leadership' && useRegions && candidate.region) {
      const regional = groups.find(
        (group) => group.id === `grp:fn:${candidate.fn}:${candidate.region}`
      );
      if (regional) candidate.groupId = regional.id;
    }
  }

  const rowByKey = new Map(input.roster.map((row) => [row.person_key, row]));
  const candidateByKey = new Map(selected.map((candidate) => [candidate.row.person_key, candidate]));
  const mapPeopleById = new Map(input.mapPeople.map((person) => [person.id, person]));
  const mapPeopleByName = new Map(input.mapPeople.map((person) => [normalizeName(person.name), person]));
  const rosterMapByPersonKey = new Map(
    input.roster.filter((row) => row.status === 'added' && row.map_person_id)
      .map((row) => [row.person_key, row])
  );
  const parentByRosterId = new Map<string, string>();
  const result: SuggestedPerson[] = [];
  for (const candidate of selected) {
    const row = candidate.row;
    let reportsToRosterId: string | null = null;
    let reportsToPersonId: string | null = null;
    let confidence: Confidence = row.confidence;
    let evidence: SuggestedPerson['evidence'] = {
      kind: 'title_inference',
      note: 'reports to group',
    };
    const managerKey = row.manager_key;
    const managerCandidate = managerKey ? candidateByKey.get(managerKey) : undefined;
    if (managerCandidate && managerCandidate.row.id !== row.id &&
        !wouldCycle(parentByRosterId, row.id, managerCandidate.row.id)) {
      reportsToRosterId = managerCandidate.row.id;
      parentByRosterId.set(row.id, managerCandidate.row.id);
      confidence = 'high';
      evidence = {
        kind: row.source === 'sumble' ? 'sumble_relationship' : 'research_reportsTo',
        ...(row.source !== 'sumble' ? { note: 'manager column from import' } : {}),
        ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      };
    } else if (managerKey) {
      const added = rosterMapByPersonKey.get(managerKey);
      const addedPerson = added?.map_person_id ? mapPeopleById.get(added.map_person_id) : undefined;
      const managerRoster = rowByKey.get(managerKey);
      const byName = mapPeopleByName.get(
        normalizeName(managerRoster?.name ?? managerKey)
      ) ?? mapPeopleByName.get(normalizeName(managerKey));
      if (addedPerson) {
        reportsToPersonId = addedPerson.id;
        confidence = 'high';
        evidence = {
          kind: row.source === 'sumble' ? 'sumble_relationship' : 'research_reportsTo',
          ...(row.source !== 'sumble' ? { note: 'manager column from import' } : {}),
          ...(row.source_url ? { sourceUrl: row.source_url } : {}),
        };
      } else if (byName) {
        reportsToPersonId = byName.id;
        confidence = 'medium';
        evidence = {
          kind: 'research_reportsTo',
          note: `matched existing map person ${byName.name}`,
          ...(row.source_url ? { sourceUrl: row.source_url } : {}),
        };
      }
    }
    if (!reportsToRosterId && !reportsToPersonId) {
      const fn = candidate.fn;
      const sameFnMap = input.mapPeople
        .filter((person) => personDepartmentToFn(person.department, person.title) === fn)
        .filter((person) => {
          const needle = (person.team ?? person.department ?? '').toLowerCase();
          return input.mapEdges.some(
            (edge) => edge.kind === 'reports' && edge.from === person.id
          ) || (needle.length >= 3 && (row.title ?? '').toLowerCase().includes(needle));
        })
        .map((person) => ({
          person,
          rank: seniorityRank(personSeniority(person.jobLevel, person.title)),
        }))
        .filter(({ rank }) => rank === seniorityRank(candidate.seniority) - 1)
        .sort((a, b) => a.person.name.localeCompare(b.person.name));
      const existing = sameFnMap[0]?.person;
      if (existing) {
        reportsToPersonId = existing.id;
        confidence = 'medium';
        evidence = {
          kind: 'research_reportsTo',
          note: `matched existing map person ${existing.name}`,
        };
      }
    }
    if (!reportsToRosterId && !reportsToPersonId) {
      const sameGroup = selected
        .filter((other) =>
          other.row.id !== row.id &&
          other.fn === candidate.fn &&
          seniorityRank(other.seniority) < seniorityRank(candidate.seniority)
        )
        .sort((a, b) =>
          seniorityRank(a.seniority) - seniorityRank(b.seniority) ||
          a.row.name.localeCompare(b.row.name)
        );
      const inferred = sameGroup[0];
      if (inferred && !wouldCycle(parentByRosterId, row.id, inferred.row.id)) {
        reportsToRosterId = inferred.row.id;
        parentByRosterId.set(row.id, inferred.row.id);
        confidence = 'low';
        evidence = { kind: 'title_inference', note: 'inferred from title seniority' };
      } else {
        confidence = confidenceAtMostMedium(confidence);
      }
    }
    result.push({
      rosterId: row.id,
      name: row.name,
      title: row.title ?? 'Employee',
      function: candidate.fn,
      seniority: candidate.seniority,
      groupId: candidate.groupId,
      reportsToRosterId,
      reportsToPersonId,
      confidence,
      evidence,
    });
  }
  const resultByGroup = new Map<string, SuggestedPerson[]>();
  for (const person of result) {
    const list = resultByGroup.get(person.groupId) ?? [];
    list.push(person);
    resultByGroup.set(person.groupId, list);
  }
  for (const group of groups) {
    if (group.id === 'grp:leadership') continue;
    const descendantIds = new Set([group.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of groups) {
        if (child.parentGroupId && descendantIds.has(child.parentGroupId) &&
            !descendantIds.has(child.id)) {
          descendantIds.add(child.id);
          changed = true;
        }
      }
    }
    const members = [...descendantIds].flatMap((id) => resultByGroup.get(id) ?? []);
    const sourced = members.filter(
      (person) =>
        (person.evidence.kind === 'sumble_relationship' ||
          person.evidence.kind === 'research_reportsTo') &&
        Boolean(person.reportsToRosterId || person.reportsToPersonId)
    ).length;
    group.confidence = members.length > 0 && sourced >= members.length / 2
      ? 'high'
      : sourced > 0 ? 'medium' : 'low';
  }
  return {
    groups,
    people: result,
    stats: {
      candidates: candidates.length,
      suggested: result.length,
      withEvidenceEdges: result.filter(
        (person) =>
          (person.evidence.kind === 'sumble_relationship' ||
            person.evidence.kind === 'research_reportsTo') &&
          Boolean(person.reportsToRosterId || person.reportsToPersonId)
      ).length,
    },
  };
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 60;
}

function patchJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

export function applyLlmPatch(
  suggestion: ChartSuggestion,
  patch: unknown
): ChartSuggestion {
  const value = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
  const groups = suggestion.groups.map((group) => ({ ...group }));
  const people = suggestion.people.map((person) => ({
    ...person,
    evidence: { ...person.evidence },
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  if (Array.isArray(value.renames)) {
    for (const item of value.renames) {
      if (!item || typeof item !== 'object') continue;
      const rename = item as Record<string, unknown>;
      const group = typeof rename.groupId === 'string'
        ? groupById.get(rename.groupId) : undefined;
      if (group && validName(rename.name)) group.name = rename.name;
    }
  }
  const newGroupIds = new Map<string, string>();
  if (Array.isArray(value.newGroups)) {
    for (const item of value.newGroups) {
      if (!item || typeof item !== 'object') continue;
      const group = item as Record<string, unknown>;
      const rawParent =
        typeof group.parentGroupId === 'string' || group.parentGroupId === null
          ? group.parentGroupId
          : undefined;
      const parentId =
        typeof rawParent === 'string' ? newGroupIds.get(rawParent) ?? rawParent : null;
      if (
        typeof group.id !== 'string' ||
        !validName(group.name) ||
        rawParent === undefined ||
        (parentId !== null && !groupById.has(parentId))
      ) continue;
      const id = `grp:llm:${group.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}`;
      if (id === 'grp:llm:' || groupById.has(id)) continue;
      const parentByGroup = new Map<string, string>();
      for (const existing of groups) {
        if (existing.parentGroupId) parentByGroup.set(existing.id, existing.parentGroupId);
      }
      if (parentId !== null && wouldCycle(parentByGroup, id, parentId)) continue;
      const parent = parentId ? groupById.get(parentId) : undefined;
      const created: SuggestedGroup = {
        id,
        name: group.name,
        parentGroupId: parentId,
        function: parent?.function ?? null,
        confidence: 'medium',
      };
      groups.push(created);
      groupById.set(id, created);
      newGroupIds.set(group.id, id);
      if (Array.isArray(group.rosterIds)) {
        for (const rosterId of group.rosterIds) {
          const person = people.find((candidate) => candidate.rosterId === rosterId);
          if (person) {
            person.groupId = id;
            if (person.evidence.kind === 'title_inference') {
              person.evidence = { kind: 'llm', note: 'moved by guidance' };
            }
          }
        }
      }
    }
  }
  if (Array.isArray(value.moves)) {
    for (const item of value.moves) {
      if (!item || typeof item !== 'object') continue;
      const move = item as Record<string, unknown>;
      if (typeof move.rosterId !== 'string' || typeof move.groupId !== 'string') continue;
      const groupId = newGroupIds.get(move.groupId) ?? move.groupId;
      if (!groupById.has(groupId)) continue;
      const person = people.find((candidate) => candidate.rosterId === move.rosterId);
      if (!person) continue;
      person.groupId = groupId;
      if (person.evidence.kind === 'title_inference') {
        person.evidence = { kind: 'llm', note: 'moved by guidance' };
      }
    }
  }
  return {
    groups,
    people,
    stats: { ...suggestion.stats },
  };
}

export async function refineWithLlm(
  suggestion: ChartSuggestion,
  guidance: string,
  deps: { chat: typeof chat } = { chat }
): Promise<ChartSuggestion> {
  if (!guidance.trim() || activeProvider() === 'fixture') return suggestion;
  try {
    const compact = {
      groups: suggestion.groups,
      people: suggestion.people.slice(0, 300).map((person) => ({
        rosterId: person.rosterId,
        name: person.name,
        title: person.title,
        groupId: person.groupId,
      })),
    };
    const response: ChatResult = await deps.chat(
      [
        {
          role: 'system',
          content:
            'You rename/move groups only. Respond with JSON matching exactly: {"renames":[{"groupId":"...","name":"..."}],"moves":[{"rosterId":"...","groupId":"..."}],"newGroups":[{"id":"...","name":"...","parentGroupId":"...","rosterIds":["..."]}]}. Do not create reporting lines or alter people fields other than group moves.',
        },
        {
          role: 'user',
          content: `Guidance: ${guidance}\nDraft:\n${JSON.stringify(compact)}`,
        },
      ],
      { json: true, deadlineMs: Date.now() + 8_000, maxTokens: 800 }
    );
    return applyLlmPatch(suggestion, patchJson(response.content));
  } catch {
    return suggestion;
  }
}
