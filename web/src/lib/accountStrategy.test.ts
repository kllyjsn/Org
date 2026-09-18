import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStrategy,
  EMPTY_PLAN,
  patchStakeholder,
  renderBrief,
  taskId,
} from './accountStrategy';
import type { MapEdge, Person } from '../types';

const person = (id: string, role: Person['role'], name = id): Person => ({
  id,
  name,
  title: `${role} lead`,
  department: null,
  role,
  confidence: 'high',
  sources: ['https://example.com'],
  notes: '',
  email: null,
  linkedin: null,
  x: 0,
  y: 0,
});
const base = (edges: MapEdge[], people: Person[], plan = EMPTY_PLAN) =>
  computeStrategy({
    people,
    edges,
    initiatives: [],
    sellerProfile: null,
    plan,
  });

test('respects entry and target overrides', () => {
  const people = [
    person('champ', 'champion'),
    person('eb', 'economic_buyer'),
    person('dm', 'decision_maker'),
  ];
  const result = base(
    [{ id: 'e', from: 'champ', to: 'eb', kind: 'reports', label: null }],
    people,
    { ...EMPTY_PLAN, entryPersonId: 'dm', targetPersonId: 'champ' }
  );
  assert.equal(result.entry?.id, 'dm');
  assert.equal(result.target?.id, 'champ');
});

test('ranks explicit routes above inferred routes', () => {
  const people = [
    person('entry', 'champion'),
    person('explicit', 'economic_buyer'),
    person('inferred', 'decision_maker'),
  ];
  const result = base(
    [
      { id: 'a', from: 'entry', to: 'explicit', kind: 'reports', label: null },
      {
        id: 'b',
        from: 'entry',
        to: 'inferred',
        kind: 'reports',
        label: null,
        inferred: true,
      },
    ],
    people
  );
  assert.equal(result.routes[0]?.target.id, 'explicit');
  assert.ok(
    (result.routes[0]?.path.strength ?? 0) >
      (result.routes[1]?.path.strength ?? 0)
  );
});

test('scores a full committee higher than an empty map', () => {
  const empty = base([], []);
  const fullPeople = [
    person('c', 'champion'),
    person('e', 'economic_buyer'),
    person('d', 'decision_maker'),
    person('t', 'technical_buyer'),
    person('b', 'blocker'),
  ].map((p) => ({ ...p, metWith: true }));
  const full = base(
    [
      { id: '1', from: 'c', to: 'e', kind: 'reports', label: null },
      { id: '2', from: 'c', to: 'd', kind: 'reports', label: null },
    ],
    fullPeople
  );
  assert.ok(full.health.score > empty.health.score);
});

test('flags a blocker on the primary path as high risk', () => {
  const people = [
    person('c', 'champion'),
    person('b', 'blocker'),
    person('e', 'economic_buyer'),
  ];
  const result = base(
    [
      { id: '1', from: 'c', to: 'b', kind: 'reports', label: null },
      { id: '2', from: 'b', to: 'e', kind: 'reports', label: null },
    ],
    people
  );
  assert.equal(
    result.risks.find((risk) => risk.id === 'blocker-b')?.severity,
    'high'
  );
});

test('does not suggest tasks already in the plan', () => {
  const title = 'Identify the economic buyer';
  const people = [person('c', 'champion')];
  const result = base([], people, {
    ...EMPTY_PLAN,
    tasks: [
      {
        id: taskId(title),
        title,
        done: false,
        source: 'manual',
        createdAt: '2024-01-01',
      },
    ],
  });
  assert.equal(
    result.suggestedTasks.some((task) => task.id === taskId(title)),
    false
  );
});

test('renders markdown headings and stakeholder table rows', () => {
  const p = person('c', 'champion', 'Casey');
  const strategy = base([], [p]);
  const brief = renderBrief({
    companyName: 'Acme',
    domain: 'acme.test',
    strategy,
    plan: {
      ...EMPTY_PLAN,
      stakeholders: {
        c: { stance: 'advocate', nextStep: 'Ask for an intro', note: '' },
      },
    },
    format: 'markdown',
    scope: 'full',
  });
  assert.match(brief, /## Stakeholder plan/);
  assert.match(
    brief,
    /\| Casey \| champion \| advocate \| Ask for an intro \|/
  );
});

test('patchStakeholder: manual stance edit claims provenance, other patches do not', () => {
  const withStance = patchStakeholder(
    {
      ...EMPTY_PLAN,
      stakeholders: {
        p1: {
          stance: 'advocate',
          nextStep: '',
          note: '',
          stanceSource: 'transcript',
        },
      },
    },
    'p1',
    { stance: 'skeptic' }
  );
  assert.equal(withStance.stakeholders.p1.stance, 'skeptic');
  assert.equal(withStance.stakeholders.p1.stanceSource, 'manual');

  const withNote = patchStakeholder(
    {
      ...EMPTY_PLAN,
      stakeholders: {
        p1: {
          stance: 'advocate',
          nextStep: '',
          note: '',
          stanceSource: 'transcript',
        },
      },
    },
    'p1',
    { note: 'asked about pricing' }
  );
  assert.equal(withNote.stakeholders.p1.stance, 'advocate');
  assert.equal(withNote.stakeholders.p1.stanceSource, 'transcript');
});
