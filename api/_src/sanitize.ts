import type {
  AccountStrategyPlan,
  CompanyProfile,
  MapEdge,
  MapGroup,
  MapState,
  Person,
  StrategicInitiative,
} from './types.js';

export function mapRefinementCounts(previous: MapState, next: MapState) {
  const nextPeople = new Map(
    (next.people ?? []).filter(Boolean).map((person) => [person.id, person])
  );
  let fieldChanges = 0;
  for (const person of (previous.people ?? []).filter(Boolean)) {
    const updated = nextPeople.get(person.id);
    if (!updated) continue;
    for (const field of [
      'title',
      'department',
      'team',
      'productLine',
      'role',
      'confidence',
    ] as const) {
      if ((person[field] ?? null) !== (updated[field] ?? null)) fieldChanges += 1;
    }
  }
  const edgeKey = (edge: MapState['edges'][number]) =>
    [edge.from, edge.to, edge.kind, edge.inferred ? 'inferred' : 'sourced'].join(
      ':'
    );
  const previousEdges = new Set(
    (previous.edges ?? []).filter(Boolean).map(edgeKey)
  );
  const nextEdges = new Set(
    (next.edges ?? []).filter(Boolean).map(edgeKey)
  );
  const relationshipChanges =
    [...previousEdges].filter((key) => !nextEdges.has(key)).length +
    [...nextEdges].filter((key) => !previousEdges.has(key)).length;
  return { fieldChanges, relationshipChanges };
}

