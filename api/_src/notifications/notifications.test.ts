import test from 'node:test';
import assert from 'node:assert/strict';
import { committeeCoverage, coverageBand } from './coverage.js';
import {
  composeChangeAlert,
  composePreMeetingBrief,
  composeWeeklyCoverage,
} from './compose.js';
import { toEmail, toSlackPayload } from './format.js';
import {
  briefDedupeKey,
  changeAlertDedupeKey,
  isoWeek,
  weeklyDedupeKey,
} from './schedule.js';
import type { MapChangeAlert } from '../changes.js';
import type { MapState, Person } from '../types.js';

function person(patch: Partial<Person>): Person {
  return {
    id: 'p1',
    name: 'Jane Doe',
    title: 'VP Eng',
    department: null,
    role: 'none',
    confidence: 'medium',
    sources: [],
    notes: '',
    email: null,
    linkedin: null,
    x: 0,
    y: 0,
    ...patch,
  };
}

function state(people: Person[]): MapState {
  return {
    people,
    edges: [],
    meta: {
      domain: 'acme.com',
      companyName: 'Acme',
      researchedAt: null,
      tier: 'T2',
      provider: null,
    },
  };
}

const NOW = Date.parse('2026-03-09T12:00:00.000Z'); // Monday

test('committeeCoverage: covered/missing roles, threads, untouched, exact score', () => {
  const coverage = committeeCoverage(
    state([
      person({ id: 'a', role: 'champion', metWith: true, lastTouchAt: '2026-03-01T00:00:00Z' }),
      person({ id: 'b', role: 'champion', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'c', role: 'economic_buyer', metWith: true, lastTouchAt: '2025-12-01T00:00:00Z' }),
      person({ id: 'd', role: 'influencer' }),
    ]),
    NOW
  );
  assert.equal(coverage.coveredCount, 2);
  assert.deepEqual(coverage.missingRoles, ['decision_maker']);
  assert.equal(coverage.threadCount, 3);
  assert.equal(coverage.singleThreaded, false);
  // c is a key role untouched >30d.
  assert.deepEqual(
    coverage.untouchedKeyPeople.map((p) => p.id),
    ['c']
  );
  // score = 50*2/3 + 30*3/3 + 20*0 = 33.33 + 30 = 63.33 → 63
  assert.equal(coverage.score, 63);
  assert.equal(coverageBand(coverage.score), 'moderate');
});

test('committeeCoverage: single-threaded and full score', () => {
  const coverage = committeeCoverage(
    state([
      person({ id: 'a', role: 'champion', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'b', role: 'economic_buyer', lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'c', role: 'decision_maker', lastTouchAt: '2026-03-08T00:00:00Z' }),
    ]),
    NOW
  );
  assert.equal(coverage.coveredCount, 3);
  assert.equal(coverage.threadCount, 1);
  assert.equal(coverage.singleThreaded, true);
  // score = 50 + 30*1/3 + 20 = 80
  assert.equal(coverage.score, 80);
  assert.equal(coverageBand(coverage.score), 'strong');

  const empty = committeeCoverage(state([]), NOW);
  assert.equal(empty.score, 20);
  assert.equal(coverageBand(empty.score), 'weak');
});

test('composeChangeAlert: lines cap with +N more and re-entry play prefers nextStep', () => {
  const alerts: MapChangeAlert[] = Array.from({ length: 10 }, (_, i) => ({
    id: `a${i}`,
    type: 'title_changed',
    title: `Change ${i}`,
    detail: '',
  }));
  const keyAlert: MapChangeAlert = {
    id: 'k1',
    type: 'role_changed',
    title: 'Sam moved roles',
    detail: '',
    personId: 'key1',
  };
  const withStrategy = composeChangeAlert(
    { id: 'm1', name: 'Acme' },
    [keyAlert],
    {
      stakeholders: { key1: { stance: 'neutral', nextStep: 'Re-brief Sam', note: '' } },
      tasks: [],
      updatedAt: '',
    },
    'https://app.test',
    new Map([['key1', person({ id: 'key1', name: 'Sam', role: 'champion' })]])
  );
  assert.equal(withStrategy.title, 'Acme: 1 change');
  assert.equal(withStrategy.lines[1], 'Re-entry play: Re-brief Sam');
  assert.equal(withStrategy.ctaUrl, 'https://app.test/app/maps/m1');

  const fallback = composeChangeAlert(
    { id: 'm1', name: 'Acme' },
    [keyAlert],
    null,
    'https://app.test',
    new Map([['key1', person({ id: 'key1', name: 'Sam', role: 'economic_buyer' })]])
  );
  assert.equal(
    fallback.lines[1],
    "Re-entry play: Confirm Sam's new remit, then re-map the Economic buyer seat."
  );

  const capped = composeChangeAlert(
    { id: 'm1', name: 'Acme' },
    alerts,
    null,
    'https://app.test'
  );
  assert.equal(capped.title, 'Acme: 10 changes');
  assert.equal(capped.lines.length, 9);
  assert.equal(capped.lines[8], '+2 more');
});

