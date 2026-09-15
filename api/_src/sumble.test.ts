import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sumblePeopleToRaw,
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
        name: 'Ada Byron',
        job_title: 'Staff Engineer',
        job_function: 'Engineering',
        linkedin_url: 'https://linkedin.com/in/adabyron',
        sumble_url: 'https://sumble.com/people/ada-byron',
      },
      { name: 'No Title Person' },
      { job_title: 'Nameless' },
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
