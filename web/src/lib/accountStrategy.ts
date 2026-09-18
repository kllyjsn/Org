import { personProductFit } from './accountFit';
import type {
  AccountStrategyPlan,
  MapEdge,
  Person,
  SellerProfile,
  Stance,
  StrategicInitiative,
  StrategyInsights,
  StrategyTask,
  StakeholderPlanEntry,
} from '../types';

export type { AccountStrategyPlan, StakeholderPlanEntry, StrategyTask, Stance };

export const EMPTY_PLAN: AccountStrategyPlan = {
  stakeholders: {},
  tasks: [],
  updatedAt: '',
};

export interface RoutePath {
  people: Person[];
  inferredHops: number;
  strength: number;
}

export interface Route {
  target: Person;
  path: RoutePath;
  label: string;
}

export interface CoverageItem {
  key:
    | 'champion'
    | 'economic_buyer'
    | 'decision_maker'
    | 'technical_buyer'
    | 'blocker_identified'
    | 'met_with'
    | 'path'
    | 'initiatives'
    | 'freshness';
  label: string;
  status: 'good' | 'partial' | 'missing';
  detail: string;
  weight: number;
  personIds?: string[];
}

export interface DealHealth {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  items: CoverageItem[];
  gaps: CoverageItem[];
}

export interface Risk {
  id: string;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  personIds?: string[];
  mitigation: string;
}

export interface StrategyInput {
  people: Person[];
  edges: MapEdge[];
  initiatives: StrategicInitiative[];
  sellerProfile: SellerProfile | null;
  plan: AccountStrategyPlan;
}

export interface StrategyOutput {
  entry: Person | undefined;
  target: Person | undefined;
  primaryPath: RoutePath;
  routes: Route[];
  health: DealHealth;
  risks: Risk[];
  objections: string[];
  initiatives: StrategicInitiative[];
  suggestedTasks: StrategyTask[];
  keyPeople: Person[];
}

const ROLE_PRIORITY: Record<Person['role'], number> = {
  champion: 100,
  influencer: 75,
  technical_buyer: 65,
  decision_maker: 55,
  economic_buyer: 50,
  blocker: 10,
  none: 0,
};

const TARGET_PRIORITY: Record<Person['role'], number> = {
  economic_buyer: 100,
  decision_maker: 90,
  technical_buyer: 70,
  champion: 40,
  influencer: 30,
  blocker: 10,
  none: 0,
};

function personScore(
  person: Person,
  priorities: Record<Person['role'], number>,
  sellerProfile: SellerProfile | null
): number {
  const executive =
    /\b(chief|ceo|cto|cio|cfo|coo|president|vp|vice president|head)\b/i.test(
      person.title
    )
      ? 18
      : 0;
  return (
    priorities[person.role ?? 'none'] +
    personProductFit(person, sellerProfile) +
    executive +
    Math.min((person.sources ?? []).length, 5) * 2 +
    (person.confidence === 'high' ? 8 : person.confidence === 'medium' ? 4 : 0)
  );
}

type Hop = { id: string; inferred: boolean; influence: boolean };

function findPath(
  people: Person[],
  edges: MapEdge[],
  startId: string,
  targetId: string
): { ids: string[]; hops: Hop[] } {
  if (startId === targetId) return { ids: [startId], hops: [] };
  const known = new Set(people.map((person) => person.id));
  const adjacency = new Map<string, Hop[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    const hop = { id: edge.to, inferred: Boolean(edge.inferred), influence: edge.kind === 'influence' };
    const reverse = { id: edge.from, inferred: Boolean(edge.inferred), influence: edge.kind === 'influence' };
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), hop]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), reverse]);
  }
  const distance = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { from: string; hop: Hop }>();
  const open = new Set(known);
  while (open.size > 0) {
    const current = [...open].sort(
      (a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity)
    )[0];
    if (!current || !Number.isFinite(distance.get(current) ?? Infinity)) break;
    open.delete(current);
    if (current === targetId) break;
    for (const hop of adjacency.get(current) ?? []) {
      const cost = hop.influence ? 1 : hop.inferred ? 2.2 : 1.4;
      const nextDistance = (distance.get(current) ?? 0) + cost;
      if (nextDistance < (distance.get(hop.id) ?? Infinity)) {
        distance.set(hop.id, nextDistance);
        previous.set(hop.id, { from: current, hop });
      }
    }
  }
  if (!previous.has(targetId)) return { ids: [], hops: [] };
  const ids = [targetId];
  const hops: Hop[] = [];
  while (ids[0] !== startId) {
    const previousHop = previous.get(ids[0]);
    if (!previousHop) return { ids: [], hops: [] };
    hops.unshift(previousHop.hop);
    ids.unshift(previousHop.from);
  }
  return { ids, hops };
}

