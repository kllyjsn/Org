import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from './parse.js';
import { sanitizeAnalysis } from './analyze.js';
import {
  applyAnalysisToPeople,
  applyAnalysisToStrategy,
} from './apply.js';
import type {
  AccountStrategyPlan,
  MapState,
  Person,
  TranscriptAnalysis,
} from '../types.js';

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

test('normalizeTranscript: vtt with voice tags becomes Speaker: text', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Sam>We already use a competitor.</v>

00:00:05.000 --> 00:00:08.000
<v Jane>But the rollout cost concerns me.</v>
`;
  const out = normalizeTranscript(vtt, 'call.vtt');
  assert.equal(
    out,
    'Sam: We already use a competitor.\nJane: But the rollout cost concerns me.'
  );
});

test('normalizeTranscript: srt cue blocks flatten to text', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
We need this live by Q3.

2
00:00:04,000 --> 00:00:06,000
Budget is approved.
`;
  const out = normalizeTranscript(srt, 'call.srt');
  assert.equal(out, 'We need this live by Q3.\nBudget is approved.');
});

test('normalizeTranscript: plain text passes through trimmed', () => {
  assert.equal(
    normalizeTranscript('  Hello there.\nSecond line.  '),
    'Hello there.\nSecond line.'
  );
  // vtt content detected without a filename
  assert.equal(
    normalizeTranscript('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>Hi.</v>'),
    'A: Hi.'
  );
});

const TRANSCRIPT = 'Jane: This fits our roadmap perfectly.\nSam: I am worried about the price.';
const PEOPLE = [person({ id: 'jd', name: 'Jane Doe' })];

test('sanitizeAnalysis: enums coerced, non-verbatim quote dropped, stance demoted', () => {
  const analysis = sanitizeAnalysis(
    {
      speakers: [
        {
          speakerLabel: 'Jane',
          matchedName: 'Jane Doe',
          stance: 'advocate',
          confidence: 'extreme',
          quotes: [
            { text: 'This fits our roadmap perfectly.', signal: 'support' },
            { text: 'words never said on the call', signal: 'nonsense' },
          ],
          summary: 'Loves it',
        },
        {
          speakerLabel: 'Sam',
          matchedName: null,
          stance: 'skeptic',
          confidence: 'high',
          quotes: [{ text: 'totally made up', signal: 'objection' }],
          summary: '',
        },
      ],
      nextSteps: ['Send contract', 'x'.repeat(10)],
      risks: 'not-an-array',
    },
    PEOPLE,
    TRANSCRIPT,
    { provider: 'gemini', analyzedAt: '2026-03-10T00:00:00Z' }
  );
  const jane = analysis.speakers[0];
  assert.equal(jane.matchedPersonId, 'jd');
  assert.equal(jane.stance, 'advocate');
  assert.equal(jane.confidence, 'low'); // bad enum → low
  assert.equal(jane.quotes.length, 1); // invented quote dropped
  assert.equal(jane.quotes[0].signal, 'support');
  const sam = analysis.speakers[1];
  assert.equal(sam.matchedPersonId, null);
  assert.equal(sam.stance, 'unknown'); // no surviving quotes → demoted
  assert.equal(analysis.nextSteps.length, 2);
  assert.deepEqual(analysis.risks, []);
  assert.equal(analysis.provider, 'gemini');
});

function analysis(patch: Partial<TranscriptAnalysis> = {}): TranscriptAnalysis {
  return {
    speakers: [
      {
        speakerLabel: 'Jane',
        matchedName: 'Jane Doe',
        matchedPersonId: 'jd',
        inferredTitle: null,
        stance: 'advocate',
        confidence: 'medium',
        quotes: [{ text: 'This fits our roadmap perfectly.', signal: 'support' }],
        summary: 'Loves it',
      },
    ],
    nextSteps: ['Jane to share security docs'],
    risks: [],
    provider: 'gemini',
    analyzedAt: '2026-03-10T00:00:00Z',
    ...patch,
  };
}

test('applyAnalysisToStrategy: manual stance wins, evidence dedupes, tasks not duplicated', () => {
  const plan: AccountStrategyPlan = {
    stakeholders: {
      jd: {
        stance: 'skeptic',
        nextStep: 'Rep override',
        note: '',
        stanceSource: 'manual',
        evidence: [
          {
            quote: 'This fits our roadmap perfectly.',
            signal: 'support',
            transcriptId: 't0',
            title: null,
            occurredAt: null,
          },
        ],
      },
    },
    tasks: [
      {
        id: 't1',
        title: 'jane to share SECURITY docs',
        done: false,
        source: 'manual',
        createdAt: '',
      },
    ],
    updatedAt: '',
  };
  const { plan: next, touchedPersonIds } = applyAnalysisToStrategy(
    plan,
    analysis(),
    { id: 't1', title: 'Call 1', occurredAt: '2026-03-09T00:00:00Z' },
    {}
  );
  const entry = next.stakeholders.jd;
  assert.equal(entry.stance, 'skeptic'); // manual not overridden
  assert.equal(entry.stanceSource, 'manual');
  assert.equal(entry.nextStep, 'Rep override'); // not filled, already set
  assert.equal(entry.evidence?.length, 1); // dedupe by quote text
  assert.equal(next.tasks.length, 1); // same title case-insensitive → no dup
  assert.deepEqual(touchedPersonIds, ['jd']);
});

test('applyAnalysisToStrategy: transcript stance refreshable, null override skips', () => {
  const plan: AccountStrategyPlan = {
    stakeholders: {
      jd: { stance: 'neutral', nextStep: '', note: '', stanceSource: 'transcript' },
    },
    tasks: [],
    updatedAt: '',
  };
  const { plan: next } = applyAnalysisToStrategy(
    plan,
    analysis(),
    { id: 't2', title: null, occurredAt: null },
    {}
  );
  assert.equal(next.stakeholders.jd.stance, 'advocate'); // transcript overrides transcript
  assert.equal(next.stakeholders.jd.stanceSource, 'transcript');
  assert.equal(next.stakeholders.jd.nextStep, 'Jane to share security docs');
  assert.equal(next.tasks.length, 1);

  const { plan: skipped } = applyAnalysisToStrategy(
    { stakeholders: {}, tasks: [], updatedAt: '' },
    analysis(),
    { id: 't3', title: null, occurredAt: null },
    { Jane: null }
  );
  assert.deepEqual(skipped.stakeholders, {});
  assert.equal(skipped.tasks.length, 1); // tasks still land
});

test('applyAnalysisToPeople: metWith on, lastTouchAt max, never unset', () => {
  const state: MapState = {
    people: [
      person({ id: 'jd', metWith: true, lastTouchAt: '2026-03-01T00:00:00Z' }),
      person({ id: 'other' }),
    ],
    edges: [],
    meta: { domain: 'acme.com', companyName: 'Acme', researchedAt: null, tier: 'T0', provider: null },
  };
  const next = applyAnalysisToPeople(state, ['jd', 'other'], '2026-03-09T00:00:00Z');
  assert.equal(next.people[0].metWith, true);
  assert.equal(next.people[0].lastTouchAt, '2026-03-09T00:00:00Z'); // newer wins
  assert.equal(next.people[1].metWith, true);
  assert.equal(next.people[1].lastTouchAt, '2026-03-09T00:00:00Z');
  // older occurredAt does not roll back
  const back = applyAnalysisToPeople(next, ['jd'], '2025-01-01T00:00:00Z');
  assert.equal(back.people[0].lastTouchAt, '2026-03-09T00:00:00Z');
});
