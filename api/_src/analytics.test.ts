import assert from 'node:assert/strict';
import test from 'node:test';
import { mapCreationMetrics, sanitizeClientEvent } from './analytics.js';

test('client events retain only allowlisted properties', () => {
  assert.deepEqual(
    sanitizeClientEvent('source_opened', {
      surface: 'briefing',
      personName: 'Private person',
      sourceText: 'Private source text',
    }),
    {
      eventName: 'source_opened',
      properties: { surface: 'briefing' },
    }
  );
});

test('client event enums fall back safely and server events are rejected', () => {
  assert.deepEqual(
    sanitizeClientEvent('briefing_action_selected', {
      actionType: 'send_private_email',
      provenance: 'secret_notes',
    }),
    {
      eventName: 'briefing_action_selected',
      properties: {
        action_type: 'focus_people',
        provenance: 'map',
      },
    }
  );
  assert.equal(sanitizeClientEvent('map_created', {}), null);
});

test('useful map and time-to-value metrics use bounded inputs', () => {
  const nowMs = Date.parse('2026-09-12T12:10:00.000Z');
  assert.deepEqual(
    mapCreationMetrics({
      creationMode: 'researched',
      provider: 'gemini',
      researchedAt: '2026-09-12T12:09:00.000Z',
      peopleCount: 5,
      sourceCount: 3,
      initiativeCount: 2,
      edgeCount: 4,
      researchStartedAt: '2026-09-12T12:00:00.000Z',
      nowMs,
    }),
    {
      useful: true,
      creation_mode: 'researched',
      people_count: 5,
      source_count: 3,
      initiative_count: 2,
      estimated_minutes_saved: 24,
      time_to_value_seconds: 600,
    }
  );

  const fixture = mapCreationMetrics({
    creationMode: 'researched',
    provider: 'fixture',
    researchedAt: '2026-09-12T12:09:00.000Z',
    peopleCount: 20,
    sourceCount: 20,
    initiativeCount: 0,
    edgeCount: 0,
    researchStartedAt: '2026-09-11T12:00:00.000Z',
    nowMs,
  });
  assert.equal(fixture.useful, false);
  assert.equal('time_to_value_seconds' in fixture, false);
});