function routePath(
  people: Person[],
  edges: MapEdge[],
  start: Person | undefined,
  target: Person | undefined
): RoutePath {
  if (!start || !target) return { people: [], inferredHops: 0, strength: 0 };
  const { ids, hops } = findPath(people, edges, start.id, target.id);
  if (ids.length === 0) return { people: [], inferredHops: 0, strength: 0 };
  const pathPeople = ids
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is Person => Boolean(person));
  const blocker = pathPeople.some((person) => person.role === 'blocker');
  const strength = Math.max(
    5,
    Math.min(
      100,
      100 -
        hops.reduce(
          (sum, hop) =>
            sum + (hop.influence ? 8 : hop.inferred ? 25 : 10),
          0
        ) -
        (blocker ? 15 : 0)
    )
  );
  return {
    people: pathPeople,
    inferredHops: hops.filter((hop) => hop.inferred).length,
    strength,
  };
}

function objectionHypotheses(
  target: Person | undefined,
  initiatives: StrategicInitiative[]
): string[] {
  const hypotheses = new Set<string>();
  if (target?.role === 'technical_buyer') {
    hypotheses.add('Security, integration effort, and architecture fit');
  }
  if (
    target?.role === 'economic_buyer' ||
    /\b(chief|vp|president)\b/i.test(target?.title ?? '')
  ) {
    hypotheses.add('Time to value, measurable return, and budget priority');
  }
  if (initiatives.some((initiative) => initiative.category === 'operations')) {
    hypotheses.add('Change-management burden and disruption to current workflows');
  }
  if (initiatives.some((initiative) => initiative.category === 'technology')) {
    hypotheses.add('Overlap with the existing stack and implementation ownership');
  }
  if (hypotheses.size === 0) hypotheses.add('Priority, timing, and ownership of the problem');
  return [...hypotheses].slice(0, 3);
}

