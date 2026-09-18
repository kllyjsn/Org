import type { Person } from '../types';

export type AgentGroupingField =
  | 'department'
  | 'team'
  | 'productLine'
  | 'businessUnit';
export type AgentRelationshipView = 'all' | 'reports' | 'influence';

export interface AgentCommand {
  run: () => string;
  preview: AgentActionPreview;
}

export type AgentActionPreview =
  | {
      kind: 'group';
      title: string;
      groups: { name: string; count: number; inferred: number }[];
      inferredCount: number;
      source: 'sourced' | 'inferred' | 'mixed';
    }
  | {
      kind: 'relationship_view';
      title: string;
      view: AgentRelationshipView;
      inferredCount: number;
      source: 'sourced';
    }
  | {
      kind: 'edit';
      title: string;
      people: { name: string; changes: string[] }[];
      inferredCount: number;
      source: 'sourced' | 'inferred' | 'mixed';
    }
  | {
      kind: 'relationship';
      title: string;
      edges: {
        from: string;
        to: string;
        kind: 'reports' | 'influence';
        inferred?: boolean;
      }[];
      inferredCount: number;
      source: 'sourced' | 'inferred';
    };

export interface AgentCommandResult {
  message: string;
  command?: AgentCommand;
}

const FIELD_LABEL: Record<AgentGroupingField, string> = {
  department: 'department',
  team: 'team',
  productLine: 'product line',
  businessUnit: 'business unit',
};

function fieldValue(person: Person, field: AgentGroupingField) {
  if (field === 'businessUnit') return person.department;
  return person[field] ?? person.department;
}

function summarizeGrouping(
  people: Person[],
  field: AgentGroupingField
): Extract<AgentActionPreview, { kind: 'group' }> {
  const groups = new Map<string, { count: number; inferred: number }>();
  for (const person of people) {
    const name = fieldValue(person, field) ?? 'Unassigned';
    const current = groups.get(name) ?? { count: 0, inferred: 0 };
    current.count += 1;
    if (person.teamEvidence === 'inferred') current.inferred += 1;
    groups.set(name, current);
  }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([name, value]) => ({
      name,
      count: value.count,
      inferred: value.inferred,
    }));
  const inferredCount = rows.reduce((sum, group) => sum + group.inferred, 0);
  return {
    kind: 'group',
    title: `Group by ${FIELD_LABEL[field]}`,
    groups: rows.slice(0, 8),
    inferredCount,
    source:
      inferredCount === 0
        ? 'sourced'
        : inferredCount === people.length
          ? 'inferred'
          : 'mixed',
  };
}

export function describeGrouping(
  people: Person[],
  field: AgentGroupingField,
  scope: 'map' | 'selection',
  run: () => string
): AgentCommandResult {
  const preview = summarizeGrouping(people, field);
  const grouped = preview.groups.length;
  return {
    message: `Ready to ${scope === 'selection' ? 'split this group' : 'reorganize the map'} by ${FIELD_LABEL[field]} into ${grouped} ${grouped === 1 ? 'lane' : 'lanes'}.`,
    command: { run, preview },
  };
}

export function describeRelationshipView(
  view: AgentRelationshipView,
  run: () => string
): AgentCommandResult {
  const label =
    view === 'all'
      ? 'all relationships'
      : view === 'reports'
        ? 'reporting relationships only'
        : 'influence relationships only';
  return {
    message: `Ready to show ${label}.`,
    command: {
      run,
      preview: {
        kind: 'relationship_view',
        title: `Show ${label}`,
        view,
        inferredCount: 0,
        source: 'sourced',
      },
    },
  };
}

export function describePersonEdit(
  person: Person,
  changes: { label: string; value: string | null; inferred?: boolean }[],
  run: () => string
): AgentCommandResult {
  return {
    message: `Ready to update ${person.name}.`,
    command: {
      run,
      preview: {
        kind: 'edit',
        title: `Update ${person.name}`,
        people: [
          {
            name: person.name,
            changes: changes.map(
              (change) => `${change.label}: ${change.value ?? 'cleared'}`
            ),
          },
        ],
        inferredCount: changes.filter((change) => change.inferred).length,
        source: changes.some((change) => change.inferred) ? 'mixed' : 'sourced',
      },
    },
  };
}

export function describeRelationship(
  from: Person,
  to: Person,
  kind: 'reports' | 'influence',
  inferred: boolean,
  run: () => string
): AgentCommandResult {
  return {
    message:
      kind === 'reports'
        ? `Ready to set ${to.name} reporting to ${from.name}.`
        : `Ready to connect ${from.name} to ${to.name}.`,
    command: {
      run,
      preview: {
        kind: 'relationship',
        title:
          kind === 'reports'
            ? `Set ${to.name} reporting to ${from.name}`
            : `Connect ${from.name} to ${to.name}`,
        edges: [{ from: from.name, to: to.name, kind, inferred }],
        inferredCount: inferred ? 1 : 0,
        source: inferred ? 'inferred' : 'sourced',
      },
    },
  };
}