function sanitizeStrategyPlan(
  input: unknown
): AccountStrategyPlan | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const rawStakeholders =
    value.stakeholders && typeof value.stakeholders === 'object'
      ? (value.stakeholders as Record<string, unknown>)
      : {};
  const stakeholders = Object.fromEntries(
    Object.entries(rawStakeholders)
      .slice(0, 500)
      .map(([id, item]) => {
        const row =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        const stance: AccountStrategyPlan['stakeholders'][string]['stance'] =
          row.stance === 'advocate' ||
          row.stance === 'neutral' ||
          row.stance === 'skeptic' ||
          row.stance === 'unknown'
            ? row.stance
            : 'unknown';
        return [
          id,
          {
            stance,
            nextStep:
              typeof row.nextStep === 'string'
                ? row.nextStep.slice(0, 500)
                : '',
            note: typeof row.note === 'string' ? row.note.slice(0, 500) : '',
          },
        ];
      })
  );
  const tasks = Array.isArray(value.tasks)
    ? value.tasks
        .slice(0, 50)
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          if (typeof row.id !== 'string' || typeof row.title !== 'string') {
            return null;
          }
          return {
            id: row.id.slice(0, 200),
            title: row.title.slice(0, 500),
            done: row.done === true,
            ...(typeof row.personId === 'string'
              ? { personId: row.personId.slice(0, 200) }
              : {}),
            source:
              row.source === 'manual'
                ? ('manual' as const)
                : ('generated' as const),
            createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];
  return {
    ...(typeof value.entryPersonId === 'string' ||
    value.entryPersonId === null
      ? { entryPersonId: value.entryPersonId }
      : {}),
    ...(typeof value.targetPersonId === 'string' ||
    value.targetPersonId === null
      ? { targetPersonId: value.targetPersonId }
      : {}),
    stakeholders,
    tasks,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

function sanitizeCompanyProfile(input: unknown): CompanyProfile | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const text = (key: string): string | null => {
    const raw = value[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed || null;
  };
  const number = (key: string): number | null => {
    const raw = value[key];
    const parsed =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const url = (key: string): string | null => {
    const raw = text(key);
    return raw && /^https?:\/\//i.test(raw) ? raw : null;
  };
  const fiscalYearEndMonth = number('fiscalYearEndMonth');
  return {
    companyName: text('companyName'),
    description: text('description'),
    mission: text('mission'),
    headquarters: text('headquarters'),
    annualRevenue: text('annualRevenue'),
    annualRevenueUsd: number('annualRevenueUsd'),
    employeeCount: number('employeeCount'),
    engineerCount: number('engineerCount'),
    industry: text('industry'),
    fiscalYearEndMonth:
      fiscalYearEndMonth !== null &&
      fiscalYearEndMonth >= 1 &&
      fiscalYearEndMonth <= 12
        ? fiscalYearEndMonth
        : null,
    linkedinUrl: url('linkedinUrl')?.replace(/\/+$/, '') ?? null,
    annualReportUrl: url('annualReportUrl'),
    funding: text('funding'),
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (item): item is string =>
            typeof item === 'string' && /^https?:\/\//i.test(item)
        )
      : [],
    retrievedAt: typeof value.retrievedAt === 'string' ? value.retrievedAt : '',
  };
}

export function sanitizeState(input: unknown): MapState {
  const s = (input ?? {}) as Partial<MapState>;
  // Normalize sub-fields too — stored states are read by every surface
  // (canvas, share links, analysis) and missing person/initiative fields
  // crash them.
  const people = (Array.isArray(s.people) ? s.people.slice(0, 1500) : []).map(
    (p) => {
      const person = (p ?? {}) as Partial<Person>;
      return {
        ...person,
        name: person.name ?? '',
        title: person.title ?? '',
        role: person.role ?? 'none',
        notes: person.notes ?? '',
        sources: Array.isArray(person.sources) ? person.sources : [],
        email: person.email ?? null,
        linkedin: person.linkedin ?? null,
        metWith: person.metWith === true,
        confidence: person.confidence ?? 'low',
        x: typeof person.x === 'number' ? person.x : 0,
        y: typeof person.y === 'number' ? person.y : 0,
      } as Person;
    }
  );
  const edges = (Array.isArray(s.edges) ? s.edges.slice(0, 5000) : []).map(
    (e) => {
      const edge = (e ?? {}) as Partial<MapEdge>;
      return {
        ...edge,
        kind: edge.kind === 'influence' ? 'influence' : 'reports',
        label: edge.label ?? null,
      } as MapEdge;
    }
  );
  const meta = (s.meta ?? {}) as MapState['meta'];
  const strategy = sanitizeStrategyPlan(meta.strategy);
  const groups = (Array.isArray(s.groups) ? s.groups.slice(0, 200) : [])
    .flatMap((item): MapGroup[] => {
      const group = (item ?? {}) as Partial<MapGroup>;
      if (typeof group.id !== 'string' || typeof group.name !== 'string') {
        return [];
      }
      return [{
        id: group.id,
        name: group.name,
        parentGroupId:
          typeof group.parentGroupId === 'string' || group.parentGroupId === null
            ? group.parentGroupId
            : null,
        ...(typeof group.function === 'string' || group.function === null
          ? { function: group.function }
          : {}),
      }];
    });
  return {
    people,
    edges,
    ...(Array.isArray(s.groups) ? { groups } : {}),
    meta: {
      domain: typeof meta.domain === 'string' ? meta.domain : '',
      companyName: meta.companyName ?? null,
      researchedAt: meta.researchedAt ?? null,
      tier: meta.tier ?? 'manual',
      provider: meta.provider ?? null,
      refreshCadence:
        meta.refreshCadence === 'monthly' || meta.refreshCadence === 'manual'
          ? meta.refreshCadence
          : 'weekly',
      nextRefreshAt:
        typeof meta.nextRefreshAt === 'string' ? meta.nextRefreshAt : null,
      initiatives: (Array.isArray(meta.initiatives)
        ? meta.initiatives.slice(0, 20)
        : []
      ).map((i) => {
        const initiative = (i ?? {}) as Partial<StrategicInitiative>;
        return {
          ...initiative,
          name: initiative.name ?? 'Unnamed',
          summary: initiative.summary ?? '',
          category:
            initiative.category === 'growth' ||
            initiative.category === 'operations' ||
            initiative.category === 'technology' ||
            initiative.category === 'market' ||
            initiative.category === 'product'
              ? initiative.category
              : 'product',
          evidence: Array.isArray(initiative.evidence)
            ? initiative.evidence
            : [],
          relevantPeople: Array.isArray(initiative.relevantPeople)
            ? initiative.relevantPeople
            : [],
          relevantTeams: Array.isArray(initiative.relevantTeams)
            ? initiative.relevantTeams
            : [],
          salesAngles: Array.isArray(initiative.salesAngles)
            ? initiative.salesAngles
            : [],
        } as StrategicInitiative;
      }),
      companyProfile: sanitizeCompanyProfile(meta.companyProfile),
      ...(strategy ? { strategy } : {}),
    },
  };
}