export function taskId(title: string, personId?: string): string {
  let hash = 2166136261;
  for (const char of `${title}|${personId ?? ''}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `t-${(hash >>> 0).toString(36)}`;
}

function makeTask(title: string, personId?: string): StrategyTask {
  return {
    id: taskId(title, personId),
    title,
    done: false,
    ...(personId ? { personId } : {}),
    source: 'generated',
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}

function relevantInitiatives(
  initiatives: StrategicInitiative[],
  entry: Person | undefined,
  target: Person | undefined
): StrategicInitiative[] {
  const names = new Set([entry?.name, target?.name].filter(Boolean).map((name) => name!.toLowerCase()));
  return initiatives
    .filter((initiative) =>
      (initiative.relevantPeople ?? []).some((name) => names.has(name.toLowerCase()))
    )
    .concat(initiatives)
    .filter((initiative, index, all) => all.findIndex((item) => item.name === initiative.name) === index)
    .slice(0, 3);
}

function health(
  people: Person[],
  _edges: MapEdge[],
  initiatives: StrategicInitiative[],
  keyPeople: Person[],
  primaryPath: RoutePath
): DealHealth {
  const byRole = (role: Person['role']) => people.filter((person) => person.role === role);
  const champions = byRole('champion');
  const economicBuyers = byRole('economic_buyer');
  const decisionMakers = byRole('decision_maker');
  const technicalBuyers = byRole('technical_buyer');
  const blockers = byRole('blocker');
  const met = people.filter((person) => person.metWith);
  const explicitPath = primaryPath.people.length > 1 && primaryPath.inferredHops === 0;
  const items: CoverageItem[] = [
    { key: 'champion', label: 'Champion', status: champions.length ? 'good' : 'missing', detail: champions.length ? `${champions.length} mapped` : 'No champion mapped', weight: 20, personIds: champions.map((p) => p.id) },
    { key: 'economic_buyer', label: 'Economic buyer', status: economicBuyers.length ? 'good' : 'missing', detail: economicBuyers.length ? `${economicBuyers.length} mapped` : 'No economic buyer mapped', weight: 20, personIds: economicBuyers.map((p) => p.id) },
    { key: 'decision_maker', label: 'Decision maker', status: decisionMakers.length ? 'good' : 'missing', detail: decisionMakers.length ? `${decisionMakers.length} mapped` : 'No decision maker mapped', weight: 15, personIds: decisionMakers.map((p) => p.id) },
    { key: 'technical_buyer', label: 'Technical buyer', status: technicalBuyers.length ? 'good' : 'missing', detail: technicalBuyers.length ? `${technicalBuyers.length} mapped` : 'No technical buyer mapped', weight: 10, personIds: technicalBuyers.map((p) => p.id) },
    { key: 'blocker_identified', label: 'Blocker identified', status: blockers.length || people.length >= 8 ? 'good' : people.length ? 'partial' : 'missing', detail: blockers.length ? `${blockers.length} mapped` : people.length >= 8 ? 'Coverage implies no blocker' : 'Pressure-test blockers', weight: 5, personIds: blockers.map((p) => p.id) },
    { key: 'met_with', label: 'Met with', status: met.length >= 2 ? 'good' : met.length === 1 ? 'partial' : 'missing', detail: `${met.length} stakeholder${met.length === 1 ? '' : 's'} marked met`, weight: 10, personIds: met.map((p) => p.id) },
    { key: 'path', label: 'Relationship path', status: explicitPath ? 'good' : primaryPath.people.length > 1 ? 'partial' : 'missing', detail: explicitPath ? 'Explicit path mapped' : primaryPath.people.length > 1 ? 'Path includes inferred hops' : 'No path mapped', weight: 10, personIds: primaryPath.people.map((p) => p.id) },
    { key: 'initiatives', label: 'Initiatives', status: initiatives.some((item) => item.evidence?.some((url) => /^https?:\/\//i.test(url))) ? 'good' : initiatives.length ? 'partial' : 'missing', detail: initiatives.length ? `${initiatives.length} relevant initiative${initiatives.length === 1 ? '' : 's'}` : 'No initiative evidence', weight: 5 },
    { key: 'freshness', label: 'Research freshness', status: keyPeople.some((person) => person.researchStatus === 'possibly_stale' || person.researchStatus === 'conflicting') ? 'missing' : 'good', detail: keyPeople.some((person) => person.researchStatus === 'possibly_stale' || person.researchStatus === 'conflicting') ? 'Key people need verification' : 'No stale key people', weight: 5, personIds: keyPeople.map((p) => p.id) },
  ];
  const score = items.reduce((sum, item) => sum + (item.status === 'good' ? item.weight : item.status === 'partial' ? item.weight / 2 : 0), 0);
  const rounded = Math.round(score);
  const grade = rounded >= 80 ? 'A' : rounded >= 60 ? 'B' : rounded >= 40 ? 'C' : 'D';
  return { score: rounded, grade, items, gaps: items.filter((item) => item.status !== 'good') };
}

export function computeStrategy(input: StrategyInput): StrategyOutput {
  const { people, edges, initiatives, sellerProfile, plan } = input;
  const byId = new Map(people.map((person) => [person.id, person]));
  const autoEntry = [...people].sort((a, b) => personScore(b, ROLE_PRIORITY, sellerProfile) - personScore(a, ROLE_PRIORITY, sellerProfile) || a.name.localeCompare(b.name))[0];
  const entry = plan.entryPersonId ? byId.get(plan.entryPersonId) : autoEntry;
  const autoTarget = [...people].filter((person) => person.id !== entry?.id).sort((a, b) => personScore(b, TARGET_PRIORITY, sellerProfile) - personScore(a, TARGET_PRIORITY, sellerProfile) || a.name.localeCompare(b.name))[0] ?? entry;
  const target = plan.targetPersonId ? byId.get(plan.targetPersonId) : autoTarget;
  const primaryPath = routePath(people, edges, entry, target);
  const routes: Route[] = (['economic_buyer', 'decision_maker', 'technical_buyer'] as Person['role'][])
    .map((role) => [...people].filter((person) => person.role === role && person.id !== entry?.id).sort((a, b) => personScore(b, TARGET_PRIORITY, sellerProfile) - personScore(a, TARGET_PRIORITY, sellerProfile))[0])
    .concat([...people].filter((person) => person.role === 'champion' && person.id !== entry?.id).sort((a, b) => personScore(b, ROLE_PRIORITY, sellerProfile) - personScore(a, ROLE_PRIORITY, sellerProfile))[0])
    .filter((person): person is Person => Boolean(person))
    .map((person) => ({ target: person, path: routePath(people, edges, entry, person), label: person.role === 'economic_buyer' ? 'Economic buyer' : person.role === 'decision_maker' ? 'Decision maker' : person.role === 'technical_buyer' ? 'Technical buyer' : 'Champion' }))
    .sort((a, b) => b.path.strength - a.path.strength)
    .slice(0, 4);
  const relevant = relevantInitiatives(initiatives, entry, target);
  const keyIds = new Set<string>();
  for (const person of [entry, target, ...primaryPath.people, ...people.filter((p) => p.role === 'blocker'), ...people.filter((p) => ['economic_buyer', 'decision_maker', 'champion'].includes(p.role))]) {
    if (person) keyIds.add(person.id);
  }
  const keyPeople = [...keyIds].map((id) => byId.get(id)).filter((person): person is Person => Boolean(person)).slice(0, 10);
  const dealHealth = health(people, edges, relevant, keyPeople, primaryPath);
  const risks: Risk[] = [];
  for (const blocker of people.filter((person) => person.role === 'blocker')) {
    const onPath = primaryPath.people.some((person) => person.id === blocker.id);
    const alternative = primaryPath.people.find((person) => person.id !== blocker.id && person.role === 'champion');
    risks.push({ id: `blocker-${blocker.id}`, title: `Blocker: ${blocker.name}`, detail: `${blocker.name} may slow access or adoption.`, severity: onPath ? 'high' : 'medium', personIds: [blocker.id], mitigation: onPath && alternative ? `Route around via ${alternative.name}` : 'Get a champion introduction before engaging' });
  }
  for (const person of people.filter((item) => plan.stakeholders[item.id]?.stance === 'skeptic')) {
    risks.push({ id: `skeptic-${person.id}`, title: `Skeptic: ${person.name}`, detail: 'A skeptical stance is recorded in the stakeholder plan.', severity: 'medium', personIds: [person.id], mitigation: `Validate ${person.name}'s success criteria with evidence` });
  }
  if (primaryPath.inferredHops > 0) risks.push({ id: 'inferred-path', title: 'Inferred relationship path', detail: `${primaryPath.inferredHops} hop${primaryPath.inferredHops === 1 ? '' : 's'} need confirmation.`, severity: 'medium', personIds: primaryPath.people.map((p) => p.id), mitigation: 'Confirm the reporting line before requesting an introduction' });
  if (people.filter((person) => person.metWith).length <= 1 || people.filter((person) => person.role === 'champion').length <= 1) risks.push({ id: 'single-threaded', title: 'Single-threaded coverage', detail: 'The account has limited meeting or champion coverage.', severity: 'medium', mitigation: 'Create a second relationship into the buying group' });
  if (people.filter((person) => person.role === 'economic_buyer').length === 0) risks.push({ id: 'no-economic-buyer', title: 'Economic buyer is not mapped', detail: 'Budget ownership is not established.', severity: 'high', mitigation: 'Identify the economic buyer' });
  if (keyPeople.some((person) => person.researchStatus === 'possibly_stale' || person.researchStatus === 'conflicting')) risks.push({ id: 'stale-key-people', title: 'Stale key-person evidence', detail: 'At least one key person may have changed roles.', severity: 'low', mitigation: 'Refresh research before relying on the route' });
  const suggested: StrategyTask[] = [];
  if (primaryPath.inferredHops > 0) suggested.push(makeTask(`Confirm reporting line ${primaryPath.people[0]?.name ?? 'entry'} → ${primaryPath.people.at(-1)?.name ?? 'target'}`));
  if (entry && target && entry.id !== target.id) suggested.push(makeTask(`Secure intro to ${target.name} via ${entry.name}`, target.id));
  for (const objection of objectionHypotheses(target, relevant).slice(0, 2)) suggested.push(makeTask(`Validate objection: ${objection}`));
  if (!people.some((person) => person.role === 'economic_buyer')) suggested.push(makeTask('Identify the economic buyer'));
  const champion = people.find((person) => person.role === 'champion' && !person.metWith);
  if (champion) suggested.push(makeTask(`Log a meeting with ${champion.name}`, champion.id));
  const existing = new Set(plan.tasks.map((task) => task.id));
  return { entry, target, primaryPath, routes, health: dealHealth, risks: risks.slice(0, 8), objections: objectionHypotheses(target, relevant), initiatives: relevant, suggestedTasks: suggested.filter((task) => !existing.has(task.id)).slice(0, 8), keyPeople };
}

