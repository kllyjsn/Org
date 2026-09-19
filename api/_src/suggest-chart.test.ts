import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsFromCsv } from './csv.js';
import { personKeyFor } from './roster.js';
import type { Persona } from './personas.js';
import { seniorityRank } from './taxonomy.js';
import {
  applyLlmPatch,
  buildChartSuggestion,
  type ChartSuggestion,
} from './suggest-chart.js';
import { makeRosterFixture, rosterFixtureCsv } from './suggest-chart.fixture.js';

const emptyMap = { mapPeople: [], mapEdges: [] };

test('seniority ladder and minimum seniority', () => {
  const roster = makeRosterFixture();
  const suggestion = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: {},
  });
  const byId = new Map(suggestion.people.map((person) => [person.rosterId, person]));
  for (const person of suggestion.people) {
    if (person.reportsToRosterId) {
      assert.ok(
        seniorityRank(byId.get(person.reportsToRosterId)!.seniority) <=
          seniorityRank(person.seniority)
      );
    }
  }
  const directors = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { minSeniority: 'director' },
  });
  assert.ok(directors.people.every((person) =>
    seniorityRank(person.seniority) <= seniorityRank('director')
  ));
});

test('cycle prevention falls through', () => {
  const roster = makeRosterFixture(3).map((item, index) => ({
    ...item,
    name: ['A', 'B', 'C'][index],
    person_key: ['a', 'b', 'c'][index],
    title: 'Manager, Sales',
    function: 'sales',
    seniority: 'manager',
    manager_key: ['b', 'c', 'a'][index],
  }));
  const suggestion = buildChartSuggestion({ roster, ...emptyMap, options: {} });
  const parent = new Map(suggestion.people.map((person) => [person.rosterId, person.reportsToRosterId]));
  for (const id of parent.keys()) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parent.get(cursor) ?? null;
    }
    assert.notEqual(cursor, id);
  }
  assert.ok(suggestion.people.some((person) => !person.reportsToRosterId));
});

test('groups nest and regional grouping requires guidance', () => {
  const roster = makeRosterFixture();
  const plain = buildChartSuggestion({ roster, ...emptyMap, options: {} });
  assert.ok(plain.groups.some((group) => group.id === 'grp:leadership'));
  assert.equal(plain.groups.some((group) => group.id.includes(':EMEA')), false);
  const regional = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { guidance: 'group by region' },
  });
  assert.ok(regional.groups.some((group) => group.id === 'grp:fn:sales:EMEA'));
  assert.equal(
    regional.groups.find((group) => group.id === 'grp:fn:sales:EMEA')!.parentGroupId,
    'grp:fn:sales'
  );
});

test('personasOnly uses canonical persona matching', () => {
  const persona: Persona = {
    id: 'sales-vp',
    name: 'Sales VP',
    functions: ['sales'],
    minSeniority: 'vp',
    titleKeywords: [],
    buyingRole: null,
    required: true,
    sortOrder: 0,
  };
  const suggestion = buildChartSuggestion({
    roster: makeRosterFixture(),
    ...emptyMap,
    personas: [persona],
    options: { personasOnly: true },
  });
  assert.ok(suggestion.people.length > 0);
  assert.ok(suggestion.people.every((person) =>
    person.function === 'sales' &&
    seniorityRank(person.seniority) <= seniorityRank('vp')
  ));
});

