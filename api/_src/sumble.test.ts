import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalDepartment,
  sumblePeopleToRaw,
  sumbleRelationships,
  sumbleTeamMemberships,
} from './sumble.js';
import { normalizePeople } from './research.js';

test('sumble team memberships map person names to team names', () => {
  const teams = [
    {
      name: 'Platform Engineering',
      related_people: [
        { name: 'Ada Byron', job_title: 'Staff Engineer' },
        { name: 'Grace Hopper', job_title: 'Director, Platform' },
      ],
    },
    {
      name: 'Revenue Operations',
      related_people: [{ name: 'Sam Chen', job_title: 'RevOps Manager' }],
    },
  ];
  const memberships = sumbleTeamMemberships(teams);
  assert.equal(memberships.get('ada byron'), 'Platform Engineering');
  assert.equal(memberships.get('grace hopper'), 'Platform Engineering');
  assert.equal(memberships.get('sam chen'), 'Revenue Operations');
});

test('sumble people become research rows with team + linkedin + profile sources', () => {
  const memberships = new Map([['ada byron', 'Platform Engineering']]);
  const raw = sumblePeopleToRaw(
    [
      {
        sumble_url: 'https://sumble.com/people/ada-byron',
        attributes: {
          name: 'Ada Byron',
          job_title: 'Staff Engineer',
          job_function: 'Engineering',
          linkedin_url: 'https://linkedin.com/in/adabyron',
        },
      },
      { attributes: { name: 'No Title Person' } },
      { attributes: { job_title: 'Nameless' } },
    ],
    memberships
  );
  assert.equal(raw.length, 1);
  assert.equal(raw[0].team, 'Platform Engineering');
  assert.equal(raw[0].department, 'Engineering');
  assert.equal(raw[0].linkedin, 'https://linkedin.com/in/adabyron');
  const sources = raw[0].sources as { url: string }[];
  assert.deepEqual(
    sources.map((s) => s.url),
    [
      'https://sumble.com/people/ada-byron',
      'https://linkedin.com/in/adabyron',
    ]
  );
});

test('sumble raw rows merge with LLM rows through normalizePeople', () => {
  const merged = normalizePeople(
    [
      {
        name: 'Ada Byron',
        title: 'CTO',
        confidence: 'high',
        sources: [{ url: 'https://acme.com/leadership', sourceType: 'official' }],
      },
      {
        name: 'Ada Byron',
        title: 'Staff Engineer',
        confidence: 'medium',
        team: 'Platform Engineering',
        teamEvidence: 'sourced',
        linkedin: 'https://linkedin.com/in/adabyron',
        sources: [
          { url: 'https://sumble.com/people/ada-byron', sourceType: 'profile' },
        ],
      },
    ],
    60
  );
  assert.equal(merged.length, 1);
  const [person] = merged;
  assert.equal(person.title, 'CTO');
  assert.equal(person.team, 'Platform Engineering');
  assert.equal(person.linkedin, 'https://linkedin.com/in/adabyron');
  assert.ok(person.conflictingTitles.includes('Staff Engineer'));
});

test('linkedin passthrough survives normalization', () => {
  const [person] = normalizePeople(
    [
      {
        name: 'Grace Hopper',
        title: 'VP Engineering',
        linkedin: 'https://linkedin.com/in/grace',
      },
    ],
    60
  );
  assert.equal(person.linkedin, 'https://linkedin.com/in/grace');
});

test('granular job functions collapse into department buckets and stay as team', () => {
  assert.equal(canonicalDepartment('Platform Engineer'), 'Engineering');
  assert.equal(canonicalDepartment('General Counsel'), 'Legal');
  assert.equal(canonicalDepartment('Recruiter'), 'People');
  assert.equal(canonicalDepartment('Brand Marketing'), 'Marketing');
  assert.equal(canonicalDepartment('Financial Controller'), 'Finance');
  assert.equal(canonicalDepartment('Executive'), 'Executive');
  assert.equal(canonicalDepartment('Executive Assistant'), 'Operations');
  assert.equal(canonicalDepartment('Uncategorized'), null);
  assert.equal(canonicalDepartment('Musician'), 'Other');
  assert.equal(canonicalDepartment(null), null);

  const raw = sumblePeopleToRaw(
    [
      {
        sumble_url: 'https://sumble.com/l/person/x',
        attributes: {
          name: 'Ada Byron',
          job_title: 'Staff Engineer',
          job_function: 'Platform Engineer',
          job_level: 'Senior IC',
        },
      },
    ],
    new Map()
  );
  assert.equal(raw[0].department, 'Engineering');
  assert.equal(raw[0].team, 'Platform Engineer');
  assert.equal(raw[0].jobLevel, 'Senior IC');
});

test('sumble relationships produce manager map and extra people', () => {
  const { managerByName, extraPeople } = sumbleRelationships([
    {
      sumble_url: 'https://sumble.com/l/person/ceo',
      attributes: { name: 'Ada Byron', job_title: 'CEO' },
      related_people: {
        managers: [],
        direct_reports: [
          {
            sumble_url: 'https://sumble.com/l/person/felix',
            attributes: { name: 'Felix Mercier', job_title: 'Director' },
          },
        ],
      },
    },
    {
      sumble_url: 'https://sumble.com/l/person/gc',
      attributes: { name: 'Aref Wardak', job_title: 'General Counsel' },
      related_people: {
        managers: [
          {
            sumble_url: 'https://sumble.com/l/person/ceo',
            attributes: { name: 'Ada Byron', job_title: 'CEO' },
          },
        ],
        direct_reports: [
          {
            sumble_url: 'https://sumble.com/l/person/matthew',
            attributes: { name: 'Matthew Pelnar', job_title: 'Legal Counsel' },
          },
        ],
      },
    },
  ]);
  assert.equal(managerByName.get('aref wardak'), 'Ada Byron');
  assert.equal(managerByName.get('felix mercier'), 'Ada Byron');
  assert.equal(managerByName.get('matthew pelnar'), 'Aref Wardak');
  // The CEO appears both as a main row and as Aref's manager entry — the
  // caller (sumbleOrgPeople) drops extraPeople already covered by the pull.
  const names = extraPeople.map((p) => p.name).sort();
  assert.deepEqual(names, ['Ada Byron', 'Felix Mercier', 'Matthew Pelnar']);
  const felix = extraPeople.find((p) => p.name === 'Felix Mercier')!;
  assert.equal(felix.reportsTo, 'Ada Byron');
  assert.equal(felix.department, 'Other');
  const matthew = extraPeople.find((p) => p.name === 'Matthew Pelnar')!;
  assert.equal(matthew.department, 'Legal');
});

test('manager names feed reportsTo on the main pull', () => {
  const raw = sumblePeopleToRaw(
    [
      {
        sumble_url: 'https://sumble.com/l/person/felix',
        attributes: {
          name: 'Felix Mercier',
          job_title: 'Director',
          job_function: 'Operations',
        },
      },
    ],
    new Map(),
    new Map([['felix mercier', 'Ada Byron']])
  );
  assert.equal(raw[0].reportsTo, 'Ada Byron');
});