export function renderBrief(input: {
  companyName: string | null;
  domain: string;
  strategy: StrategyOutput;
  plan: AccountStrategyPlan;
  format: 'markdown' | 'plain';
  scope: 'exec' | 'full';
  insights?: StrategyInsights | null;
}): string {
  const { companyName, domain, strategy, plan, format, scope, insights } = input;
  const account = companyName || domain;
  const bullet = format === 'markdown' ? '- ' : '• ';
  const heading = (text: string, level = 2) => format === 'markdown' ? `${'#'.repeat(level)} ${text}` : `\n${text.toUpperCase()}\n`;
  const lines = [`${account} account strategy`, `Health: ${strategy.health.grade} (${strategy.health.score}/100)`, heading('Executive summary', 2), insights?.executiveSummary ?? `Use ${strategy.entry?.name ?? 'the mapped entry point'} to reach ${strategy.target?.name ?? 'the buying group'}.`];
  lines.push(heading('Entry, target, and path', 2), `Entry: ${strategy.entry?.name ?? 'Not mapped'}`, `Target: ${strategy.target?.name ?? 'Not mapped'}`, `Path: ${strategy.primaryPath.people.map((person) => person.name).join(' → ') || 'No supported path'}`);
  lines.push(heading('Top gaps', 2), ...strategy.health.gaps.slice(0, 3).map((gap) => `${bullet}${gap.label}: ${gap.detail}`));
  if (scope === 'exec') {
    lines.push(heading('Top plays', 2), ...[...plan.tasks.filter((task) => !task.done), ...strategy.suggestedTasks].slice(0, 3).map((task) => `${bullet}${task.title}`));
    return lines.slice(0, 12).join('\n');
  }
  lines.push(heading('Stakeholder plan', 2), format === 'markdown' ? '| Name | Role | Stance | Next step |\n| --- | --- | --- | --- |' : 'Name | Role | Stance | Next step');
  for (const person of strategy.keyPeople) {
    const entry = plan.stakeholders[person.id] ?? { stance: 'unknown' as Stance, nextStep: '', note: '' };
    lines.push(format === 'markdown' ? `| ${person.name} | ${person.role} | ${entry.stance} | ${entry.nextStep || 'Map a next step'} |` : `${person.name} | ${person.role} | ${entry.stance} | ${entry.nextStep || 'Map a next step'}`);
  }
  lines.push(heading('Why now', 2), ...(strategy.initiatives.length ? strategy.initiatives.map((item) => `${bullet}${item.name}: ${item.summary}`) : [`${bullet}No initiative evidence attached yet.`]));
  lines.push(heading('Risks', 2), ...strategy.risks.slice(0, 5).map((risk) => `${bullet}${risk.title}: ${risk.mitigation}`));
  lines.push(heading('Open plays', 2), ...[...plan.tasks.filter((task) => !task.done), ...strategy.suggestedTasks].map((task) => `${bullet}${task.title}`));
  lines.push(heading('Objections to validate', 2), ...strategy.objections.map((objection) => `${bullet}${objection}`));
  return lines.join('\n');
}
