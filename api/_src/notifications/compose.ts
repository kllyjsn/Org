import type { MapChangeAlert } from '../changes.js';
import type {
  AccountStrategyPlan,
  BuyingRole,
  Person,
} from '../types.js';
import { coverageBand } from './coverage.js';
import type { CommitteeCoverage } from './coverage.js';

export interface Notice {
  title: string;
  lines: string[];
  ctaLabel: string;
  ctaUrl: string;
}

export const ROLE_LABELS: Partial<Record<BuyingRole, string>> = {
  champion: 'Champion',
  economic_buyer: 'Economic buyer',
  decision_maker: 'Decision maker',
  technical_buyer: 'Technical buyer',
  influencer: 'Influencer',
  blocker: 'Blocker',
};

export function roleLabel(role: BuyingRole | null | undefined): string {
  return (role && ROLE_LABELS[role]) || 'No role';
}

function touchAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'never';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms > nowMs) return 'never';
  const days = Math.floor((nowMs - ms) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const KEY_ROLES: BuyingRole[] = [
  'champion',
  'economic_buyer',
  'decision_maker',
];

export function composeChangeAlert(
  map: { id: string; name: string },
  alerts: MapChangeAlert[],
  strategy: AccountStrategyPlan | null | undefined,
  appUrl: string,
  peopleById: Map<string, Person> = new Map()
): Notice {
  const shown = alerts.slice(0, 8);
  const lines: string[] = shown.map(
    (alert) => `• ${alert.title}${alert.detail ? ` — ${alert.detail}` : ''}`
  );
  if (alerts.length > shown.length) {
    lines.push(`+${alerts.length - shown.length} more`);
  }

  // Re-entry play for key-role churn: prefer the stakeholder's strategy
  // nextStep; otherwise fall back to a generic re-map instruction.
  const plays: string[] = [];
  for (const alert of alerts) {
    if (
      alert.type !== 'role_changed' &&
      alert.type !== 'person_removed' &&
      alert.type !== 'title_changed'
    ) {
      continue;
    }
    const person = alert.personId ? peopleById.get(alert.personId) : undefined;
    const role = person?.role;
    if (!role || !KEY_ROLES.includes(role)) continue;
    const entry = alert.personId
      ? strategy?.stakeholders?.[alert.personId]
      : undefined;
    const name = person?.name ?? alert.title;
    plays.push(
      entry?.nextStep
        ? `Re-entry play: ${entry.nextStep}`
        : `Re-entry play: Confirm ${name}'s new remit, then re-map the ${roleLabel(role)} seat.`
    );
  }
  lines.push(...plays.slice(0, 3));

  return {
    title: `${map.name}: ${alerts.length} change${alerts.length === 1 ? '' : 's'}`,
    lines,
    ctaLabel: 'Open map',
    ctaUrl: `${appUrl}/app/maps/${map.id}`,
  };
}

export function composePreMeetingBrief(
  map: { id: string; name: string },
  meeting: {
    subject: string | null;
    startsAt: string;
    attendees: Person[];
  },
  strategy: AccountStrategyPlan | null | undefined,
  coverage: CommitteeCoverage,
  appUrl: string,
  nowMs = Date.now()
): Notice {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(meeting.startsAt) - nowMs) / 60_000)
  );
  const lines = meeting.attendees.map(
    (person) =>
      `${person.name} — ${person.title} · ${roleLabel(person.role)} · stance ${person.metWith ? 'met' : 'unknown'} · last touch ${touchAgo(person.lastTouchAt, nowMs)}`
  );
  lines.push(
    `Committee: ${coverage.coveredCount}/3 key roles covered${coverage.singleThreaded ? ' · single-threaded' : ''}`
  );

  const attendeeIds = new Set(meeting.attendees.map((p) => p.id));
  const openTasks = (strategy?.tasks ?? []).filter((task) => !task.done);
  const attendeeTasks = openTasks.filter(
    (task) => task.personId && attendeeIds.has(task.personId)
  );
  const tasks = [...attendeeTasks, ...openTasks.filter((t) => !attendeeTasks.includes(t))].slice(
    0,
    3
  );
  for (const task of tasks) {
    lines.push(`• ${task.title}`);
  }

  return {
    title: `Brief: ${meeting.subject ?? 'Meeting'} in ${minutes} min`,
    lines,
    ctaLabel: 'Open map',
    ctaUrl: `${appUrl}/app/maps/${map.id}`,
  };
}

export function composeWeeklyCoverage(
  workspaceName: string,
  maps: {
    map: { id: string; name: string };
    coverage: CommitteeCoverage;
  }[],
  appUrl: string
): Notice {
  const sorted = [...maps].sort((a, b) => a.coverage.score - b.coverage.score);
  const shown = sorted.slice(0, 15);
  const lines = shown.map(({ map, coverage }) => {
    const parts = [
      `${map.name}: ${coverage.score} ${coverageBand(coverage.score)}`,
      `${coverage.coveredCount}/3 roles`,
      `${coverage.threadCount} thread${coverage.threadCount === 1 ? '' : 's'}`,
    ];
    if (coverage.singleThreaded) parts.push('SINGLE-THREADED');
    if (coverage.untouchedKeyPeople.length > 0) {
      parts.push(
        `${coverage.untouchedKeyPeople.length} key ${coverage.untouchedKeyPeople.length === 1 ? 'person' : 'people'} untouched`
      );
    }
    return `• ${parts.join(' · ')}`;
  });
  if (sorted.length > shown.length) {
    lines.push(`+${sorted.length - shown.length} more`);
  }
  const weak = sorted.filter((m) => m.coverage.score < 70).length;
  lines.push(`Live opportunities with weak coverage: ${weak}`);

  return {
    title: `Weekly committee coverage — ${workspaceName}`,
    lines,
    ctaLabel: 'Open maps',
    ctaUrl: `${appUrl}/app`,
  };
}
