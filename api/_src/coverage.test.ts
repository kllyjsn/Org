import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCoverage, personMatchesPersona } from './coverage.js';
import {
  defaultPersonas,
  inferTargetFunctions,
  sanitizePersonas,
  type Persona,
} from './personas.js';
import { fixtureOrg } from './research.js';

function personas(): Persona[] {
  return defaultPersonas(null).map((p, index) => ({
    ...p,
    id: `p${index}`,
    sortOrder: index,
  }));
}

function fixturePeople() {
  return fixtureOrg('acme.com').people.map((p, index) => ({
    id: `person-${index}`,
    name: p.name,
    title: p.title,
    department: p.department,
  }));
}

test('demo fixture covers finance, technical, decision maker but not procurement/ops', () => {
  const coverage = computeCoverage(personas(), fixturePeople());
  const byName = new Map(coverage.personas.map((p) => [p.name, p]));

  const finance = byName.get('Economic buyer – Finance')!;
  assert.deepEqual(
    finance.matches.map((m) => m.name),
    ['Jordan Lee']
  );
  const technical = byName.get('Technical buyer – Engineering & Security')!;
  assert.deepEqual(
    technical.matches.map((m) => m.name).sort(),
    ['Morgan Diaz', 'Priya Patel', 'Taylor Kim']
  );
  const decision = byName.get('Decision maker – C-level')!;
  assert.equal(decision.matches.length, 4);
  // No profile → champion targets operations; the fixture has none.
  assert.equal(byName.get('Champion – Target function')!.covered, false);
  assert.equal(byName.get('Procurement & Legal')!.covered, false);
  assert.equal(byName.get('Influencer – Operations')!.covered, false);

  assert.equal(coverage.requiredCount, 4);
  assert.equal(coverage.coveredCount, 3);
  assert.equal(coverage.totalCovered, 3);
});

test('coverage updates when people are added or removed', () => {
  const people = fixturePeople();
  const before = computeCoverage(personas(), people);
  assert.equal(before.coveredCount, 3);

  const withProcurement = [
    ...people,
    {
      id: 'new',
      name: 'Dana Wu',
      title: 'Senior Manager, Procurement',
      department: 'Operations',
    },
  ];
  const after = computeCoverage(personas(), withProcurement);
  const procurement = after.personas.find((p) => p.name === 'Procurement & Legal')!;
  assert.equal(procurement.covered, true);
  assert.equal(procurement.matches[0]?.personId, 'new');
  assert.equal(after.totalCovered, 5); // ops influencer too
  assert.equal(after.coveredCount, 3); // procurement is optional

  const withoutFinance = people.filter((p) => p.name !== 'Jordan Lee');
  const dropped = computeCoverage(personas(), withoutFinance);
  assert.equal(dropped.coveredCount, 2);
});

test('persona matching respects seniority floor, functions and keywords', () => {
  const persona = {
    functions: ['finance' as const],
    minSeniority: 'director' as const,
    titleKeywords: ['procurement'],
  };
  const base = { id: 'x', name: 'X', department: null };
  assert.ok(personMatchesPersona(persona, { ...base, title: 'VP Finance' }));
  assert.ok(personMatchesPersona(persona, { ...base, title: 'Director of Procurement' }));
  assert.ok(!personMatchesPersona(persona, { ...base, title: 'Finance Manager' }));
  assert.ok(!personMatchesPersona(persona, { ...base, title: 'VP Marketing' }));
  assert.ok(
    personMatchesPersona(
      { ...persona, functions: [] },
      { ...base, title: 'VP Marketing' }
    )
  );
  assert.ok(
    personMatchesPersona(persona, {
      ...base,
      title: 'Finance Lead',
      jobLevel: 'Director',
    })
  );
});

test('sanitizePersonas drops invalid rows and normalizes fields', () => {
  const result = sanitizePersonas([
    {
      name: '  Champion ',
      functions: ['engineering', 'bogus', 'engineering'],
      minSeniority: 'director',
      titleKeywords: [' Platform ', 'platform', 3],
      buyingRole: 'champion',
    },
    { name: 'No seniority', functions: [] },
    { name: '', functions: [], minSeniority: 'vp' },
    'nope',
    { name: 'Optional', functions: [], min_seniority: 'c_level', required: false, buying_role: 'weird' },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    name: 'Champion',
    functions: ['engineering'],
    minSeniority: 'director',
    titleKeywords: ['platform'],
    buyingRole: 'champion',
    required: true,
  });
  assert.equal(result[1].required, false);
  assert.equal(result[1].buyingRole, null);
});

test('target functions are inferred from the seller profile', () => {
  const fns = inferTargetFunctions({
    companyName: 'Acme',
    domain: 'acme.com',
    summary: 'Cloud security platform for security teams',
    products: ['Threat detection'],
    targetCustomers: ['CISOs and security engineers'],
    useCases: ['Vulnerability management'],
    proofPoints: [],
    competitors: [],
    positioning: '',
    researchedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(fns[0], 'security');
  assert.deepEqual(inferTargetFunctions(null), ['operations']);
  assert.equal(defaultPersonas(null).length, 6);
});