test('region matching uses word boundaries', () => {
  const fixture = makeRosterFixture(1);
  const rows = [
    {
      ...fixture[0],
      id: 'austin',
      person_key: 'austin',
      name: 'Austin Sales',
      title: 'VP Sales',
      function: 'sales',
      seniority: 'vp',
      location: 'Austin, TX',
      manager_key: null,
    },
    {
      ...fixture[0],
      id: 'new-york',
      person_key: 'new-york',
      name: 'New York Sales',
      title: 'Manager, Sales',
      function: 'sales',
      seniority: 'manager',
      location: 'New York, NY',
      manager_key: null,
    },
    {
      ...fixture[0],
      id: 'business-development',
      person_key: 'business-development',
      name: 'Business Development',
      title: 'Business Development',
      function: 'sales',
      seniority: 'manager',
      location: null,
      manager_key: null,
    },
  ];
  const suggestion = buildChartSuggestion({
    roster: rows,
    ...emptyMap,
    options: { guidance: 'group by region' },
  });
  assert.equal(
    suggestion.people.find((person) => person.rosterId === 'austin')?.groupId,
    'grp:fn:sales:AMER'
  );
  assert.equal(
    suggestion.people.find((person) => person.rosterId === 'business-development')?.groupId,
    'grp:fn:sales'
  );
});

test('limit, exclusions, and priority are respected', () => {
  const roster = makeRosterFixture();
  const limited = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { limit: 50 },
  });
  assert.equal(limited.people.length, 50);
  assert.equal(limited.stats.candidates, roster.length);
  assert.equal(buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { limit: 5000 },
  }).people.length, 300);
  const excluded = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { excludeRosterIds: ['roster-1'], guidance: 'GTM revenue' },
  });
  assert.equal(excluded.people.some((person) => person.rosterId === 'roster-1'), false);
  assert.equal(excluded.people[0].function, 'sales');
});

test('evidence kinds and CSV manager column', () => {
  const rows = makeRosterFixture(40);
  const suggestion = buildChartSuggestion({ roster: rows, ...emptyMap, options: {} });
  assert.equal(
    suggestion.people.find((person) => person.rosterId === 'roster-1')!.evidence.kind,
    'sumble_relationship'
  );
  const csvRows = rowsFromCsv(rosterFixtureCsv(rows));
  assert.equal(csvRows[0].manager, null);
  assert.equal(csvRows[1].manager, rows[0].name);
});

test('CSV fixture manager names resolve reporting evidence', () => {
  const fixture = makeRosterFixture(300);
  const imported = rowsFromCsv(rosterFixtureCsv(fixture));
  const roster = imported.map((item, index) => {
    const source = fixture[index];
    return {
      ...source,
      id: `csv-${index}`,
      name: item.name,
      title: item.title,
      linkedin: item.linkedin,
      email: item.email,
      location: item.location,
      person_key: personKeyFor(item.name, item.linkedin),
      manager_key: item.manager
        ? personKeyFor(item.manager, null)
        : null,
      source: 'csv' as const,
      source_url: null,
      confidence: 'medium' as const,
    };
  });
  const suggestion = buildChartSuggestion({
    roster,
    ...emptyMap,
    options: { limit: 1000, minSeniority: 'ic' },
  });
  assert.ok(suggestion.stats.withEvidenceEdges > 100);
});

test('applyLlmPatch validates ids and names', () => {
  const suggestion = buildChartSuggestion({
    roster: makeRosterFixture(20),
    ...emptyMap,
    options: {},
  });
  const patched = applyLlmPatch(suggestion, {
    renames: [
      { groupId: 'grp:leadership', name: 'Execs' },
      { groupId: 'unknown', name: 'Nope' },
      { groupId: 'grp:leadership', name: 'x'.repeat(61) },
    ],
    moves: [
      { rosterId: suggestion.people[0].rosterId, groupId: 'grp:leadership' },
      { rosterId: 'unknown', groupId: 'grp:leadership' },
    ],
  });
  assert.equal(patched.groups.find((group) => group.id === 'grp:leadership')!.name, 'Execs');
  assert.equal(patched.people[0].groupId, 'grp:leadership');
});

test('large suggestions are bounded', () => {
  const start = performance.now();
  const suggestion: ChartSuggestion = buildChartSuggestion({
    roster: makeRosterFixture(1000),
    ...emptyMap,
    options: { limit: 1000 },
  });
  assert.equal(suggestion.people.length, 1000);
  assert.ok(performance.now() - start < 500);
});
