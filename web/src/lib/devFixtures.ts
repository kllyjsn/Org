import type { MapEdge, MapState, Person } from '../types';
import { applyLanes, LANE_COL_GAP } from './layout';

export interface FixtureOptions {
  seed?: number;
  columns?: number;
  colGap?: number;
}

const DEPARTMENTS = [
  { name: 'Engineering', weight: 25, teams: ['Platform', 'Mobile', 'Infra', 'Developer Experience'] },
  { name: 'Product', weight: 12, teams: ['Core Product', 'Growth', 'Design'] },
  { name: 'Sales', weight: 18, teams: ['Enterprise', 'Mid-Market', 'Commercial'] },
  { name: 'Marketing', weight: 8, teams: ['Demand', 'Brand', 'Content'] },
  { name: 'Customer Success', weight: 10, teams: ['Strategic Accounts', 'Onboarding', 'Education'] },
  { name: 'Finance', weight: 5, teams: ['FP&A', 'Accounting'] },
  { name: 'Legal', weight: 3, teams: ['Corporate', 'Commercial'] },
  { name: 'People', weight: 4, teams: ['Talent', 'People Operations'] },
  { name: 'IT', weight: 4, teams: ['Corporate IT', 'Support'] },
  { name: 'Security', weight: 3, teams: ['AppSec', 'Trust'] },
  { name: 'Operations', weight: 5, teams: ['Business Operations', 'Revenue Operations', 'Workplace'] },
  { name: 'Data', weight: 3, teams: ['Analytics', 'Data Platform'] },
] as const;

const FIRST_NAMES = [
  'Avery', 'Blake', 'Casey', 'Drew', 'Elliot', 'Finley', 'Gray', 'Harper',
  'Indigo', 'Jordan', 'Kai', 'Lane', 'Morgan', 'Nico', 'Oakley', 'Parker',
  'Quinn', 'Reese', 'Riley', 'Rowan', 'Sage', 'Sawyer', 'Shawn', 'Skyler',
  'Taylor', 'Terry', 'Val', 'Wren', 'Alex', 'Bailey', 'Cameron', 'Dakota',
  'Emerson', 'Frankie', 'Jamie', 'Jesse', 'Kendall', 'Logan', 'Marley', 'Micah',
] as const;

const LAST_NAMES = [
  'Adams', 'Bennett', 'Brooks', 'Carter', 'Chen', 'Clark', 'Cooper', 'Davis',
  'Edwards', 'Ellis', 'Foster', 'Garcia', 'Grant', 'Green', 'Harris', 'Hayes',
  'Henderson', 'Hill', 'Howard', 'Jackson', 'James', 'Johnson', 'Khan', 'King',
  'Lee', 'Lewis', 'Martin', 'Miller', 'Mitchell', 'Moore', 'Morgan', 'Morris',
  'Nelson', 'Parker', 'Patel', 'Perry', 'Reed', 'Rivera', 'Roberts', 'Ross',
] as const;

const PREFIXES = ['Head of', 'Senior', 'Staff', 'Principal', 'Lead', 'Associate'];
const ROLES = ['Strategy', 'Operations', 'Programs', 'Enablement', 'Planning', 'Growth'];
const BUYING_ROLES: Person['role'][] = [
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_buyer',
  'influencer',
  'blocker',
];
const INFLUENCE_LABELS = ['Trusted advisor', 'Former colleague', 'Budget partner'];

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function departmentFor(random: () => number): (typeof DEPARTMENTS)[number] {
  const total = DEPARTMENTS.reduce((sum, department) => sum + department.weight, 0);
  let target = random() * total;
  for (const department of DEPARTMENTS) {
    target -= department.weight;
    if (target < 0) return department;
  }
  return DEPARTMENTS[DEPARTMENTS.length - 1];
}

