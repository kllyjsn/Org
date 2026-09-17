import type { MapState, Person } from './types.js';

export interface MapChangeAlert {
  id: string;
  type:
    | 'person_added'
    | 'person_removed'
    | 'title_changed'
    | 'team_changed'
    | 'role_changed'
    | 'initiative_added'
    | 'initiative_removed';
  title: string;
  detail: string;
  personId?: string;
  sources?: string[];
}

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function peopleByName(people: Person[]) {
  return new Map(people.map((person) => [normalized(person.name), person]));
}

export function compareMapStates(
  baseline: MapState,
  current: MapState
): MapChangeAlert[] {
  const previousPeople = peopleByName(baseline.people ?? []);
  const currentPeople = peopleByName(current.people ?? []);
  const changes: MapChangeAlert[] = [];

  for (const [name, person] of currentPeople) {
    const previous = previousPeople.get(name);
    if (!previous) {
      changes.push({
        id: `person-added-${person.id}`,
        type: 'person_added',
        title: `${person.name} was added`,
        detail: person.title || person.team || person.department || 'New stakeholder',
        personId: person.id,
        sources: person.sources ?? [],
      });
      continue;
    }
    if (normalized(previous.title) !== normalized(person.title)) {
      changes.push({
        id: `title-${person.id}`,
        type: 'title_changed',
        title: `${person.name} has a new title`,
        detail: `${previous.title || 'Unknown'} → ${person.title || 'Unknown'}`,
        personId: person.id,
        sources: person.sources ?? [],
      });
    }
    const previousTeam = previous.team || previous.department || '';
    const currentTeam = person.team || person.department || '';
    if (normalized(previousTeam) !== normalized(currentTeam)) {
      changes.push({
        id: `team-${person.id}`,
        type: 'team_changed',
        title: `${person.name} moved teams`,
        detail: `${previousTeam || 'Unassigned'} → ${currentTeam || 'Unassigned'}`,
        personId: person.id,
        sources: person.sources ?? [],
      });
    }
    if ((previous.role ?? 'none') !== (person.role ?? 'none')) {
      const previousRole = previous.role ?? 'none';
      const currentRole = person.role ?? 'none';
      changes.push({
        id: `role-${person.id}`,
        type: 'role_changed',
        title: `${person.name}'s buying role changed`,
        detail: `${previousRole.replaceAll('_', ' ')} → ${currentRole.replaceAll('_', ' ')}`,
        personId: person.id,
        sources: person.sources ?? [],
      });
    }
  }

  for (const [name, person] of previousPeople) {
    if (!currentPeople.has(name)) {
      changes.push({
        id: `person-removed-${person.id}`,
        type: 'person_removed',
        title: `${person.name} was removed`,
        detail: person.title || person.team || person.department || 'Stakeholder removed',
        sources: person.sources ?? [],
      });
    }
  }

  const previousInitiatives = new Map(
    (baseline.meta?.initiatives ?? []).map((initiative) => [
      normalized(initiative.name),
      initiative,
    ])
  );
  const currentInitiatives = new Map(
    (current.meta?.initiatives ?? []).map((initiative) => [
      normalized(initiative.name),
      initiative,
    ])
  );
  for (const [name, initiative] of currentInitiatives) {
    if (!previousInitiatives.has(name)) {
      changes.push({
        id: `initiative-added-${name}`,
        type: 'initiative_added',
        title: `New initiative: ${initiative.name ?? 'Unnamed'}`,
        detail: initiative.summary ?? '',
        sources: initiative.evidence ?? [],
      });
    }
  }
  for (const [name, initiative] of previousInitiatives) {
    if (!currentInitiatives.has(name)) {
      changes.push({
        id: `initiative-removed-${name}`,
        type: 'initiative_removed',
        title: `Initiative removed: ${initiative.name ?? 'Unnamed'}`,
        detail: initiative.summary ?? '',
        sources: initiative.evidence ?? [],
      });
    }
  }
  return changes;
}