test('composePreMeetingBrief: attendee lines, committee line, attendee tasks first', () => {
  const attendee = person({ id: 'p9', name: 'Jo', role: 'decision_maker', metWith: true, lastTouchAt: '2026-03-01T00:00:00Z' });
  const coverage = committeeCoverage(state([attendee]), NOW);
  const notice = composePreMeetingBrief(
    { id: 'm1', name: 'Acme' },
    {
      subject: 'Kickoff',
      startsAt: '2026-03-09T12:30:00.000Z',
      attendees: [attendee],
    },
    {
      stakeholders: {
        p9: { stance: 'advocate', nextStep: '', note: '' },
      },
      tasks: [
        { id: 't1', title: 'Other task', done: false, source: 'generated', createdAt: '' },
        { id: 't2', title: 'Prep Jo', done: false, personId: 'p9', source: 'generated', createdAt: '' },
        { id: 't3', title: 'Done task', done: true, personId: 'p9', source: 'generated', createdAt: '' },
      ],
      updatedAt: '',
    },
    coverage,
    'https://app.test',
    NOW
  );
  assert.equal(notice.title, 'Brief: Kickoff in 30 min');
  assert.equal(
    notice.lines[0],
    'Jo — VP Eng · Decision maker · stance advocate · last touch 8d ago'
  );
  assert.equal(notice.lines[1], 'Committee: 1/3 key roles covered · single-threaded');
  assert.equal(notice.lines[2], '• Prep Jo'); // attendee task preferred
  assert.equal(notice.lines[3], '• Other task');
  assert.equal(notice.lines.length, 4); // done task excluded
});

test('composeWeeklyCoverage: sorted by score, single-threaded flag, weak count', () => {
  const weak = committeeCoverage(state([]), NOW);
  const strong = committeeCoverage(
    state([
      person({ id: 'a', role: 'champion', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'b', role: 'economic_buyer', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
      person({ id: 'c', role: 'decision_maker', metWith: true, lastTouchAt: '2026-03-08T00:00:00Z' }),
    ]),
    NOW
  );
  const notice = composeWeeklyCoverage(
    'Acme Corp',
    [
      { map: { id: 'strong', name: 'StrongMap' }, coverage: strong },
      { map: { id: 'weak', name: 'WeakMap' }, coverage: weak },
    ],
    'https://app.test'
  );
  assert.equal(notice.title, 'Weekly committee coverage — Acme Corp');
  assert.match(notice.lines[0], /^• WeakMap: 20 weak · 0\/3 roles · 0 threads · SINGLE-THREADED$/);
  assert.match(notice.lines[1], /^• StrongMap: 100 strong · 3\/3 roles · 3 threads$/);
  assert.equal(notice.lines[2], 'Live opportunities with weak coverage: 1');
});

test('format: slack payload shape and email subject', () => {
  const notice = {
    title: 'Acme: 2 changes',
    lines: ['• one', '• two'],
    ctaLabel: 'Open map',
    ctaUrl: 'https://app.test/app/maps/m1',
  };
  const slack = toSlackPayload(notice);
  assert.equal(slack.blocks[0].type, 'header');
  assert.equal(slack.blocks[2].type, 'actions');
  assert.ok(slack.text.includes('• one'));

  const email = toEmail(notice);
  assert.equal(email.subject, 'TopDown — Acme: 2 changes');
  assert.ok(email.html.includes('Open map'));
  assert.ok(email.text.includes('https://app.test/app/maps/m1'));
});

test('dedupe keys are stable and inputs-insensitive to order', () => {
  const alerts = [{ id: 'b' }, { id: 'a' }] as MapChangeAlert[];
  const alertsReordered = [{ id: 'a' }, { id: 'b' }] as MapChangeAlert[];
  assert.equal(
    changeAlertDedupeKey('m1', alerts),
    changeAlertDedupeKey('m1', alertsReordered)
  );
  assert.match(changeAlertDedupeKey('m1', alerts), /^change:m1:[0-9a-f]{12}$/);
  assert.equal(briefDedupeKey('evt-1'), 'brief:evt-1');
  assert.equal(
    weeklyDedupeKey('w1', '2026-W11'),
    'weekly:w1:2026-W11'
  );
  assert.equal(isoWeek(new Date('2026-03-09T00:00:00Z')), '2026-W11');
});

test('composePreMeetingBrief: 90+ minutes formats as hours', () => {
  const attendee = person({ id: 'p9', name: 'Jo', role: 'decision_maker', metWith: true });
  const coverage = committeeCoverage(state([attendee]), NOW);
  const notice = composePreMeetingBrief(
    { id: 'm1', name: 'Acme' },
    {
      subject: 'Kickoff',
      startsAt: '2026-03-09T15:00:00.000Z', // NOW + 3h
      attendees: [attendee],
    },
    null,
    coverage,
    'https://app.test',
    NOW
  );
  assert.equal(notice.title, 'Brief: Kickoff in 3 h');
});