export function generateFixturePeople(
  count: number,
  options: FixtureOptions = {}
): { people: Person[]; edges: MapEdge[] } {
  const random = mulberry32(options.seed ?? 600 + count);
  const safeCount = Math.max(0, Math.floor(count));
  const assignments = Array.from({ length: safeCount }, () => departmentFor(random));
  const departmentCounts = new Map<string, number>();
  for (const department of assignments) {
    departmentCounts.set(department.name, (departmentCounts.get(department.name) ?? 0) + 1);
  }
  const cLevelDepartments = new Set(
    DEPARTMENTS.filter((department) => (departmentCounts.get(department.name) ?? 0) >= 60)
      .map((department) => department.name)
  );
  const cLevelAssigned = new Set<string>();
  const people: Person[] = assignments.map((department, index) => {
    const isCeo = index === 0 && safeCount > 0;
    const isCLevel =
      !isCeo &&
      cLevelDepartments.has(department.name) &&
      !cLevelAssigned.has(department.name);
    if (isCLevel) cLevelAssigned.add(department.name);
    const jobLevel: Person['jobLevel'] = isCeo
      ? 'CXO'
      : isCLevel
        ? 'VP'
        : index < Math.ceil(safeCount * 0.03)
          ? 'VP'
          : index < Math.ceil(safeCount * 0.11)
            ? 'Director'
            : index < Math.ceil(safeCount * 0.29)
              ? 'Manager'
              : index % 3 === 0
                ? 'Senior'
                : 'IC';
    const team = pick(random, department.teams);
    const title = isCeo
      ? 'Chief Executive Officer'
      : isCLevel
        ? `Chief ${department.name === 'Customer Success' ? 'Customer' : department.name} Officer`
        : `${pick(random, PREFIXES)} ${team} ${pick(random, ROLES)}`;
    const confidenceValue = random();
    const role = random() < 0.05 ? pick(random, BUYING_ROLES) : 'none';
    return {
      id: `fx-${index}`,
      name: `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`,
      title,
      department: department.name,
      team,
      productLine: null,
      teamEvidence: 'sourced',
      jobLevel,
      role,
      confidence: confidenceValue < 0.6 ? 'high' : confidenceValue < 0.9 ? 'medium' : 'low',
      sources: [`https://fixture.example/people/fx-${index}`],
      notes: '',
      email: null,
      linkedin: null,
      metWith: false,
      x: 0,
      y: 0,
    };
  });

  const rank = (person: Person): number => {
    switch (person.jobLevel) {
      case 'CXO': return 0;
      case 'VP': return 5;
      case 'Director': return 6;
      case 'Manager': return 7;
      case 'Senior': return 8;
      default: return 9;
    }
  };
  const rankById = new Map(people.map((person) => [person.id, rank(person)]));
  const edges: MapEdge[] = [];
  const nonCeo = people.slice(1);
  const reportCount = Math.min(nonCeo.length, Math.round(nonCeo.length * 0.85));
  const reportCandidates = [...nonCeo].sort(() => random() - 0.5).slice(0, reportCount);
  for (const person of reportCandidates) {
    const seniorInDepartment = people.filter(
      (candidate) =>
        candidate.id !== person.id &&
        candidate.department === person.department &&
        rankById.get(candidate.id)! < rankById.get(person.id)!
    );
    const senior = seniorInDepartment.length > 0
      ? pick(random, seniorInDepartment)
      : people[0];
    edges.push({
      id: `fxe-${edges.length}`,
      from: senior!.id,
      to: person.id,
      kind: 'reports',
      label: null,
    });
  }
  for (const person of people) {
    if (people.length < 2 || random() >= 0.04) continue;
    const other = pick(random, people.filter((candidate) => candidate.id !== person.id));
    edges.push({
      id: `fxe-${edges.length}`,
      from: person.id,
      to: other.id,
      kind: 'influence',
      label: pick(random, INFLUENCE_LABELS),
    });
  }
  return { people, edges };
}

export function generateFixtureState(
  count: number,
  options: FixtureOptions = {}
): MapState {
  const { people, edges } = generateFixturePeople(count, options);
  const laidOut = applyLanes(
    people,
    options.columns ?? 4,
    'department',
    options.colGap ?? LANE_COL_GAP
  );
  const now = new Date().toISOString();
  return {
    people: laidOut,
    edges,
    meta: {
      domain: 'fixture.example',
      companyName: 'Fixture Corp',
      researchedAt: now,
      tier: 'T0',
      provider: 'fixture',
      refreshCadence: 'manual',
      nextRefreshAt: null,
      initiatives: [],
    },
  };
}
